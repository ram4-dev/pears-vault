/// <reference types="node" />
import { join } from 'node:path'
import DHT from 'hyperdht'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { decryptSecret, encryptSecret, validateEnvelope, validateVaultKey } from './crypto.js'
import { CONTROL_CHANNEL, REPLICATION_CHANNEL, RpcClient, selectChannel, waitForOpen } from './protocol.js'
import { ensureDataDir } from './storage.js'
import { type BootstrapNode, parsePublicKey, validateSecretName } from './validation.js'

export interface PeerOptions {
  dataDir: string
  bootstrap?: BootstrapNode[]
  syncTimeoutMs?: number
}

interface HelloResponse {
  protocol: number
  coreKey: string
  vaultKey: string
  length: number
}

export interface VaultPeer {
  add: (name: string, value: string) => Promise<void>
  list: () => Promise<string[]>
  get: (name: string) => Promise<string | null>
  close: () => Promise<void>
}

function parseHello(value: unknown): HelloResponse {
  if (!value || typeof value !== 'object') throw new Error('Host returned an invalid handshake')
  const hello = value as Record<string, unknown>
  if (hello.protocol !== 1) throw new Error('Host uses an unsupported protocol version')
  if (typeof hello.coreKey !== 'string') throw new Error('Host returned an invalid Hypercore key')
  if (typeof hello.vaultKey !== 'string') throw new Error('Host returned an invalid vault key')
  if (!Number.isInteger(hello.length) || (hello.length as number) < 0) throw new Error('Host returned an invalid core length')
  parsePublicKey(hello.coreKey)
  const vaultKey = Buffer.from(hello.vaultKey, 'hex')
  validateVaultKey(vaultKey)
  return hello as unknown as HelloResponse
}

function parseStoredEnvelope(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('Stored ciphertext envelope is corrupted')
  }
}

async function waitForLength(core: any, expected: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (core.length < expected) {
    await core.update()
    if (core.length >= expected) return
    if (Date.now() >= deadline) throw new Error(`Timed out while syncing vault (have ${core.length}, need ${expected})`)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

export async function joinVault(publicKeyHex: string, options: PeerOptions): Promise<VaultPeer> {
  const publicKey = parsePublicKey(publicKeyHex)
  await ensureDataDir(options.dataDir)
  const dht = new DHT(options.bootstrap ? { bootstrap: options.bootstrap } : undefined)
  const timeoutMs = options.syncTimeoutMs ?? 15_000

  const control = dht.connect(publicKey)
  await waitForOpen(control)
  selectChannel(control, CONTROL_CHANNEL)
  const rpc = new RpcClient(control)
  const hello = parseHello(await rpc.request('hello'))
  const vaultKey = Buffer.from(hello.vaultKey, 'hex')

  const core = new Hypercore(join(options.dataDir, 'hypercore'), Buffer.from(hello.coreKey, 'hex'))
  await core.ready()
  const bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'utf-8' })

  const replication = dht.connect(publicKey)
  await waitForOpen(replication)
  selectChannel(replication, REPLICATION_CHANNEL)
  core.replicate(replication)

  await waitForLength(core, hello.length, timeoutMs)
  await bee.ready()

  const sync = async (expected = core.length): Promise<void> => {
    await core.update()
    await waitForLength(core, expected, timeoutMs)
  }

  return {
    add: async (name, value) => {
      validateSecretName(name)
      const envelope = encryptSecret(name, value, vaultKey)
      const response = await rpc.request('put', { name, envelope }) as Record<string, unknown>
      if (!response || !Number.isInteger(response.length)) throw new Error('Host returned an invalid write receipt')
      await sync(response.length as number)
    },
    list: async () => {
      await sync()
      const names: string[] = []
      for await (const node of bee.createReadStream()) names.push(node.key)
      return names
    },
    get: async name => {
      validateSecretName(name)
      await sync()
      const node = await bee.get(name)
      if (!node) return null
      const envelope = parseStoredEnvelope(node.value)
      validateEnvelope(envelope)
      return decryptSecret(name, envelope, vaultKey)
    },
    close: async () => {
      rpc.close()
      replication.destroy()
      await bee.close()
      await dht.destroy()
    }
  }
}
