import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { installContextSkill, resolveContextSkillSource } from '../src/context-skill.js'
import { contextSkillPath } from '../src/paths.js'

test('context skill installs from the packaged source at the project root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-context-skill-'))
  try {
    await mkdir(join(root, '.git'))
    const nested = join(root, 'packages', 'app')
    await mkdir(nested, { recursive: true })
    const installed = await installContextSkill(nested)
    const destination = contextSkillPath(root)
    assert.equal(installed, destination)
    assert.equal(await readFile(destination, 'utf8'), await readFile(resolveContextSkillSource(), 'utf8'))
    assert.match(await readFile(destination, 'utf8'), /hackvault context sync/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
