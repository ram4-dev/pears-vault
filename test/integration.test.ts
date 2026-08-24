/// <reference types="node" />
/// <reference path="./vendor.d.ts" />
import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import DHT from 'hyperdht'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
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
