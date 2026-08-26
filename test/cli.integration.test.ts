/// <reference types="node" />
/// <reference path="./vendor.d.ts" />
import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

  constructor(args: string[], env: NodeJS.ProcessEnv, executable?: string) {
    this.child = spawn(executable ?? process.execPath, executable ? args : ['--import', 'tsx', 'src/cli.ts', ...args], {
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

test('linked CLI prints its public key before DHT announcement completes', { timeout: 10_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-startup-'))
  const unavailableBootstrap = `127.0.0.1:${await freeUdpPort()}`
  const linkedBin = join(root, 'hackvault')
  await symlink(resolve('dist/cli.js'), linkedBin)
  const host = new CliProcess(
    ['host', 'start', '--data-dir', join(root, 'host')],
    { HACKVAULT_BOOTSTRAP: unavailableBootstrap },
    linkedBin
  )

  try {
    await host.waitFor(/HACKVAULT_PUBLIC_KEY=[0-9a-f]{64}/, 2_000)
    await host.waitFor(/Starting vault storage and announcing on HyperDHT/, 2_000)
  } finally {
    await host.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('compiled CLI host and joined peer stay live', { timeout: 45_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-cli-'))
  const projectRoot = join(root, 'project')
  const nestedCwd = join(projectRoot, 'packages', 'app')
  const peerDataDir = join(root, 'peer-1')
  const bootstrapper = DHT.bootstrapper(await freeUdpPort(), '127.0.0.1')
  const processes: CliProcess[] = []
  let persistentNode: any

  try {
    await mkdir(join(projectRoot, '.git'), { recursive: true })
    await mkdir(nestedCwd, { recursive: true })
    await bootstrapper.fullyBootstrapped()
    const address = { host: '127.0.0.1', port: bootstrapper.address().port }
    persistentNode = new DHT({ bootstrap: [address], ephemeral: false })
    await persistentNode.fullyBootstrapped()
    const bootstrap = `${address.host}:${address.port}`
    const env = { HACKVAULT_BOOTSTRAP: bootstrap }

    const host = new CliProcess(['host', 'start', '--data-dir', join(root, 'host')], env)
    processes.push(host)
    const key = (await host.waitFor(/HACKVAULT_PUBLIC_KEY=([0-9a-f]{64})/))[1]
    await host.waitFor(/Host is serving encrypted vault replication/)

    const compiledCli = resolve('dist/cli.js')
    const originalCwd = process.cwd()
    let first: CliProcess
    try {
      process.chdir(nestedCwd)
      first = new CliProcess([compiledCli, 'join', key, '--data-dir', peerDataDir], env, process.execPath)
    } finally {
      process.chdir(originalCwd)
    }
    processes.push(first)
    await first.waitFor(/Connected to vault/)
    first.send('add alpha first-secret')
    await first.waitFor(/Added: alpha/)
    await first.waitFor(/Vault updated: alpha/)
    assert.match(await readFile(join(projectRoot, '.env'), 'utf8'), /^alpha=first-secret$/m)
    await assert.rejects(readFile(join(peerDataDir, '.env'), 'utf8'), { code: 'ENOENT' })
    first.send('list')
    await first.waitFor(/alpha/)
    first.send('get alpha')
    await first.waitFor(/alpha=first-secret/)
    assert.equal(host.output.includes('first-secret'), false)
  } finally {
    for (const process of processes.reverse()) await process.stop()
    await persistentNode?.destroy().catch(() => undefined)
    await bootstrapper.destroy().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
