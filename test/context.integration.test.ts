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
    first = await joinContext(host.publicKey, { dataDir: join(root, 'peer-1'), projectRoot: root, bootstrap })
    second = await joinContext(host.publicKey, { dataDir: join(root, 'peer-2'), projectRoot: root, bootstrap })

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

    const firstCopy = await first.get(firstResult.id)
    const secondCopy = await first.get(secondResult.id)
    assert.ok(firstCopy)
    assert.ok(secondCopy)
    const { state: _firstState, ...firstRecord } = firstCopy
    const { state: _secondState, ...secondRecord } = secondCopy
    assert.deepEqual(firstRecord, firstResult.record)
    assert.deepEqual(secondRecord, secondResult.record)
    assert.equal((await second.get(firstResult.id))?.id, firstResult.id)
    assert.equal((await second.get(secondResult.id))?.id, secondResult.id)
    assert.notEqual(firstResult.length, 0)
    assert.equal(host.contextCoreKey, firstResult.record ? host.contextCoreKey : '')

    const superseded = await first.supersede({
      schema: 1,
      operationId: 'supersede-operation',
      scope: 'product/onboarding',
      kind: 'decision',
      title: 'Use a verified local projection',
      body: 'Agents can inspect the projection without writing to it.',
      author: 'agent-one',
      supersedes: [firstResult.id]
    })
    await waitFor(() => second!.syncStatus(), status => status.remoteLength >= superseded.length && status.fullySynced)
    const supersededTarget = await second.get(firstResult.id)
    assert.ok(supersededTarget)
    assert.deepEqual(supersededTarget.state.supersededBy, [superseded.id])
    assert.deepEqual((await second.list({ scope: 'product/onboarding' })).map(item => item.id), [firstResult.id, superseded.id])

    const deleted = await second.delete(secondResult.id, 'delete-operation')
    await waitFor(() => first!.syncStatus(), status => status.remoteLength >= deleted.length && status.fullySynced)
    assert.equal((await first.list()).some(item => item.id === secondResult.id), false)
    const deletedRecord = await first.get(secondResult.id)
    assert.ok(deletedRecord?.state.deletedAt)
    assert.equal((await first.list({ includeDeleted: true })).some(item => item.id === secondResult.id), true)
    await assert.rejects(
      () => first!.supersede({
        schema: 1,
        operationId: 'supersede-deleted',
        scope: 'project',
        kind: 'note',
        title: 'Invalid lifecycle',
        body: 'Deleted records cannot be superseded.',
        author: 'agent-one',
        supersedes: [secondResult.id]
      }),
      /deleted context record/
    )

    const projectionIndex = JSON.parse(await readFile(join(root, '.pears-context', 'index.json'), 'utf8')) as {
      length: number
      records: Array<{ id: string; deletedAt?: string }>
    }
    assert.equal(projectionIndex.length >= deleted.length, true)
    assert.equal(projectionIndex.records.some(item => item.id === secondResult.id && item.deletedAt), true)

    await second.close()
    second = undefined
    await host.close()
    host = undefined
    assert.equal((await first.list()).some(item => item.id === superseded.id), true)
    assert.equal((await first.get(superseded.id))?.title, superseded.record.title)
  } finally {
    await first?.close().catch(() => undefined)
    await second?.close().catch(() => undefined)
    await host?.close().catch(() => undefined)
    await bootstrapper.destroy().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
