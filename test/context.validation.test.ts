/// <reference types="node" />

import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CONTEXT_KINDS,
  parseContextReceipt,
  validateContextPublishInput,
  validateContextRecord
} from '../src/context.js'

function input(kind: (typeof CONTEXT_KINDS)[number] = 'decision'): Record<string, unknown> {
  return {
    schema: 1,
    operationId: 'op-1',
    scope: 'project',
    kind,
    title: 'Use a local replica',
    body: 'Agents should read synchronized context locally.',
    author: 'agent-a',
    source: 'design-discussion',
    createdAt: '2026-09-01T20:00:00.000Z'
  }
}

test('context validation accepts the closed taxonomy and rejects future kinds', () => {
  for (const kind of CONTEXT_KINDS) assert.doesNotThrow(() => validateContextPublishInput(input(kind)))
  assert.throws(
    () => validateContextPublishInput({ ...input(), kind: 'future-kind' }),
    /Unsupported context kind/
  )
  assert.throws(() => validateContextPublishInput({ ...input(), schema: 2 }), /schema version/)
  assert.throws(() => validateContextPublishInput({ ...input(), operationId: '' }), /operationId/)
  assert.throws(() => validateContextPublishInput({ ...input(), unexpected: true }), /unexpected fields/)
})

test('context receipt and record validators enforce their wire boundaries', () => {
  const record = {
    ...input(),
    peerId: '0123456789abcdef0123456789abcdef',
    id: 'record-1',
    receivedAt: '2026-09-01T20:01:00.000Z'
  }
  assert.doesNotThrow(() => validateContextRecord(record))
  assert.throws(() => validateContextRecord({ ...record, peerId: 'not-a-peer' }), /peerId/)
  assert.deepEqual(parseContextReceipt({
    operationId: 'op-1',
    id: 'record-1',
    length: 4,
    deduplicated: false
  }), {
    operationId: 'op-1',
    id: 'record-1',
    length: 4,
    deduplicated: false
  })
  assert.throws(() => parseContextReceipt({ operationId: 'op-1', id: 'record-1', length: -1, deduplicated: false }))
})
