/// <reference types="node" />
import { randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function encodeEnvValue(value: string): string {
  return /^[A-Za-z0-9_./:@%+,=-]*$/.test(value) ? value : JSON.stringify(value)
}

export async function ensureDotEnv(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'a', 0o600)
  await handle.close()
  await chmod(path, 0o600)
}

export async function updateDotEnv(path: string, name: string, value: string): Promise<void> {
  let existing = ''
  try {
    existing = await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }

  const assignment = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(name)}\\s*=`)
  const replacement = `${name}=${encodeEnvValue(value)}`
  const lines = existing ? existing.replace(/\r\n/g, '\n').split('\n') : []
  const merged: string[] = []
  let replaced = false
  for (const line of lines) {
    if (!assignment.test(line)) {
      merged.push(line)
      continue
    }
    if (!replaced) {
      merged.push(replacement)
      replaced = true
    }
  }
  if (!replaced) {
    while (merged.at(-1) === '') merged.pop()
    merged.push(replacement)
  }

  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temporary, `${merged.join('\n')}\n`, {
    encoding: 'utf8',
    mode: 0o600
  })
  await rename(temporary, path)
  await chmod(path, 0o600)
}
