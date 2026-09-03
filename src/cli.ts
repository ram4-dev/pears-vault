#!/usr/bin/env node
/// <reference types="node" />
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { installContextSkill } from './context-skill.js'
import { startContextWatch } from './context-watch.js'
import {
  decodeContextPublishInput,
  validateContextQuery,
  validateContextSupersedeInput,
  type ContextKind,
  type ContextPublishInput,
  type ContextQuery
} from './context.js'
import { joinContext, type ContextPeer } from './context-peer.js'
import { startHost } from './host.js'
import { defaultContextPeerDataDir, defaultHostEnvPath, defaultPeerDataDir, findProjectRoot } from './paths.js'
import { joinVault, type VaultPeer } from './peer.js'
import { parseBootstrap, parsePublicKey } from './validation.js'

function usage(): string {
  return `HACKVAULT

Usage:
  hackvault host start [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault join <public-key> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault sync <public-key> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault add <public-key> <name> <value> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault list <public-key> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault get <public-key> <name> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault context sync <public-key> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault context list <public-key> [--scope <scope>] [--kind <kind>] [--limit <n>]
  hackvault context get <public-key> <record-id> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault context add <public-key> <publish-json> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault context supersede <public-key> <publish-json> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault context delete <public-key> <record-id> <operation-id> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault context watch <public-key> [--data-dir <path>] [--bootstrap <host:port,...>]
  hackvault context skill install [--project-dir <path>]

Join commands:
  add <name> <value>   Encrypt and store a secret
  list                 List secret names
  get <name>           Decrypt and print one secret
  help                 Show commands
  exit                 Disconnect
`
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
  args.splice(index, 2)
  return value
}

function printJoinHelp(): void {
  console.log('Commands: add <name> <value> | list | get <name> | help | exit')
}

async function executeJoinCommand(peer: VaultPeer, line: string): Promise<boolean> {
  const command = line.trim()
  if (!command) return true
  if (command === 'exit' || command === 'quit') return false
  if (command === 'help') {
    printJoinHelp()
    return true
  }
  if (command === 'list') {
    const names = await peer.list()
    console.log(names.length === 0 ? '(empty)' : names.join('\n'))
    return true
  }
  if (command.startsWith('get ')) {
    const name = command.slice(4).trim()
    const value = await peer.get(name)
    console.log(value === null ? `Secret not found: ${name}` : `${name}=${value}`)
    return true
  }
  if (command.startsWith('add ')) {
    const match = /^add\s+(\S+)\s+(.+)$/.exec(command)
    if (!match) throw new Error('Usage: add <name> <value>')
    await peer.add(match[1], match[2])
    console.log(`Added: ${match[1]}`)
    return true
  }
  throw new Error(`Unknown command: ${command.split(/\s+/, 1)[0]}`)
}

async function runJoinRepl(peer: VaultPeer): Promise<void> {
  printJoinHelp()
  const terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY)
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal,
    prompt: 'hackvault> '
  })
  if (terminal) rl.prompt()

  for await (const line of rl) {
    try {
      const shouldContinue = await executeJoinCommand(peer, line)
      if (!shouldContinue) break
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : 'Command failed'}`)
    }
    if (terminal) rl.prompt()
  }
  rl.close()
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, context: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${context} timed out after ${timeoutMs}ms`)), timeoutMs)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function withProgrammaticPeer<T>(
  publicKey: string,
  dataDir: string,
  bootstrap: ReturnType<typeof parseBootstrap>,
  action: (peer: VaultPeer) => Promise<T>
): Promise<T> {
  const peer = await joinVault(publicKey, {
    dataDir,
    envPath: defaultHostEnvPath(),
    bootstrap,
    connectionTimeoutMs: 20_000,
    connectionAttemptTimeoutMs: 5_000,
    connectionRetryDelayMs: 500,
    syncTimeoutMs: 15_000,
    onConnectionStatus: message => console.error(message),
    onSyncError: error => console.error(`Sync error: ${error.message}`)
  })
  try {
    return await withTimeout(action(peer), 15_000, 'Vault command')
  } finally {
    await peer.close()
  }
}

async function withProgrammaticContextPeer<T>(
  publicKey: string,
  dataDir: string,
  projectRoot: string,
  bootstrap: ReturnType<typeof parseBootstrap>,
  action: (peer: ContextPeer) => Promise<T>
): Promise<T> {
  const peer = await joinContext(publicKey, {
    dataDir,
    projectRoot,
    bootstrap,
    connectionTimeoutMs: 20_000,
    connectionAttemptTimeoutMs: 5_000,
    connectionRetryDelayMs: 500,
    syncTimeoutMs: 15_000,
    onConnectionStatus: message => console.error(message),
    onSyncError: error => console.error(`Context sync error: ${error.message}`)
  })
  try {
    return await withTimeout(action(peer), 15_000, 'Context command')
  } finally {
    await peer.close()
  }
}

function decodeJsonArgument(value: string, context: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch (error) {
    throw new Error(`${context} must be valid JSON`, { cause: error })
  }
}

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const args = [...argv]
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    console.log(usage())
    return
  }
  const dataDirOption = takeOption(args, '--data-dir')
  const bootstrapOption = takeOption(args, '--bootstrap') ?? process.env.HACKVAULT_BOOTSTRAP ?? process.env.PEARS_VAULT_BOOTSTRAP
  const bootstrap = parseBootstrap(bootstrapOption)

  if (args[0] === 'host' && args[1] === 'start' && args.length === 2) {
    const dataDir = dataDirOption ?? join(homedir(), '.pears-vault', 'host')
    const envPath = dataDirOption ? join(dataDir, '.env') : defaultHostEnvPath()
    const host = await startHost({ dataDir, envPath, bootstrap })
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
    await host.close()
    return
  }

  if (args[0] === 'join' && args[1] && args.length === 2) {
    const publicKey = args[1]
    parsePublicKey(publicKey)
    const dataDir = dataDirOption ?? defaultPeerDataDir(publicKey)
    const peer = await joinVault(publicKey, {
      dataDir,
      envPath: defaultHostEnvPath(),
      bootstrap,
      onConnectionStatus: (message) => console.log(message),
      onUpdate: ({ name }) => console.log(`Vault updated: ${name}`),
      onSyncError: (error) => console.error(`Live sync error: ${error.message}`)
    })
    console.log(`Connected to vault ${publicKey.slice(0, 12)}…`)
    try {
      await runJoinRepl(peer)
    } finally {
      await peer.close()
    }
    return
  }

  if (args[0] === 'add' && args[1] && args[2] && args[3] !== undefined && args.length === 4) {
    const publicKey = args[1]
    parsePublicKey(publicKey)
    const name = args[2]
    const value = args[3]
    const dataDir = dataDirOption ?? defaultPeerDataDir(publicKey)
    const result = await withProgrammaticPeer(publicKey, dataDir, bootstrap, async peer => {
      await peer.add(name, value)
      return { ok: true, name }
    })
    console.log(JSON.stringify(result))
    return
  }

  if (args[0] === 'list' && args[1] && args.length === 2) {
    const publicKey = args[1]
    parsePublicKey(publicKey)
    const dataDir = dataDirOption ?? defaultPeerDataDir(publicKey)
    const names = await withProgrammaticPeer(publicKey, dataDir, bootstrap, peer => peer.list())
    console.log(JSON.stringify(names))
    return
  }

  if (args[0] === 'get' && args[1] && args[2] && args.length === 3) {
    const publicKey = args[1]
    parsePublicKey(publicKey)
    const name = args[2]
    const dataDir = dataDirOption ?? defaultPeerDataDir(publicKey)
    const value = await withProgrammaticPeer(publicKey, dataDir, bootstrap, peer => peer.get(name))
    console.log(JSON.stringify({ name, value }))
    return
  }

  if (args[0] === 'sync' && args[1] && args.length === 2) {
    const publicKey = args[1]
    parsePublicKey(publicKey)
    const dataDir = dataDirOption ?? defaultPeerDataDir(publicKey)
    const peer = await joinVault(publicKey, {
      dataDir,
      envPath: defaultHostEnvPath(),
      bootstrap,
      onConnectionStatus: (message) => console.error(message),
      onSyncError: (error) => console.error(`Sync error: ${error.message}`)
    })
    try {
      console.log(JSON.stringify(await peer.syncStatus()))
    } finally {
      await peer.close()
    }
    return
  }

  if (args[0] === 'context' && args[1] === 'skill' && args[2] === 'install') {
    const projectDir = takeOption(args, '--project-dir') ?? process.cwd()
    if (args.length !== 3) throw new Error(usage())
    const path = await installContextSkill(projectDir)
    console.log(JSON.stringify({ ok: true, path }))
    return
  }

  if (args[0] === 'context' && args[1] === 'watch' && args[2] && args.length === 3) {
    const publicKey = args[2]
    parsePublicKey(publicKey)
    const dataDir = dataDirOption
    const watch = await startContextWatch(publicKey, {
      dataDir,
      bootstrap,
      onConnectionStatus: message => console.error(message),
      onSyncError: error => console.error(`Watch sync error: ${error.message}`)
    })
    await new Promise<void>((resolve) => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
    await watch.close()
    return
  }

  if (args[0] === 'context' && args[1] && args[2] && args[2].length > 0) {
    const projectRoot = findProjectRoot()
    const command = args[1]
    const publicKey = args[2]
    parsePublicKey(publicKey)
    const dataDir = dataDirOption ?? defaultContextPeerDataDir(publicKey, process.cwd())

    if (command === 'sync' && args.length === 3) {
      const status = await withProgrammaticContextPeer(publicKey, dataDir, projectRoot, bootstrap, peer => peer.syncStatus())
      console.log(JSON.stringify(status))
      return
    }

    if (command === 'list' && args.length >= 3) {
      const scope = takeOption(args, '--scope')
      const kind = takeOption(args, '--kind') as ContextKind | undefined
      const limitValue = takeOption(args, '--limit')
      const limit = limitValue === undefined ? undefined : Number(limitValue)
      const query: ContextQuery = { scope, kind, limit }
      validateContextQuery(query)
      if (args.length !== 3) throw new Error(usage())
      const records = await withProgrammaticContextPeer(publicKey, dataDir, projectRoot, bootstrap, async peer => {
        await peer.syncStatus()
        return peer.list(query)
      })
      console.log(JSON.stringify(records))
      return
    }

    if (command === 'get' && args[3] && args.length === 4) {
      const id = args[3]
      const record = await withProgrammaticContextPeer(publicKey, dataDir, projectRoot, bootstrap, async peer => {
        await peer.syncStatus()
        return peer.get(id)
      })
      console.log(JSON.stringify(record))
      return
    }

    if ((command === 'add' || command === 'supersede') && args[3] && args.length === 4) {
      const raw = decodeJsonArgument(args[3], `context ${command} input`)
      let input: ContextPublishInput & { supersedes?: string[] }
      if (command === 'add') {
        const encoded = JSON.stringify(raw)
        input = decodeContextPublishInput(encoded)
      } else {
        validateContextSupersedeInput(raw)
        input = raw as ContextPublishInput & { supersedes: string[] }
      }
      const result = await withProgrammaticContextPeer(publicKey, dataDir, projectRoot, bootstrap, peer =>
        command === 'add' ? peer.publish(input) : peer.supersede(input as ContextPublishInput & { supersedes: string[] })
      )
      console.log(JSON.stringify(result))
      return
    }

    if (command === 'delete' && args[3] && args[4] && args.length === 5) {
      const result = await withProgrammaticContextPeer(publicKey, dataDir, projectRoot, bootstrap, peer =>
        peer.delete(args[3], args[4])
      )
      console.log(JSON.stringify(result))
      return
    }
  }

  throw new Error(usage())
}

function isEntryPoint(): boolean {
  try {
    return Boolean(process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}