/// <reference types="node" />

import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import {
  decryptContextPayload,
  validateEnvelope,
  validateContextKey,
  type CiphertextEnvelope
} from './crypto.js'
import {
  MAX_CONTEXT_QUERY_LIMIT,
  parseContextEnvelope,
  parseContextReceipt,
  parseContextRecord,
  validateContextCommand,
  validateContextDeleteCommand,
  validateContextQuery,
  validateContextState,
  validateContextPublishInput,
  type ContextHello,
  type ContextPublishInput,
  type ContextPublishResult,
  type ContextReceipt,
  type ContextRecord,
  type ContextCurrentRecord,
  type ContextDeleteCommand,
  type ContextQuery,
  type ContextRecordSummary,
  type ContextState,
  type ContextSyncStatus
} from './context.js'
import { CONTEXT_PROTOCOL, RpcClient } from './protocol.js'
import { createPeerSession, type PeerSessionConnection } from './peer-session.js'
import { downloadCoreCopy, parseLengthReceipt } from './replication.js'
import { contextCorePath } from './paths.js'
import { ContextProjection } from './context-projection.js'
import { ensureDataDir, loadOrCreatePeerIdentity } from './storage.js'
import { type BootstrapNode, parsePublicKey } from './validation.js'

export interface ContextPeerOptions {
  dataDir: string
  projectRoot?: string
  projectionPath?: string
  bootstrap?: BootstrapNode[]
  syncTimeoutMs?: number
  connectionTimeoutMs?: number
  connectionAttemptTimeoutMs?: number
  connectionRetryDelayMs?: number
  onConnectionStatus?: (message: string) => void
  onSyncError?: (error: Error) => void
}

export interface ContextPeer {
  publish: (input: ContextPublishInput) => Promise<ContextPublishResult>
  supersede: (input: ContextPublishInput & { supersedes: string[] }) => Promise<ContextPublishResult>
  delete: (id: string, operationId: string) => Promise<ContextReceipt>
  list: (query?: ContextQuery) => Promise<ContextRecordSummary[]>
  get: (id: string) => Promise<ContextCurrentRecord | null>
  syncStatus: () => Promise<ContextSyncStatus>
  close: () => Promise<void>
}

function parseHello(value: unknown): ContextHello {
  if (!value || typeof value !== 'object') throw new Error('Host returned an invalid context handshake')
  const hello = value as Record<string, unknown>
  if (hello.protocol !== 1) throw new Error('Host uses an unsupported context protocol version')
  if (typeof hello.coreKey !== 'string') throw new Error('Host returned an invalid context Hypercore key')
  if (typeof hello.contextKey !== 'string') throw new Error('Host returned an invalid context key')
  if (!Number.isInteger(hello.length) || (hello.length as number) < 0) throw new Error('Host returned an invalid context core length')
  const coreKey = parsePublicKey(hello.coreKey)
  const contextKey = Buffer.from(hello.contextKey, 'hex')
  validateContextKey(contextKey)
  return {
    protocol: 1,
    coreKey: coreKey.toString('hex'),
    contextKey: contextKey.toString('hex'),
    length: hello.length as number
  }
}

function parseStoredEnvelope(value: unknown): CiphertextEnvelope {
  if (typeof value !== 'string') throw new Error('Stored context record is not encoded as text')
  const envelope = parseContextEnvelope(value)
  validateEnvelope(envelope)
  return envelope
}

const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

function validateRecordId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !RECORD_ID_RE.test(id)) throw new Error('Context record id is invalid')
}

export async function joinContext(publicKeyHex: string, options: ContextPeerOptions): Promise<ContextPeer> {
  const publicKey = parsePublicKey(publicKeyHex)
  await ensureDataDir(options.dataDir)
  const peerId = await loadOrCreatePeerIdentity(options.dataDir)
  const timeoutMs = options.syncTimeoutMs ?? 15_000
  const projection = options.projectionPath
    ? new ContextProjection(options.projectionPath, true)
    : options.projectRoot
      ? new ContextProjection(options.projectRoot)
      : undefined

  let core: any
  let bee: any
  let rpc: RpcClient | undefined
  let contextKey: Buffer
  let remoteLength = 0
  let lastSyncedAt: string | null = null
  let lastError: Error | null = null
  let syncQueue: Promise<void> = Promise.resolve()

  const session = createPeerSession({
    publicKey,
    bootstrap: options.bootstrap,
    label: 'context host',
    connectionTimeoutMs: options.connectionTimeoutMs,
    connectionAttemptTimeoutMs: options.connectionAttemptTimeoutMs,
    connectionRetryDelayMs: options.connectionRetryDelayMs,
    bootstrappingMessage: 'Bootstrapping HyperDHT for context…',
    onConnectionStatus: options.onConnectionStatus
  })

  const readState = async (id: string): Promise<ContextState> => {
    const node = await bee.get(`state/${id}`)
    if (!node) return { id, supersededBy: [] }
    const envelope = parseStoredEnvelope(node.value)
    const decoded = JSON.parse(decryptContextPayload(`state/${id}`, envelope, contextKey)) as unknown
    validateContextState(decoded)
    if (decoded.id !== id) throw new Error(`Context state ${id} has an inconsistent identity`)
    return decoded
  }

  const readRecord = async (id: string): Promise<ContextCurrentRecord | null> => {
    validateRecordId(id)
    const node = await bee.get(`record/${id}`)
    if (!node) return null
    const envelope = parseStoredEnvelope(node.value)
    const decoded = parseContextRecord(decryptContextPayload(`record/${id}`, envelope, contextKey))
    if (decoded.id !== id) throw new Error(`Context record ${id} has an inconsistent identity`)
    return { ...decoded, state: await readState(id) }
  }

  const readRecords = async (): Promise<ContextCurrentRecord[]> => {
    const records: ContextCurrentRecord[] = []
    for await (const node of bee.createReadStream()) {
      if (typeof node.key !== 'string' || !node.key.startsWith('record/')) continue
      const record = await readRecord(node.key.slice('record/'.length))
      if (record) records.push(record)
    }
    records.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt) || a.id.localeCompare(b.id))
    return records
  }

  const syncThrough = async (expected: number): Promise<void> => {
    remoteLength = Math.max(remoteLength, expected)
    await downloadCoreCopy(core, remoteLength, timeoutMs)
    if (projection) await projection.refresh(await readRecords(), remoteLength)
    lastError = null
    lastSyncedAt = new Date().toISOString()
  }

  const scheduleSync = (value: unknown): void => {
    const receipt = parseContextReceipt(value)
    remoteLength = Math.max(remoteLength, receipt.length)
    syncQueue = syncQueue.then(
      async () => { await syncThrough(receipt.length) },
      async () => { await syncThrough(receipt.length) }
    ).catch(error => {
      lastError = error instanceof Error ? error : new Error('Background context sync failed')
      options.onSyncError?.(lastError)
    })
  }

  session.addDomain({
    restore: async ({ socket, mux }: PeerSessionConnection) => {
      const nextRpc = new RpcClient(mux, socket, CONTEXT_PROTOCOL)
      const hello = parseHello(await nextRpc.request('context-hello'))
      const nextContextKey = Buffer.from(hello.contextKey, 'hex')
      if (core === undefined) {
        contextKey = nextContextKey
        core = new Hypercore(contextCorePath(options.dataDir), Buffer.from(hello.coreKey, 'hex'))
        await core.ready()
        bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'utf-8' })
        await bee.ready()
      } else if (core.key.toString('hex') !== hello.coreKey || contextKey.toString('hex') !== nextContextKey.toString('hex')) {
        throw new Error('Host identity or context key changed while reconnecting')
      }
      rpc = nextRpc
      nextRpc.onNotification((event, payload) => {
        if (event !== 'updated' && event !== 'context-updated') return
        try {
          scheduleSync(payload)
        } catch (error) {
          lastError = error instanceof Error ? error : new Error('Invalid background context update')
          options.onSyncError?.(lastError)
        }
      })
      core.replicate(mux)
      const replication = await nextRpc.request('context-replicate-ready')
      await syncThrough(parseLengthReceipt(replication, 'context replication receipt'))
    },
    disconnect: error => {
      rpc?.close()
      rpc = undefined
      syncQueue = Promise.resolve()
      lastError = error
    }
  })

  try {
    await session.start()
  } catch (error) {
    await bee?.close().catch(() => undefined)
    throw error
  }

  const syncStatus = async (): Promise<ContextSyncStatus> => {
    await syncQueue
    if (!rpc) {
      return {
        connected: false,
        dataDir: options.dataDir,
        localLength: core.length,
        remoteLength,
        fullySynced: core.length >= remoteLength && (remoteLength === 0 || await core.has(0, remoteLength)),
        lastSyncedAt,
        lastError: lastError?.message ?? null,
        reconnectAttempts: session.reconnectAttempts
      }
    }
    const response = await rpc.request('context-status')
    remoteLength = Math.max(remoteLength, parseLengthReceipt(response, 'context sync status'))
    await core.update()
    try {
      await syncThrough(remoteLength)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Context sync failed')
      options.onSyncError?.(lastError)
      throw lastError
    }
    return {
      connected: true,
      dataDir: options.dataDir,
      localLength: core.length,
      remoteLength,
      fullySynced: core.length >= remoteLength && (remoteLength === 0 || (await core.has(0, remoteLength))),
      lastSyncedAt,
      lastError: lastError?.message ?? null,
      reconnectAttempts: session.reconnectAttempts
    }
  }

  const publish = async (input: ContextPublishInput): Promise<ContextPublishResult> => {
    validateContextPublishInput(input)
    if (!rpc) throw new Error('Context peer is disconnected')
    const response = parseContextReceipt(await rpc.request('context-append', { command: { ...input, peerId } }))
    await syncThrough(response.length)
    const record = await readRecord(response.id)
    if (!record) throw new Error(`Context write receipt is missing record ${response.id}`)
    const { state: _state, ...canonicalRecord } = record
    return { ...response, record: canonicalRecord }
  }

  const supersede = async (input: ContextPublishInput & { supersedes: string[] }): Promise<ContextPublishResult> => {
    validateContextCommand({ ...input, peerId })
    if (!rpc) throw new Error('Context peer is disconnected')
    const response = parseContextReceipt(await rpc.request('context-append', {
      command: { ...input, peerId }
    }))
    await syncThrough(response.length)
    const record = await readRecord(response.id)
    if (!record) throw new Error(`Context supersession receipt is missing record ${response.id}`)
    const { state: _state, ...canonicalRecord } = record
    return { ...response, record: canonicalRecord }
  }

  const remove = async (id: string, operationId: string): Promise<ContextReceipt> => {
    validateRecordId(id)
    const command: ContextDeleteCommand = { schema: 1, operationId, peerId, id }
    validateContextDeleteCommand(command)
    if (!rpc) throw new Error('Context peer is disconnected')
    const response = parseContextReceipt(await rpc.request('context-delete', { command }))
    await syncThrough(response.length)
    return response
  }

  const list = async (query: ContextQuery = {}): Promise<ContextRecordSummary[]> => {
    validateContextQuery(query)
    const records = await readRecords()
    const summaries = records
      .filter(record => query.scope === undefined || record.scope === query.scope)
      .filter(record => query.kind === undefined || record.kind === query.kind)
      .filter(record => query.includeDeleted === true || record.state.deletedAt === undefined)
      .map(record => ({
        id: record.id,
        scope: record.scope,
        kind: record.kind,
        title: record.title,
        author: record.author,
        ...(record.source === undefined ? {} : { source: record.source }),
        createdAt: record.createdAt,
        receivedAt: record.receivedAt,
        ...(record.supersedes === undefined ? {} : { supersedes: [...record.supersedes] }),
        supersededBy: [...record.state.supersededBy],
        ...(record.state.deletedAt === undefined ? {} : { deletedAt: record.state.deletedAt })
      }))
    return summaries.slice(0, query.limit ?? MAX_CONTEXT_QUERY_LIMIT)
  }

  return {
    publish,
    supersede,
    delete: remove,
    list,
    get: readRecord,
    syncStatus,
    close: async () => {
      await session.close()
      await bee.close()
      await projection?.waitForIdle()
    }
  }
}
