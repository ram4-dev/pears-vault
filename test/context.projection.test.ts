/// <reference types="node" />

import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { ContextProjection } from '../src/context-projection.js'
import { contextProjectionPath } from '../src/paths.js'
import type { ContextCurrentRecord } from '../src/context.js'

function record(id: string, receivedAt: string, state = { id, supersededBy: [] as string[] }): ContextCurrentRecord {
  return {
    schema: 1,
    operationId: `operation-${id}`,
    peerId: '0123456789abcdef0123456789abcdef',
    scope: 'project',
    kind: 'decision',
    title: `Decision ${id}`,
    body: `Body ${id}`,
    author: 'test-agent',
    id,
    createdAt: receivedAt,
    receivedAt,
    state
  }
}

test('context projection is deterministic, lifecycle-aware, and cleaned atomically', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-context-projection-'))
  try {
    const projection = new ContextProjection(root)
    const first = record('record-b', '2026-09-01T20:02:00.000Z', {
      id: 'record-b',
      supersededBy: ['record-c']
    })
    const second = record('record-a', '2026-09-01T20:01:00.000Z', {
      id: 'record-a',
      supersededBy: [],
      deletedAt: '2026-09-01T20:03:00.000Z'
    })

    await projection.refresh([first, second], 12)
    const directory = contextProjectionPath(root)
    const index = JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')) as {
      length: number
      records: Array<{ id: string; deletedAt?: string; supersededBy: string[] }>
    }
    assert.equal(index.length, 12)
    assert.deepEqual(index.records.map(entry => entry.id), ['record-a', 'record-b'])
    assert.equal(index.records[0].deletedAt, '2026-09-01T20:03:00.000Z')
    assert.deepEqual(index.records[1].supersededBy, ['record-c'])
    assert.match(await readFile(join(directory, 'records/record-b.md'), 'utf8'), /Superseded by: record-c/)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'records/record-a.json'), 'utf8')), second)

    await writeFile(join(directory, 'records/stale.json'), 'stale')
    await writeFile(join(directory, 'records/stale.md'), 'stale')
    await projection.refresh([first], 13)
    assert.deepEqual((await readdir(join(directory, 'records'))).sort(), ['record-b.json', 'record-b.md'])
    assert.equal(JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')).length, 13)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
