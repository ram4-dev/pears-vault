/// <reference types="node" />
import { join } from 'node:path'
import DHT from 'hyperdht'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { decryptSecret, encryptSecret, validateEnvelope, validateVaultKey } from './crypto.js'
import { createMux, RpcClient, waitForOpen } from './protocol.js'
import { ensureDataDir } from './storage.js'
import { type BootstrapNode, parsePublicKey, validateSecretName } from './validation.js'

export interface VaultUpdate {
  name: string
  length: number
}

export interface VaultSyncStatus {
  connected: boolean
  dataDir: string
  localLength: number
  remoteLength: number
  fullySynced: boolean
  lastSyncedAt: string | null
  lastError: string | null
}

export interface PeerOptions {
  dataDir: string
  bootstrap?: BootstrapNode[]
  syncTimeoutMs?: number
  connectionTimeoutMs?: number
  connectionAttemptTimeoutMs?: number
  connectionRetryDelayMs?: number
  onConnectionStatus?: (message: string) => void
  onUpdate?: (update: VaultUpdate) => void
  onSyncError?: (error: Error) => void
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
  syncStatus: () => Promise<VaultSyncStatus>
  close: () => Promise<void>
}

function parseHello(value: unknown): HelloResponse {
  if (!value || typeof value !== 'object') throw new Error('Host returned an invalid handshake')
  const hello = value as Record<string, unknown>
  if (hello.protocol !== 1) throw new Error('Host uses an unsupported protocol version')
  if (typeof hello.coreKey !== 'string') throw new Error('Host returned an invalid Hypercore key')
  if (typeof hello.vaultKey !== 'string') throw new Error('Host returned an invalid vault key')
  if (!Number.isInteger(hello.length) || (hello.length as number) < 0)
    throw new Error('Host returned an invalid core length')
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

function parseLength(value: unknown, context: string): number {
  if (!value || typeof value !== 'object' || !Number.isInteger((value as Record<string, unknown>).length)) {
    throw new Error(`Host returned an invalid ${context}`)
  }
  return (value as Record<string, unknown>).length as number
}

function parseUpdate(value: unknown): VaultUpdate {
  if (!value || typeof value !== 'object') throw new Error('Host sent an invalid vault update')
  const update = value as Record<string, unknown>
  validateSecretName(update.name)
  if (!Number.isInteger(update.length) || (update.length as number) < 0) {
    throw new Error('Host sent an invalid vault update length')
  }
  return { name: update.name, length: update.length as number }
}

async function waitForLength(core: any, expected: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (core.length < expected) {
    const remaining = deadline - Date.now()
    if (remaining <= 0) {
      throw new Error(`Timed out while syncing vault (have ${core.length}, need ${expected})`)
    }

    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        core.off('append', onAppend)
      }
      const onAppend = (): void => {
        cleanup()
        resolve()
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new Error(`Timed out while syncing vault (have ${core.length}, need ${expected})`))
      }, remaining)

      core.once('append', onAppend)
      core.update().then(
        () => {
          if (core.length >= expected) onAppend()
        },
        (error: Error) => {
          cleanup()
          reject(error)
        }
      )
    })
  }
}

async function downloadLocalCopy(core: any, expected: number, timeoutMs: number): Promise<void> {
  await waitForLength(core, expected, timeoutMs)
  if (expected === 0) return
  const range = core.download({ start: 0, end: expected })
  let timer: NodeJS.Timeout | undefined
  try {
    await Promise.race([
      range.done(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out downloading local vault copy through block ${expected}`)),
          timeoutMs
        )
      })
    ])
  } catch (error) {
    range.destroy()
    throw error
  } finally {
    if (timer) clearTimeout(timer)
  }
  if (!(await core.has(0, expected))) {
    throw new Error(`Local vault copy is incomplete through block ${expected}`)
  }
}

async function connectWithRetry(dht: any, publicKey: Buffer, options: PeerOptions): Promise<any> {
  const totalTimeoutMs = options.connectionTimeoutMs ?? 45_000
  const attemptTimeoutMs = options.connectionAttemptTimeoutMs ?? 10_000
  const retryDelayMs = options.connectionRetryDelayMs ?? 1_000
  const deadline = Date.now() + totalTimeoutMs
  let attempt = 0
  let lastError = 'connection timed out'

  while (Date.now() < deadline) {
    attempt++
    options.onConnectionStatus?.(`Connecting to vault (attempt ${attempt})…`)
    const connection = dht.connect(publicKey)
    try {
      await waitForOpen(connection, Math.min(attemptTimeoutMs, deadline - Date.now()))
      return connection
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'connection failed'
      connection.destroy()
      if (Date.now() + retryDelayMs >= deadline) break
      options.onConnectionStatus?.(`Host not reachable yet; retrying in ${retryDelayMs}ms…`)
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }
  }

  throw new Error(
    `Unable to reach the vault host after ${attempt} attempts. Keep 'pears-vault host start' running and wait for 'Host is serving...' before joining. Verify both peers use the same --bootstrap setting. Last error: ${lastError}`
  )
}

export async function joinVault(publicKeyHex: string, options: PeerOptions): Promise<VaultPeer> {
  const publicKey = parsePublicKey(publicKeyHex)
  await ensureDataDir(options.dataDir)
  const dht = new DHT(options.bootstrap ? { bootstrap: options.bootstrap } : undefined)
  const timeoutMs = options.syncTimeoutMs ?? 15_000

  options.onConnectionStatus?.('Bootstrapping HyperDHT…')
  await dht.fullyBootstrapped()
  let connection: any
  try {
    connection = await connectWithRetry(dht, publicKey, options)
  } catch (error) {
    await dht.destroy()
    throw error
  }
  const mux = createMux(connection)
  const rpc = new RpcClient(mux, connection)
  const hello = parseHello(await rpc.request('hello'))
  const vaultKey = Buffer.from(hello.vaultKey, 'hex')

  const core = new Hypercore(join(options.dataDir, 'hypercore'), Buffer.from(hello.coreKey, 'hex'))
  await core.ready()
  const bee = new Hyperbee(core, {
    keyEncoding: 'utf-8',
    valueEncoding: 'utf-8'
  })
  core.replicate(mux)

  let syncQueue: Promise<void> = Promise.resolve()
  let backgroundSyncError: Error | null = null
  let remoteLength = hello.length
  let lastSyncedAt: string | null = null
  let connected = true
  const syncThrough = async (expected: number): Promise<void> => {
    remoteLength = Math.max(remoteLength, expected)
    await downloadLocalCopy(core, remoteLength, timeoutMs)
    backgroundSyncError = null
    lastSyncedAt = new Date().toISOString()
  }
  const scheduleSync = (update: VaultUpdate): void => {
    remoteLength = Math.max(remoteLength, update.length)
    syncQueue = syncQueue
      .then(async () => {
        await syncThrough(update.length)
        options.onUpdate?.(update)
      })
      .catch((error) => {
        backgroundSyncError = error instanceof Error ? error : new Error('Background vault sync failed')
        options.onSyncError?.(backgroundSyncError)
      })
  }

  rpc.onNotification((event, payload) => {
    if (event !== 'updated') return
    try {
      scheduleSync(parseUpdate(payload))
    } catch (error) {
      const syncError = error instanceof Error ? error : new Error('Invalid background vault update')
      backgroundSyncError = syncError
      options.onSyncError?.(syncError)
    }
  })

  const replication = await rpc.request('replicate-ready')
  await syncThrough(parseLength(replication, 'replication receipt'))
  await bee.ready()

  const syncStatus = async (): Promise<VaultSyncStatus> => {
    await syncQueue
    const statusResponse = await rpc.request('status')
    remoteLength = Math.max(remoteLength, parseLength(statusResponse, 'sync status'))
    await core.update()
    try {
      await syncThrough(remoteLength)
    } catch (error) {
      backgroundSyncError = error instanceof Error ? error : new Error('Vault sync failed')
      options.onSyncError?.(backgroundSyncError)
      throw backgroundSyncError
    }
    const fullySynced = core.length >= remoteLength && (remoteLength === 0 || (await core.has(0, remoteLength)))
    return {
      connected,
      dataDir: options.dataDir,
      localLength: core.length,
      remoteLength,
      fullySynced,
      lastSyncedAt,
      lastError: backgroundSyncError?.message ?? null
    }
  }

  return {
    add: async (name, value) => {
      validateSecretName(name)
      const envelope = encryptSecret(name, value, vaultKey)
      const response = await rpc.request('put', { name, envelope })
      await syncThrough(parseLength(response, 'write receipt'))
    },
    list: async () => {
      await syncStatus()
      const names: string[] = []
      for await (const node of bee.createReadStream()) names.push(node.key)
      return names
    },
    get: async (name) => {
      validateSecretName(name)
      await syncStatus()
      const node = await bee.get(name)
      if (!node) return null
      const envelope = parseStoredEnvelope(node.value)
      validateEnvelope(envelope)
      return decryptSecret(name, envelope, vaultKey)
    },
    syncStatus,
    close: async () => {
      connected = false
      rpc.close()
      connection.destroy()
      await bee.close()
      await dht.destroy()
    }
  }
}
