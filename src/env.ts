/// <reference types="node" />
import { createHash, randomBytes } from 'node:crypto'
import { chmod, mkdir, open, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

interface EnvUpsert {
  name: string
  value: string
}

export interface EnvChanges {
  upserts: EnvUpsert[]
  deletes: string[]
}

interface PersistedEnvState {
  hashes: Record<string, string>
  managedKeys: string[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function encodeEnvValue(value: string): string {
  return /^[A-Za-z0-9_./:@%+,=-]*$/.test(value) ? value : JSON.stringify(value)
}

function hashEnvValue(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function hashEnvValues(values: Map<string, string>): Map<string, string> {
  return new Map([...values].map(([name, value]) => [name, hashEnvValue(value)]))
}

function decodeEnvValue(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const decoded = JSON.parse(trimmed)
      if (typeof decoded === 'string') return decoded
    } catch {
      return trimmed.slice(1, -1)
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) return trimmed.slice(1, -1)
  return trimmed
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  }
}

async function writePrivateAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
  await chmod(path, 0o600)
}

async function ensureDotEnv(path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const handle = await open(path, 'a', 0o600)
  await handle.close()
  await chmod(path, 0o600)
}

async function readDotEnv(path: string): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  for (const line of (await readText(path)).replace(/\r\n/g, '\n').split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z0-9_.-]+)\s*=(.*)$/.exec(line)
    if (match) result.set(match[1], decodeEnvValue(match[2]))
  }
  return result
}

export async function updateDotEnv(path: string, name: string, value: string): Promise<void> {
  const existing = await readText(path)
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
  await writePrivateAtomic(path, `${merged.join('\n')}\n`)
}

export async function removeDotEnv(path: string, name: string): Promise<void> {
  const assignment = new RegExp(`^\\s*(?:export\\s+)?${escapeRegExp(name)}\\s*=`)
  const lines = (await readText(path)).replace(/\r\n/g, '\n').split('\n')
  const retained = lines.filter((line) => !assignment.test(line))
  while (retained.length > 1 && retained.at(-1) === '' && retained.at(-2) === '') retained.pop()
  await writePrivateAtomic(path, retained.join('\n').replace(/\n*$/, '\n'))
}

export class DotEnvMirror {
  private baseline = new Map<string, string>()
  private managedKeys = new Set<string>()
  private queue: Promise<void> = Promise.resolve()
  private initialized = false

  constructor(
    readonly envPath: string,
    readonly statePath: string
  ) {}

  async ready(): Promise<void> {
    if (this.initialized) return
    await ensureDotEnv(this.envPath)
    try {
      const parsed = JSON.parse(await readFile(this.statePath, 'utf8')) as PersistedEnvState
      if (!parsed || typeof parsed.hashes !== 'object' || !Array.isArray(parsed.managedKeys)) throw new Error('invalid')
      this.baseline = new Map(
        Object.entries(parsed.hashes).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
      this.managedKeys = new Set(parsed.managedKeys.filter((key) => typeof key === 'string'))
    } catch {
      this.baseline = hashEnvValues(await readDotEnv(this.envPath))
      this.managedKeys.clear()
      await this.persist()
    }
    this.initialized = true
  }

  detectLocalChanges(): Promise<EnvChanges> {
    return this.run(async () => {
      const current = await readDotEnv(this.envPath)
      const upserts: EnvUpsert[] = []
      const deletes: string[] = []
      for (const [name, value] of current) {
        if (!this.baseline.has(name) || this.baseline.get(name) !== hashEnvValue(value)) upserts.push({ name, value })
      }
      for (const name of this.managedKeys) {
        if (!current.has(name) && this.baseline.has(name)) deletes.push(name)
      }
      upserts.sort((a, b) => a.name.localeCompare(b.name))
      deletes.sort()
      return { upserts, deletes }
    })
  }

  commitLocalChanges(changes: EnvChanges): Promise<void> {
    return this.run(async () => {
      for (const { name } of changes.upserts) this.managedKeys.add(name)
      for (const name of changes.deletes) this.managedKeys.delete(name)
      this.baseline = hashEnvValues(await readDotEnv(this.envPath))
      await this.persist()
    })
  }

  applyVaultUpsert(name: string, value: string): Promise<void> {
    return this.run(async () => {
      await updateDotEnv(this.envPath, name, value)
      this.managedKeys.add(name)
      this.baseline = hashEnvValues(await readDotEnv(this.envPath))
      await this.persist()
    })
  }

  applyVaultDelete(name: string): Promise<void> {
    return this.run(async () => {
      await removeDotEnv(this.envPath, name)
      this.managedKeys.delete(name)
      this.baseline = hashEnvValues(await readDotEnv(this.envPath))
      await this.persist()
    })
  }

  applyVaultSnapshot(values: Map<string, string>): Promise<void> {
    return this.run(async () => {
      for (const name of this.managedKeys) {
        if (!values.has(name)) await removeDotEnv(this.envPath, name)
      }
      for (const [name, value] of values) await updateDotEnv(this.envPath, name, value)
      this.managedKeys = new Set(values.keys())
      this.baseline = hashEnvValues(await readDotEnv(this.envPath))
      await this.persist()
    })
  }

  private run<T>(task: () => Promise<T>): Promise<T> {
    const current = this.queue.then(task)
    this.queue = current.then(
      () => undefined,
      () => undefined
    )
    return current
  }

  private async persist(): Promise<void> {
    const hashes = Object.fromEntries([...this.baseline.entries()].sort(([a], [b]) => a.localeCompare(b)))
    const state: PersistedEnvState = {
      hashes,
      managedKeys: [...this.managedKeys].sort()
    }
    await writePrivateAtomic(this.statePath, `${JSON.stringify(state, null, 2)}\n`)
  }
}
