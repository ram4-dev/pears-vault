/// <reference types="node" />
/// <reference path="./vendor.d.ts" />

import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import DHT from 'hyperdht'
import { joinContext } from '../src/context-peer.js'
import { startHost } from '../src/host.js'

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

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error('Timed out waiting for context peer reconnection')
}

test('a managed context peer reconnects and refreshes its projection', { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-context-reconnect-'))
  const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  let peer: Awaited<ReturnType<typeof joinContext>> | undefined

  try {
    await bootstrapper.fullyBootstrapped()
    const bootstrap = [{ host: '127.0.0.1', port: bootstrapper.address().port }]
    const hostDir = join(root, 'host')
    host = await startHost({ dataDir: hostDir, bootstrap, log: () => undefined })
    peer = await joinContext(host.publicKey, {
      dataDir: join(root, 'peer'),
      projectRoot: root,
      bootstrap,
      connectionRetryDelayMs: 50,
      connectionAttemptTimeoutMs: 150
    })

    const first = await peer.publish({
      schema: 1,
      operationId: 'before-restart',
      scope: 'project',
      kind: 'decision',
      title: 'Keep the local replica',
      body: 'The local context remains readable while the host is unavailable.',
      author: 'reconnect-test'
    })
    await host.close()
    host = undefined
    await assert.rejects(() => peer!.publish({
      schema: 1,
      operationId: 'offline-write',
      scope: 'project',
      kind: 'note',
      title: 'Offline',
      body: 'This must not be queued.',
      author: 'reconnect-test'
    }), /disconnected/)
    assert.equal((await peer.get(first.id))?.id, first.id)
    assert.equal((await peer.list()).some(record => record.id === first.id), true)

    host = await startHost({ dataDir: hostDir, bootstrap, log: () => undefined })
    await waitFor(() => peer!.syncStatus(), status => status.connected && status.fullySynced)
    const second = await peer.publish({
      schema: 1,
      operationId: 'after-restart',
      scope: 'project',
      kind: 'work-state',
      title: 'Reconnected',
      body: 'The managed context session restored the replica.',
      author: 'reconnect-test'
    })
    const projection = JSON.parse(await readFile(join(root, '.pears-context', 'index.json'), 'utf8')) as {
      records: Array<{ id: string }>
    }
    assert.deepEqual(projection.records.map(record => record.id), [first.id, second.id])
  } finally {
    await peer?.close().catch(() => undefined)
    await host?.close().catch(() => undefined)
    await bootstrapper.destroy().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
