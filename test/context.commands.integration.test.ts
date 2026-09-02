/// <reference types="node" />
/// <reference path="./vendor.d.ts" />

import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import DHT from 'hyperdht'
import { runCli } from '../src/cli.js'
import { startHost } from '../src/host.js'

async function getFreeUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', resolve)
  })
  const port = socket.address().port
  await new Promise<void>(resolve => socket.close(() => resolve()))
  return port
}

async function runJsonCommand(args: string[]): Promise<unknown> {
  const output: string[] = []
  const originalLog = console.log
  const originalError = console.error
  console.log = (...values: unknown[]) => output.push(values.join(' '))
  console.error = () => undefined
  try {
    await runCli(args)
  } finally {
    console.log = originalLog
    console.error = originalError
  }
  assert.equal(output.length, 1)
  return JSON.parse(output[0]) as unknown
}

test('context commands emit strict JSON and support bounded queries', { timeout: 40_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-context-commands-'))
  const originalCwd = process.cwd()
  const projectRoot = join(root, 'project')
  const peerDataDir = join(root, 'context-peer')
  const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  try {
    await mkdir(join(projectRoot, '.git'), { recursive: true })
    process.chdir(projectRoot)
    await bootstrapper.fullyBootstrapped()
    const bootstrap = [{ host: '127.0.0.1', port: bootstrapper.address().port }]
    const common = ['--data-dir', peerDataDir, '--bootstrap', `127.0.0.1:${bootstrapper.address().port}`]
    host = await startHost({ dataDir: join(root, 'host'), bootstrap, log: () => undefined })

    const first = await runJsonCommand([
      'context', 'add', host.publicKey,
      JSON.stringify({
        schema: 1,
        operationId: 'context-command-one',
        scope: 'product/onboarding',
        kind: 'decision',
        title: 'Use local context',
        body: 'Agents sync before reading.',
        author: 'command-test'
      }),
      ...common
    ]) as { id: string; record: { id: string } }
    assert.equal(first.id, first.record.id)

    const second = await runJsonCommand([
      'context', 'add', host.publicKey,
      JSON.stringify({
        schema: 1,
        operationId: 'context-command-two',
        scope: 'engineering/runtime',
        kind: 'architecture',
        title: 'Keep domains separate',
        body: 'Context and secrets use independent storage.',
        author: 'command-test'
      }),
      ...common
    ]) as { id: string }

    const filtered = await runJsonCommand([
      'context', 'list', host.publicKey, '--scope', 'product/onboarding', '--kind', 'decision', '--limit', '1', ...common
    ]) as Array<{ id: string; scope: string; kind: string }>
    assert.equal(filtered.length, 1)
    assert.equal(filtered[0].id, first.id)
    assert.equal(filtered[0].scope, 'product/onboarding')
    assert.equal(filtered[0].kind, 'decision')

    const all = await runJsonCommand(['context', 'list', host.publicKey, '--limit', '10', ...common]) as Array<{ id: string }>
    assert.deepEqual(all.map(record => record.id), [first.id, second.id])
    assert.equal((await runJsonCommand(['context', 'get', host.publicKey, second.id, ...common]) as { id: string }).id, second.id)

    const status = await runJsonCommand(['context', 'sync', host.publicKey, ...common]) as { fullySynced: boolean }
    assert.equal(status.fullySynced, true)
  } finally {
    process.chdir(originalCwd)
    await host?.close().catch(() => undefined)
    await bootstrapper.destroy().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
