/// <reference types="node" />

import { randomBytes } from 'node:crypto'
import { chmod, mkdir, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { contextProjectionPath } from './paths.js'
import type { ContextCurrentRecord, ContextRecordSummary } from './context.js'

interface ProjectionIndex {
  schema: 1
  length: number
  records: ContextRecordSummary[]
}

async function writeAtomic(path: string, value: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  const temporary = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`
  await writeFile(temporary, value, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, path)
  await chmod(path, 0o600)
}

function summaryOf(current: ContextCurrentRecord): ContextRecordSummary {
  const { record, state } = { record: current, state: current.state }
  return {
    id: record.id,
    scope: record.scope,
    kind: record.kind,
    title: record.title,
    author: record.author,
    ...(record.source === undefined ? {} : { source: record.source }),
    createdAt: record.createdAt,
    receivedAt: record.receivedAt,
    ...(record.supersedes === undefined ? {} : { supersedes: [...record.supersedes] }),
    supersededBy: [...state.supersededBy],
    ...(state.deletedAt === undefined ? {} : { deletedAt: state.deletedAt })
  }
}

function compareRecords(a: ContextCurrentRecord, b: ContextCurrentRecord): number {
  return a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id)
}

function renderMarkdown(current: ContextCurrentRecord): string {
  const state = current.state
  const lines = [
    `# ${current.title}`,
    '',
    `- ID: ${current.id}`,
    `- Scope: ${current.scope}`,
    `- Kind: ${current.kind}`,
    `- Author: ${current.author}`,
    `- Created: ${current.createdAt}`,
    `- Received: ${current.receivedAt}`
  ]
  if (current.source !== undefined) lines.push(`- Source: ${current.source}`)
  if (current.supersedes !== undefined) lines.push(`- Supersedes: ${current.supersedes.join(', ')}`)
  if (state.supersededBy.length > 0) lines.push(`- Superseded by: ${state.supersededBy.join(', ')}`)
  if (state.deletedAt !== undefined) lines.push(`- Deleted: ${state.deletedAt}`)
  lines.push('', '## Body', '', current.body, '')
  return lines.join('\n')
}

export class ContextProjection {
  readonly directory: string
  private queue: Promise<void> = Promise.resolve()

  constructor(projectRootOrDirectory: string, directoryIsExplicit = false) {
    this.directory = directoryIsExplicit || projectRootOrDirectory.endsWith('.pears-context')
      ? projectRootOrDirectory
      : contextProjectionPath(projectRootOrDirectory)
  }

  refresh(records: Iterable<ContextCurrentRecord>, length: number): Promise<void> {
    const current = this.queue.then(() => this.write(records, length), () => this.write(records, length))
    this.queue = current.then(() => undefined, () => undefined)
    return current
  }

  async waitForIdle(): Promise<void> {
    await this.queue
  }

  private async write(records: Iterable<ContextCurrentRecord>, length: number): Promise<void> {
    if (!Number.isInteger(length) || length < 0) throw new Error('Context projection length must be a non-negative integer')
    const sorted = [...records].sort(compareRecords)
    const recordDirectory = join(this.directory, 'records')
    await mkdir(recordDirectory, { recursive: true, mode: 0o700 })

    const expected = new Set<string>()
    for (const record of sorted) {
      expected.add(`${record.id}.json`)
      expected.add(`${record.id}.md`)
      await writeAtomic(join(recordDirectory, `${record.id}.json`), `${JSON.stringify(record, null, 2)}\n`)
      await writeAtomic(join(recordDirectory, `${record.id}.md`), renderMarkdown(record))
    }

    for (const entry of await readdir(recordDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !/\.(?:json|md)$/.test(entry.name) || expected.has(entry.name)) continue
      await unlink(join(recordDirectory, entry.name)).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    }

    const index: ProjectionIndex = {
      schema: 1,
      length,
      records: sorted.map(summaryOf)
    }
    await writeAtomic(join(this.directory, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  }
}

export function createContextProjection(projectRoot: string): ContextProjection {
  return new ContextProjection(projectRoot)
}
