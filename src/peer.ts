/// <reference types="node" />
import { join } from 'node:path'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { decryptSecret, encryptSecret, validateEnvelope, validateVaultKey } from './crypto.js'
import { DotEnvMirror } from './env.js'
import { createPeerSession, type PeerSessionConnection } from './peer-session.js'
import { createMux, RpcClient } from './protocol.js'
import { downloadCoreCopy, parseLengthReceipt } from './replication.js'
import { ensureDataDir } from './storage.js'
import { type BootstrapNode, parsePublicKey, validateSecretName } from './validation.js'

export { joinContext } from './context-peer.js'

export interface VaultUpdate {
  name: string
  length: number
  deleted: boolean
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
  envPath?: string
  envPollIntervalMs?: number
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
  delete: (name: string) => Promise<void>
  reconcileEnv: () => Promise<void>
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
  if (!Number.isInteger(hello.length) || (hello.length as number) < 0) {
    throw new Error('Host returned an invalid core length')
  }
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

function parseUpdate(value: unknown): VaultUpdate {
  if (!value || typeof value !== 'object') throw new Error('Host sent an invalid vault update')
  const update = value as Record<string, unknown>
  validateSecretName(update.name)
  if (!Number.isInteger(update.length) || (update.length as number) < 0) {
    throw new Error('Host sent an invalid vault update length')
  }
  if (typeof update.deleted !== 'boolean') throw new Error('Host sent an invalid vault update operation')
  return { name: update.name, length: update.length as number, deleted: update.deleted }
}

export async function joinVault(publicKeyHex: string, options: PeerOptions): Promise<VaultPeer> {
  const publicKey = parsePublicKey(publicKeyHex)
  await ensureDataDir(options.dataDir)
  const timeoutMs = options.syncTimeoutMs ?? 15_000
  const envPath = options.envPath ?? join(options.dataDir, '.env')
  const envMirror = new DotEnvMirror(envPath, join(options.dataDir, 'env-snapshot.json'))
  await envMirror.ready()

  let core: any
  let bee: any
  let rpc: RpcClient | undefined
  let vaultKey: Buffer
  let remoteLength = 0
  let lastSyncedAt: string | null = null
  let backgroundSyncError: Error | null = null
  let syncQueue: Promise<void> = Promise.resolve()
  let reconcileEnv: () => Promise<void> = async () => undefined
  let onRestored: () => Promise<void> = async () => undefined

  const session = createPeerSession({
    publicKey,
    bootstrap: options.bootstrap,
    label: 'vault',
    connectionTimeoutMs: options.connectionTimeoutMs,
    connectionAttemptTimeoutMs: options.connectionAttemptTimeoutMs,
    connectionRetryDelayMs: options.connectionRetryDelayMs,
    connectionFailureMessage: `Unable to reach the vault host after connection attempts. Keep 'hackvault host start' running and wait for 'Host is serving...' before joining. Verify both peers use the same --bootstrap setting.`,
    bootstrappingMessage: 'Bootstrapping HyperDHT…',
    onConnectionStatus: options.onConnectionStatus
  })

  const readVaultValues = async (): Promise<Map<string, string>> => {
    const values = new Map<string, string>()
    for await (const node of bee.createReadStream()) {
      const envelope = parseStoredEnvelope(node.value)
      validateEnvelope(envelope)
      values.set(node.key, decryptSecret(node.key, envelope, vaultKey))
    }
    return values
  }

  const syncThrough = async (expected: number): Promise<void> => {
    remoteLength = Math.max(remoteLength, expected)
    await downloadCoreCopy(core, remoteLength, timeoutMs)
    backgroundSyncError = null
    lastSyncedAt = new Date().toISOString()
  }

  const applyVaultUpdate = async (update: VaultUpdate): Promise<void> => {
    if (update.deleted) {
      await envMirror.applyVaultDelete(update.name)
      return
    }
    const node = await bee.get(update.name)
    if (!node) throw new Error(`Vault update is missing key ${update.name}`)
    const envelope = parseStoredEnvelope(node.value)
    validateEnvelope(envelope)
    await envMirror.applyVaultUpsert(update.name, decryptSecret(update.name, envelope, vaultKey))
  }

  const scheduleSync = (update: VaultUpdate): void => {
    remoteLength = Math.max(remoteLength, update.length)
    syncQueue = syncQueue
      .then(async () => {
        await syncThrough(update.length)
        await applyVaultUpdate(update)
        options.onUpdate?.(update)
      })
      .catch(error => {
        backgroundSyncError = error instanceof Error ? error : new Error('Background vault sync failed')
        options.onSyncError?.(backgroundSyncError)
      })
  }

  session.addDomain({
    restore: async ({ socket, mux }: PeerSessionConnection) => {
      const nextRpc = new RpcClient(mux, socket)
      const hello = parseHello(await nextRpc.request('hello'))
      const nextVaultKey = Buffer.from(hello.vaultKey, 'hex')
      if (core === undefined) {
        vaultKey = nextVaultKey
        core = new Hypercore(join(options.dataDir, 'hypercore'), Buffer.from(hello.coreKey, 'hex'))
        await core.ready()
        bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'utf-8' })
        await bee.ready()
      } else if (core.key.toString('hex') !== hello.coreKey || vaultKey.toString('hex') !== nextVaultKey.toString('hex')) {
        throw new Error('Host identity or vault key changed while reconnecting')
      }
      rpc = nextRpc
      nextRpc.onNotification((event, payload) => {
        if (event !== 'updated') return
        try {
          scheduleSync(parseUpdate(payload))
        } catch (error) {
          backgroundSyncError = error instanceof Error ? error : new Error('Invalid background vault update')
          options.onSyncError?.(backgroundSyncError)
        }
      })
      core.replicate(mux)
      const replication = await nextRpc.request('replicate-ready')
      await syncThrough(parseLengthReceipt(replication, 'replication receipt'))
      await onRestored()
    },
    disconnect: error => {
      rpc?.close()
      rpc = undefined
      syncQueue = Promise.resolve()
      backgroundSyncError = error
    }
  })

  const upsertRemote = async (name: string, value: string): Promise<void> => {
    validateSecretName(name)
    if (!rpc) throw new Error('Vault peer is disconnected')
    const envelope = encryptSecret(name, value, vaultKey)
    const response = await rpc.request('put', { name, envelope })
    await syncThrough(parseLengthReceipt(response, 'write receipt'))
    await envMirror.applyVaultUpsert(name, value)
  }

  const deleteRemote = async (name: string): Promise<void> => {
    validateSecretName(name)
    if (!rpc) throw new Error('Vault peer is disconnected')
    const response = await rpc.request('delete', { name })
    await syncThrough(parseLengthReceipt(response, 'delete receipt'))
    await envMirror.applyVaultDelete(name)
  }

  reconcileEnv = async (): Promise<void> => {
    if (!rpc) return
    const changes = await envMirror.detectLocalChanges()
    for (const upsert of changes.upserts) await upsertRemote(upsert.name, upsert.value)
    for (const name of changes.deletes) await deleteRemote(name)
  }

  onRestored = async () => {
    await reconcileEnv()
    await envMirror.applyVaultSnapshot(await readVaultValues())
  }

  try {
    await session.start()
  } catch (error) {
    await bee?.close().catch(() => undefined)
    throw error
  }

  const syncStatus = async (): Promise<VaultSyncStatus> => {
    await syncQueue
    if (!rpc) {
      return {
        connected: false,
        dataDir: options.dataDir,
        localLength: core.length,
        remoteLength,
        fullySynced: core.length >= remoteLength && (remoteLength === 0 || await core.has(0, remoteLength)),
        lastSyncedAt,
        lastError: backgroundSyncError?.message ?? null
      }
    }
    await reconcileEnv()
    const statusResponse = await rpc.request('status')
    remoteLength = Math.max(remoteLength, parseLengthReceipt(statusResponse, 'sync status'))
    await core.update()
    try {
      await syncThrough(remoteLength)
      await envMirror.applyVaultSnapshot(await readVaultValues())
    } catch (error) {
      backgroundSyncError = error instanceof Error ? error : new Error('Vault sync failed')
      options.onSyncError?.(backgroundSyncError)
      throw backgroundSyncError
    }
    const fullySynced = core.length >= remoteLength && (remoteLength === 0 || (await core.has(0, remoteLength)))
    return {
      connected: true,
      dataDir: options.dataDir,
      localLength: core.length,
      remoteLength,
      fullySynced,
      lastSyncedAt,
      lastError: backgroundSyncError?.message ?? null
    }
  }

  const pollInterval = options.envPollIntervalMs ?? 2_000
  let watcherQueue: Promise<void> = Promise.resolve()
  const watcher = setInterval(() => {
    watcherQueue = watcherQueue.then(reconcileEnv).catch(error => {
      const syncError = error instanceof Error ? error : new Error('Local .env sync failed')
      backgroundSyncError = syncError
      options.onSyncError?.(syncError)
    })
  }, pollInterval)

  return {
    add: upsertRemote,
    delete: deleteRemote,
    reconcileEnv,
    list: async () => {
      if (rpc) await syncStatus()
      const names: string[] = []
      for await (const node of bee.createReadStream()) names.push(node.key)
      return names
    },
    get: async name => {
      validateSecretName(name)
      if (rpc) await syncStatus()
      const node = await bee.get(name)
      if (!node) return null
      const envelope = parseStoredEnvelope(node.value)
      validateEnvelope(envelope)
      return decryptSecret(name, envelope, vaultKey)
    },
    syncStatus,
    close: async () => {
      clearInterval(watcher)
      await watcherQueue
      await session.close()
      await bee.close()
    }
  }
}
