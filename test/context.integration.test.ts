/// <reference types="node" />
/// <reference path="./vendor.d.ts" />

import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { mkdtemp, rm } from 'node:fs/promises'
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

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean, timeoutMs = 3_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (predicate(value)) return value
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  throw new Error('Timed out waiting for synchronized context')
}

test('two context peers publish and read complete encrypted local replicas', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-context-integration-'))
  const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  let first: Awaited<ReturnType<typeof joinContext>> | undefined
  let second: Awaited<ReturnType<typeof joinContext>> | undefined
  try {
    await bootstrapper.fullyBootstrapped()
    const bootstrap = [{ host: '127.0.0.1', port: bootstrapper.address().port }]
    host = await startHost({ dataDir: join(root, 'host'), bootstrap, log: () => undefined })
    first = await joinContext(host.publicKey, { dataDir: join(root, 'peer-1'), bootstrap })
    second = await joinContext(host.publicKey, { dataDir: join(root, 'peer-2'), bootstrap })

    const firstResult = await first.publish({
      schema: 1,
      operationId: 'first-operation',
      scope: 'product/onboarding',
      kind: 'decision',
      title: 'Keep onboarding local-first',
      body: 'Agents should use the synchronized local context replica.',
      author: 'agent-one',
      source: 'test'
    })
    assert.equal(firstResult.record.id, firstResult.id)
    assert.equal(firstResult.record.peerId.length, 32)
    assert.equal((await first.syncStatus()).fullySynced, true)
    const retryResult = await first.publish({
      schema: 1,
      operationId: 'first-operation',
      scope: 'product/onboarding',
      kind: 'decision',
      title: 'Keep onboarding local-first',
      body: 'Agents should use the synchronized local context replica.',
      author: 'agent-one',
      source: 'test'
    })
    assert.equal(retryResult.id, firstResult.id)
    assert.equal(retryResult.length, firstResult.length)
    assert.equal(retryResult.deduplicated, true)
    assert.deepEqual(retryResult.record, firstResult.record)

    const secondResult = await second.publish({
      schema: 1,
      operationId: 'second-operation',
      scope: 'engineering/runtime',
      kind: 'architecture',
      title: 'Separate context storage',
      body: 'Context does not use the secret Hyperbee keyspace.',
      author: 'agent-two'
    })
    await waitFor(() => first!.syncStatus(), status => status.remoteLength >= secondResult.length && status.fullySynced)
    await waitFor(() => second!.syncStatus(), status => status.fullySynced)

    assert.deepEqual(await first.get(firstResult.id), firstResult.record)
    assert.deepEqual(await first.get(secondResult.id), secondResult.record)
    assert.deepEqual(await second.get(firstResult.id), firstResult.record)
    assert.deepEqual(await second.get(secondResult.id), secondResult.record)
    assert.notEqual(firstResult.length, 0)
    assert.equal(host.contextCoreKey, firstResult.record ? host.contextCoreKey : '')
  } finally {
    await first?.close().catch(() => undefined)
    await second?.close().catch(() => undefined)
    await host?.close().catch(() => undefined)
    await bootstrapper.destroy().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
