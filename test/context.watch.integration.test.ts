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
  throw new Error('Timed out waiting for context watch sync')
}

test('onSync fires after initial sync and after every background append', { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-watch-sync-'))
  const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  let peer: Awaited<ReturnType<typeof joinContext>> | undefined

  try {
    await bootstrapper.fullyBootstrapped()
    const bootstrap = [{ host: '127.0.0.1', port: bootstrapper.address().port }]
    const hostDir = join(root, 'host')
    host = await startHost({ dataDir: hostDir, bootstrap, log: () => undefined })

    const syncEvents: Array<{ localLength: number; remoteLength: number }> = []
    peer = await joinContext(host.publicKey, {
      dataDir: join(root, 'peer'),
      projectRoot: root,
      bootstrap,
      connectionRetryDelayMs: 50,
      connectionAttemptTimeoutMs: 150,
      onSync: status => {
        syncEvents.push({ localLength: status.localLength, remoteLength: status.remoteLength })
      }
    })

    // Wait for onSync to fire at least once (initial sync)
    const initialSynced = await waitFor(
      () => syncEvents.length,
      count => count >= 1,
      5_000
    )
    assert.ok(initialSynced >= 1, 'onSync should fire after initial sync')

    // Publish a new record and verify onSync fires again for the background append
    const record = await peer.publish({
      schema: 1,
      operationId: 'watch-sync-test',
      scope: 'engineering/runtime',
      kind: 'note',
      title: 'Watch sync test',
      body: 'This record is published after the watch peer connected.',
      author: 'watch-test'
    })

    const synced = await waitFor(
      () => syncEvents.length,
      count => count >= 2 && syncEvents[syncEvents.length - 1].remoteLength >= record.length,
      8_000
    )
    assert.ok(synced >= 2, 'onSync should fire after background append')

    // Verify the record is in the projection
    const projectionIndex = JSON.parse(await readFile(join(root, '.pears-context', 'index.json'), 'utf8')) as {
      records: Array<{ id: string }>
    }
    assert.ok(projectionIndex.records.some(r => r.id === record.id))
  } finally {
    await peer?.close().catch(() => undefined)
    await host?.close().catch(() => undefined)
    await bootstrapper.destroy().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('watch re-enters after host restart and receives new records', { timeout: 60_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-watch-reconnect-'))
  const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  let peer: Awaited<ReturnType<typeof joinContext>> | undefined

  try {
    await bootstrapper.fullyBootstrapped()
    const bootstrap = [{ host: '127.0.0.1', port: bootstrapper.address().port }]
    const hostDir = join(root, 'host')

    host = await startHost({ dataDir: hostDir, bootstrap, log: () => undefined })

    const syncEvents: Array<{ localLength: number; remoteLength: number; connected: boolean }> = []
    peer = await joinContext(host.publicKey, {
      dataDir: join(root, 'peer'),
      projectRoot: root,
      bootstrap,
      connectionRetryDelayMs: 50,
      connectionAttemptTimeoutMs: 150,
      onSync: status => {
        syncEvents.push({
          localLength: status.localLength,
          remoteLength: status.remoteLength,
          connected: status.connected
        })
      }
    })

    // Wait for initial sync
    await waitFor(
      () => syncEvents.length,
      count => count >= 1,
      5_000
    )

    // Publish a record before host restart
    const before = await peer.publish({
      schema: 1,
      operationId: 'before-restart',
      scope: 'project',
      kind: 'work-state',
      title: 'Before restart',
      body: 'Published before host was stopped.',
      author: 'watch-reconnect-test'
    })

    // Stop the host
    await host.close()
    host = undefined
    await new Promise(resolve => setTimeout(resolve, 500))

    // Restart the host
    host = await startHost({ dataDir: hostDir, bootstrap, log: () => undefined })

    // Wait for the watch peer to reconnect and sync
    const reconnected = await waitFor(
      () => syncEvents.some(e => e.connected && e.remoteLength >= before.length),
      () => true,
      15_000
    )
    assert.ok(reconnected, 'Watch peer should reconnect and sync after host restart')

    // Publish a new record and verify the watch peer receives it
    const after = await peer.publish({
      schema: 1,
      operationId: 'after-restart',
      scope: 'project',
      kind: 'note',
      title: 'After restart',
      body: 'Published after host was restarted.',
      author: 'watch-reconnect-test'
    })

    const postReconnectSynced = await waitFor(
      () => syncEvents.length,
      count => count >= 2 && syncEvents[count - 1].remoteLength >= after.length,
      15_000
    )
    assert.ok(postReconnectSynced >= 2, 'Watch peer should sync new records after reconnect')

    // Verify both records are in the projection
    const projectionIndex = JSON.parse(await readFile(join(root, '.pears-context', 'index.json'), 'utf8')) as {
      records: Array<{ id: string }>
    }
    assert.ok(projectionIndex.records.some(r => r.id === before.id))
    assert.ok(projectionIndex.records.some(r => r.id === after.id))
  } finally {
    await peer?.close().catch(() => undefined)
    await host?.close().catch(() => undefined)
    await bootstrapper.destroy().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})