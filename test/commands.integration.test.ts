/// <reference types="node" />
/// <reference path="./vendor.d.ts" />
import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import DHT from 'hyperdht'
import { runCli } from '../src/cli.js'
import { startHost } from '../src/host.js'

async function getFreeUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', resolve)
  })
  const port = socket.address().port
  await new Promise<void>((resolve) => socket.close(() => resolve()))
  return port
}

async function runJsonCommand(args: string[]): Promise<unknown> {
  const output: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...values: unknown[]) => output.push(values.join(' '))
  console.error = () => undefined
  try {
    await Promise.race([
      runCli(args),
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error('Non-interactive command hung on stdin')), 8_000)
      })
    ])
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  assert.equal(output.length, 1)
  try {
    return JSON.parse(output[0]) as unknown
  } catch {
    throw new Error(`Command did not emit valid JSON: ${output[0]}`)
  }
}

test(
  'programmatic add, list, and get commands print bounded JSON results',
  {
    timeout: 40_000
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pears-vault-commands-'))
    const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
    let host: Awaited<ReturnType<typeof startHost>> | undefined

    try {
      await bootstrapper.fullyBootstrapped()
      const port = bootstrapper.address().port
      const bootstrap = [{ host: '127.0.0.1', port }]
      const common = ['--data-dir', join(root, 'peer'), '--bootstrap', `127.0.0.1:${port}`]
      host = await startHost({
        dataDir: join(root, 'host'),
        bootstrap,
        log: () => undefined
      })

      assert.deepEqual(await runJsonCommand(['add', host.publicKey, 'API_TOKEN', 'agent-secret', ...common]), {
        ok: true,
        name: 'API_TOKEN'
      })
      const listed = await runJsonCommand(['list', host.publicKey, ...common])
      assert.deepEqual(listed, ['API_TOKEN'])
      assert.equal(JSON.stringify(listed).includes('agent-secret'), false)
      assert.deepEqual(await runJsonCommand(['get', host.publicKey, 'API_TOKEN', ...common]), {
        name: 'API_TOKEN',
        value: 'agent-secret'
      })

      assert.match(await readFile(join(root, 'host', '.env'), 'utf8'), /^API_TOKEN=agent-secret$/m)
      assert.match(await readFile(join(root, 'peer', '.env'), 'utf8'), /^API_TOKEN=agent-secret$/m)
    } finally {
      await host?.close().catch(() => undefined)
      await bootstrapper.destroy().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  }
)
