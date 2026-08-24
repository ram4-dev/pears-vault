#!/usr/bin/env node
/// <reference types="node" />
import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { startHost } from './host.js'
import { joinVault, type VaultPeer } from './peer.js'
import { parseBootstrap, parsePublicKey } from './validation.js'

function usage(): string {
  return `PEARS VAULT M0

Usage:
  pears-vault host start [--data-dir <path>] [--bootstrap <host:port,...>]
  pears-vault join <public-key> [--data-dir <path>] [--bootstrap <host:port,...>]

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
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal, prompt: 'pears-vault> ' })
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

export async function runCli(argv = process.argv.slice(2)): Promise<void> {
  const args = [...argv]
  const dataDirOption = takeOption(args, '--data-dir')
  const bootstrapOption = takeOption(args, '--bootstrap') ?? process.env.PEARS_VAULT_BOOTSTRAP
  const bootstrap = parseBootstrap(bootstrapOption)

  if (args[0] === 'host' && args[1] === 'start' && args.length === 2) {
    const dataDir = dataDirOption ?? join(homedir(), '.pears-vault', 'host')
    const host = await startHost({ dataDir, bootstrap })
    await new Promise<void>(resolve => {
      process.once('SIGINT', resolve)
      process.once('SIGTERM', resolve)
    })
    await host.close()
    return
  }

  if (args[0] === 'join' && args[1] && args.length === 2) {
    const publicKey = args[1]
    parsePublicKey(publicKey)
    const dataDir = dataDirOption ?? join(homedir(), '.pears-vault', 'peers', publicKey.slice(0, 16))
    const peer = await joinVault(publicKey, {
      dataDir,
      bootstrap,
      onUpdate: ({ name }) => console.log(`Vault updated: ${name}`),
      onSyncError: error => console.error(`Live sync error: ${error.message}`)
    })
    console.log(`Connected to vault ${publicKey.slice(0, 12)}…`)
    try {
      await runJoinRepl(peer)
    } finally {
      await peer.close()
    }
    return
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
  runCli().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
}
