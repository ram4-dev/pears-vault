/// <reference types="node" />

import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, stat, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { loadOrCreateContextKey, loadOrCreatePeerIdentity, loadOrCreateVaultKey, ensureDataDir } from '../src/storage.js'
import { openContextHost } from '../src/context-host.js'

test('context authority and peer identity are separate, stable, and private', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-context-storage-'))
  try {
    await ensureDataDir(root)
    const contextKey = await loadOrCreateContextKey(root)
    const sameContextKey = await loadOrCreateContextKey(root)
    const vaultKey = await loadOrCreateVaultKey(root)
    const peerId = await loadOrCreatePeerIdentity(root)
    assert.deepEqual(contextKey, sameContextKey)
    assert.notDeepEqual(contextKey, vaultKey)
    assert.match(peerId, /^[0-9a-f]{32}$/)
    assert.equal((await stat(join(root, 'context-key'))).mode & 0o777, 0o600)
    assert.equal((await stat(join(root, 'peer-id'))).mode & 0o777, 0o600)
    await chmod(join(root, 'context-key'), 0o644)
    await loadOrCreateContextKey(root)
    assert.equal((await stat(join(root, 'context-key'))).mode & 0o777, 0o644)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('context records persist in their own encrypted Hypercore', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-context-persistence-'))
  const contextHost = await openContextHost({ dataDir: root })
  let recordId = ''
  try {
    const receipt = await contextHost.appendContext({
      schema: 1,
      operationId: 'storage-op',
      peerId: '0123456789abcdef0123456789abcdef',
      scope: 'project',
      kind: 'note',
      title: 'Private note',
      body: 'This body must not be stored in plaintext.',
      author: 'test'
    })
    assert.ok(receipt.length > 0)
    recordId = receipt.id
  } finally {
    await contextHost.close()
  }

  try {
    const core = new Hypercore(join(root, 'context-hypercore'))
    const bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'utf-8' })
    await bee.ready()
    const record = await bee.get('record/' + recordId)
    assert.ok(record)
    const value = JSON.parse(record.value) as { ciphertext: string }
    assert.equal(value.ciphertext.includes('Private note'), false)
    const operation = await bee.get('operation/storage-op')
    assert.ok(operation)
    await bee.close()
    await readFile(join(root, 'context-key'), 'utf8')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
