/// <reference types="node" />
/// <reference path="./vendor.d.ts" />
import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import DHT from 'hyperdht'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { runCli } from '../src/cli.js'
import { startHost } from '../src/host.js'
import { joinVault } from '../src/peer.js'

async function getFreeUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', resolve)
  })
  const address = socket.address()
  await new Promise<void>(resolve => socket.close(() => resolve()))
  return address.port
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for live peer update')), timeoutMs)
    })
  ])
}

function parseJson(value: string): Record<string, unknown> {
  try {
    return JSON.parse(value) as Record<string, unknown>
  } catch {
    throw new Error('Stored Hyperbee value is not valid JSON')
  }
}

test('two peers write, read, and live-sync through a local HyperDHT', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-'))
  const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  let first: Awaited<ReturnType<typeof joinVault>> | undefined
  let second: Awaited<ReturnType<typeof joinVault>> | undefined

  try {
    await bootstrapper.fullyBootstrapped()
    const address = bootstrapper.address()
    const bootstrap = [{ host: '127.0.0.1', port: address.port }]

    host = await startHost({ dataDir: join(root, 'host'), bootstrap, log: () => undefined })
    let resolveFirstUpdate: (() => void) | undefined
    const firstUpdated = new Promise<void>(resolve => { resolveFirstUpdate = resolve })
    first = await joinVault(host.publicKey, {
      dataDir: join(root, 'peer-1'),
      bootstrap,
      onUpdate: ({ name }) => {
        if (name === 'beta') resolveFirstUpdate?.()
      }
    })
    second = await joinVault(host.publicKey, { dataDir: join(root, 'peer-2'), bootstrap })

    await first.add('alpha', 'first-secret')
    assert.equal(await first.get('alpha'), 'first-secret')
    assert.deepEqual(await second.list(), ['alpha'])
    assert.equal(await second.get('alpha'), 'first-secret')

    await second.add('beta', 'second-secret')
    await withTimeout(firstUpdated, 2_000)
    assert.deepEqual(await first.list(), ['alpha', 'beta'])
    assert.equal(await first.get('beta'), 'second-secret')

    for (const envPath of [
      join(root, 'host', '.env'),
      join(root, 'peer-1', '.env'),
      join(root, 'peer-2', '.env')
    ]) {
      const env = await readFile(envPath, 'utf8')
      assert.match(env, /^alpha=first-secret$/m)
      assert.match(env, /^beta=second-secret$/m)
    }
  } finally {
    await first?.close().catch(() => undefined)
    await second?.close().catch(() => undefined)
    await host?.close().catch(() => undefined)
    await bootstrapper.destroy().catch(() => undefined)
  }

  const core = new Hypercore(join(root, 'host', 'hypercore'))
  const bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'utf-8' })
  await bee.ready()
  const alpha = await bee.get('alpha')
  assert.ok(alpha)
  assert.equal(alpha.value.includes('first-secret'), false)
  const envelope = parseJson(alpha.value)
  assert.equal(envelope.alg, 'aes-256-gcm')
  await bee.close()

  const vaultKeyFile = await readFile(join(root, 'host', 'vault-key'), 'utf8')
  assert.match(vaultKeyFile, /^[0-9a-f]{64}$/)
  await rm(root, { recursive: true, force: true })
})

test(
  'a peer bootstraps every existing block and persists live updates locally',
  {
    timeout: 30_000
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pears-vault-local-copy-'))
    const peerDir = join(root, 'replica')
    const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
    let host: Awaited<ReturnType<typeof startHost>> | undefined
    let writer: Awaited<ReturnType<typeof joinVault>> | undefined
    let replica: Awaited<ReturnType<typeof joinVault>> | undefined

    try {
      await bootstrapper.fullyBootstrapped()
      const bootstrap = [{ host: '127.0.0.1', port: bootstrapper.address().port }]
      host = await startHost({
        dataDir: join(root, 'host'),
        bootstrap,
        log: () => undefined
      })
      writer = await joinVault(host.publicKey, {
        dataDir: join(root, 'writer'),
        bootstrap
      })
      await mkdir(peerDir, { recursive: true })
      await writeFile(join(peerDir, '.env'), `# keep me
UNRELATED=preserved
beta=stale
`, 'utf8')
      await writer.add('alpha', 'first-secret')
      await writer.add('beta', 'second-secret')

      let resolveGamma: (() => void) | undefined
      const gammaUpdated = new Promise<void>((resolve) => {
        resolveGamma = resolve
      })
      replica = await joinVault(host.publicKey, {
        dataDir: peerDir,
        bootstrap,
        onUpdate: ({ name }) => {
          if (name === 'gamma') resolveGamma?.()
        }
      })
      const bootstrapped = await replica.syncStatus()
      assert.equal(bootstrapped.fullySynced, true)
      assert.equal(bootstrapped.localLength, bootstrapped.remoteLength)

      await writer.add('gamma', 'third-secret')
      await withTimeout(gammaUpdated, 2_000)
      const updated = await replica.syncStatus()
      assert.equal(updated.fullySynced, true)

      await replica.close()
      replica = undefined
      const localCore = new Hypercore(join(peerDir, 'hypercore'))
      const localBee = new Hyperbee(localCore, {
        keyEncoding: 'utf-8',
        valueEncoding: 'utf-8'
      })
      await localBee.ready()
      const localAlpha = await localBee.get('alpha')
      const localBeta = await localBee.get('beta')
      const localGamma = await localBee.get('gamma')
      assert.ok(localAlpha)
      assert.ok(localBeta)
      assert.ok(localGamma)
      assert.equal(localAlpha.value.includes('first-secret'), false)
      assert.equal(localBeta.value.includes('second-secret'), false)
      assert.equal(localGamma.value.includes('third-secret'), false)
      await localBee.close()

      const replicaEnv = await readFile(join(peerDir, '.env'), 'utf8')
      assert.match(replicaEnv, /^# keep me$/m)
      assert.match(replicaEnv, /^UNRELATED=preserved$/m)
      assert.match(replicaEnv, /^alpha=first-secret$/m)
      assert.match(replicaEnv, /^beta=second-secret$/m)
      assert.match(replicaEnv, /^gamma=third-secret$/m)
      assert.equal(replicaEnv.match(/^beta=/gm)?.length, 1)
    } finally {
      await replica?.close().catch(() => undefined)
      await writer?.close().catch(() => undefined)
      await host?.close().catch(() => undefined)
      await bootstrapper.destroy().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  }
)

test(
  'sync command bootstraps a persistent local copy and prints status',
  {
    timeout: 30_000
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pears-vault-sync-command-'))
    const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
    let host: Awaited<ReturnType<typeof startHost>> | undefined
    let writer: Awaited<ReturnType<typeof joinVault>> | undefined
    const output: string[] = []
    const errors: string[] = []
    const originalLog = console.log
    const originalError = console.error

    try {
      await bootstrapper.fullyBootstrapped()
      const port = bootstrapper.address().port
      const bootstrap = [{ host: '127.0.0.1', port }]
      host = await startHost({
        dataDir: join(root, 'host'),
        bootstrap,
        log: () => undefined
      })
      writer = await joinVault(host.publicKey, {
        dataDir: join(root, 'writer'),
        bootstrap
      })
      await writer.add('alpha', 'first-secret')
      await writer.close()
      writer = undefined

      console.log = (...values: unknown[]) => output.push(values.join(' '))
      console.error = (...values: unknown[]) => errors.push(values.join(' '))
      const peerDir = join(root, 'synced-peer')
      await runCli(['sync', host.publicKey, '--data-dir', peerDir, '--bootstrap', `127.0.0.1:${port}`])
      const status = JSON.parse(output.at(-1) ?? '{}') as Record<string, unknown>
      assert.equal(status.fullySynced, true)
      assert.equal(status.dataDir, peerDir)
      assert.equal(
        errors.some((line) => line.includes('Sync error')),
        false
      )
    } finally {
      console.log = originalLog
      console.error = originalError
      await writer?.close().catch(() => undefined)
      await host?.close().catch(() => undefined)
      await bootstrapper.destroy().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  }
)

test(
  'join retries and reports an actionable host-readiness error',
  {
    timeout: 5_000
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pears-vault-unreachable-'))
    const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
    const statuses: string[] = []

    try {
      await bootstrapper.fullyBootstrapped()
      const bootstrap = [{ host: '127.0.0.1', port: bootstrapper.address().port }]
      const unreachableKey = DHT.keyPair().publicKey.toString('hex')

      await assert.rejects(
        joinVault(unreachableKey, {
          dataDir: join(root, 'peer'),
          bootstrap,
          connectionTimeoutMs: 700,
          connectionAttemptTimeoutMs: 150,
          connectionRetryDelayMs: 50,
          onConnectionStatus: (message) => statuses.push(message)
        }),
        /Keep 'pears-vault host start' running and wait for 'Host is serving\.\.\.'/
      )
      assert.ok(statuses.filter((message) => message.startsWith('Connecting to vault')).length >= 2)
    } finally {
      await bootstrapper.destroy().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  }
)
