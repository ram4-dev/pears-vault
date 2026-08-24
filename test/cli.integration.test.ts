/// <reference types="node" />
/// <reference path="./vendor.d.ts" />
import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { once } from 'node:events'
import { test } from 'node:test'
import DHT from 'hyperdht'

async function freeUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', resolve)
  })
  const port = socket.address().port
  await new Promise<void>(resolve => socket.close(() => resolve()))
  return port
}

class CliProcess {
  readonly child: ChildProcessWithoutNullStreams
  output = ''

  constructor(args: string[], env: NodeJS.ProcessEnv) {
    this.child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    this.child.stdout.on('data', chunk => { this.output += chunk.toString() })
    this.child.stderr.on('data', chunk => { this.output += chunk.toString() })
  }

  send(command: string): void {
    this.child.stdin.write(`${command}\n`)
  }

  async waitFor(pattern: RegExp, timeoutMs = 10_000): Promise<RegExpMatchArray> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const match = this.output.match(pattern)
      if (match) return match
      if (this.child.exitCode !== null) throw new Error(`CLI exited early (${this.child.exitCode}):\n${this.output}`)
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    throw new Error(`Timed out waiting for ${pattern}:\n${this.output}`)
  }

  async stop(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
    if (this.child.exitCode !== null) return
    this.child.kill(signal)
    await Promise.race([once(this.child, 'exit'), new Promise(resolve => setTimeout(resolve, 3_000))])
    if (this.child.exitCode === null) this.child.kill('SIGKILL')
  }
}

test('compiled CLI host and two joined peers synchronize live', { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-cli-'))
  const bootstrapper = DHT.bootstrapper(await freeUdpPort(), '127.0.0.1')
  const processes: CliProcess[] = []

  try {
    await bootstrapper.fullyBootstrapped()
    const bootstrap = `127.0.0.1:${bootstrapper.address().port}`
    const env = { PEARS_VAULT_BOOTSTRAP: bootstrap }

    const host = new CliProcess(['host', 'start', '--data-dir', join(root, 'host')], env)
    processes.push(host)
    const key = (await host.waitFor(/PEARS_VAULT_PUBLIC_KEY=([0-9a-f]{64})/))[1]

    const first = new CliProcess(['join', key, '--data-dir', join(root, 'peer-1')], env)
    processes.push(first)
    await first.waitFor(/Connected to vault/)
    first.send('add alpha first-secret')
    await first.waitFor(/Added: alpha/)
    first.send('get alpha')
    await first.waitFor(/alpha=first-secret/)

    const second = new CliProcess(['join', key, '--data-dir', join(root, 'peer-2')], env)
    processes.push(second)
    await second.waitFor(/Connected to vault/)
    second.send('add beta second-secret')
    await second.waitFor(/Added: beta/)

    first.send('list')
    await first.waitFor(/alpha\nbeta/)
    first.send('get beta')
    await first.waitFor(/beta=second-secret/)
    assert.equal(host.output.includes('first-secret'), false)
    assert.equal(host.output.includes('second-secret'), false)
  } finally {
    for (const process of processes.reverse()) await process.stop()
    await bootstrapper.destroy().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
