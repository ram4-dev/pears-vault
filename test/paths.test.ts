/// <reference types="node" />
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { defaultHostEnvPath, defaultPeerDataDir } from '../src/paths.js'

test('peer data directories are stable per project and vault', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-paths-'))
  const project = join(root, 'project')
  const nested = join(project, 'packages', 'app')
  const home = join(root, 'home')
  await mkdir(join(project, '.git'), { recursive: true })
  await mkdir(nested, { recursive: true })

  try {
    const firstKey = 'a'.repeat(64)
    const first = defaultPeerDataDir(firstKey, project, home)
    const nestedResult = defaultPeerDataDir(firstKey, nested, home)
    const otherVault = defaultPeerDataDir('b'.repeat(64), nested, home)

    assert.equal(first, nestedResult)
    assert.equal(defaultHostEnvPath(nested), join(project, '.env'))
    assert.notEqual(first, otherVault)
    assert.match(first, /\.pears-vault\/peers\/[0-9a-f]{20}$/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
