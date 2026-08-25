/// <reference types="node" />
import assert from 'node:assert/strict'
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { updateDotEnv } from '../src/env.js'

test('updateDotEnv merges by name and preserves unrelated lines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-env-'))
  const path = join(root, '.env')
  await writeFile(path, '# project settings\nUNCHANGED=keep\nTOKEN=old\n\n', 'utf8')
  await chmod(path, 0o644)

  try {
    await updateDotEnv(path, 'TOKEN', 'new value # safe')
    await updateDotEnv(path, 'MULTILINE', 'first\nsecond')
    const content = await readFile(path, 'utf8')

    assert.match(content, /^# project settings$/m)
    assert.match(content, /^UNCHANGED=keep$/m)
    assert.match(content, /^TOKEN="new value # safe"$/m)
    assert.match(content, /^MULTILINE="first\\nsecond"$/m)
    assert.equal(content.match(/^TOKEN=/gm)?.length, 1)
    assert.equal((await stat(path)).mode & 0o777, 0o600)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
