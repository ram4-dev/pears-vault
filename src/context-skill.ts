/// <reference types="node" />

import { copyFile, mkdir, readFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { contextSkillPath, findProjectRoot } from './paths.js'

const SKILL_RELATIVE_PATH = join('skills', 'hackvault-context', 'SKILL.md')

export function resolveContextSkillSource(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', SKILL_RELATIVE_PATH)
}

export async function installContextSkill(projectDir = process.cwd()): Promise<string> {
  const projectRoot = findProjectRoot(projectDir)
  const source = resolveContextSkillSource()
  const destination = contextSkillPath(projectRoot)
  await readFile(source, 'utf8')
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.tmp`
  try {
    await copyFile(source, temporary)
    await rename(temporary, destination)
  } finally {
    await unlink(temporary).catch(() => undefined)
  }
  return destination
}
