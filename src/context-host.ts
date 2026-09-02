/// <reference types="node" />

import type { Duplex } from 'node:stream'
import { randomUUID } from 'node:crypto'
import b4a from 'b4a'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { decryptContextPayload, encryptContextPayload, validateEnvelope } from './crypto.js'
import {
  CONTEXT_SCHEMA_VERSION,
  parseContextEnvelope,
  parseContextReceipt,
  validateContextCommand,
  validateContextRecord,
  type ContextHello,
  type ContextReceipt,
  type ContextRecord,
  type ContextCommand
} from './context.js'
import { CONTEXT_PROTOCOL, createMux, serveRpc, type RpcRequest } from './protocol.js'
import type { RpcServer } from './shared/transport.js'
import { contextCorePath } from './paths.js'
import { ensureDataDir, loadOrCreateContextKey } from './storage.js'

export interface ContextHostSession {
  notify(event: string, payload: unknown): void
  close(): void
}

export interface ContextHostOptions {
  socket: Duplex
  mux?: any
  core: any
  hello: () => ContextHello
  appendContext: (command: ContextCommand) => Promise<ContextReceipt>
}

function parseStored(value: string, message: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(message)
  }
}

export function attachContextHostSession(options: ContextHostOptions): ContextHostSession {
  const mux = options.mux ?? createMux(options.socket)
  let replicationAttached = false
  let closed = false
  let rpc: RpcServer
  const handler = async (request: RpcRequest): Promise<unknown> => {
    if (request.type === 'hello' || request.type === 'context-hello') return options.hello()
    if (request.type === 'replicate-ready' || request.type === 'context-replicate-ready') {
      if (!replicationAttached) {
        replicationAttached = true
        options.core.replicate(mux)
      }
      return { length: options.core.length }
    }
    if (request.type === 'status' || request.type === 'context-status') return { length: options.core.length }
    if (request.type === 'append' || request.type === 'context-append') {
      validateContextCommand(request.command)
      return options.appendContext(request.command)
    }
    throw new Error(`Unsupported context request type: ${request.type}`)
  }
  rpc = serveRpc(mux, handler, CONTEXT_PROTOCOL)
  const cleanup = (): void => {
    if (closed) return
    closed = true
    rpc.close()
  }
  options.socket.once('close', cleanup)
  options.socket.once('error', cleanup)
  return {
    notify: (event, payload) => {
      if (!closed) rpc.notify(event, payload)
    },
    close: () => {
      if (closed) return
      cleanup()
      options.socket.destroy()
    }
  }
}

export interface ContextHost {
  contextKey: Buffer
  core: any
  coreKey: string
  hello: () => ContextHello
  appendContext: (command: ContextCommand) => Promise<ContextReceipt>
  close: () => Promise<void>
}

export async function openContextHost(options: {
  dataDir: string
  onUpdate?: (receipt: ContextReceipt) => void
}): Promise<ContextHost> {
  await ensureDataDir(options.dataDir)
  const contextKey = await loadOrCreateContextKey(options.dataDir)
  const core = new Hypercore(contextCorePath(options.dataDir))
  const bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'utf-8' })
  await bee.ready()
  let contextWriteQueue: Promise<unknown> = Promise.resolve()

  const recordKey = (id: string): string => `record/${id}`
  const operationKey = (operationId: string): string => `operation/${operationId}`
  const sealed = (key: string, value: unknown): string =>
    JSON.stringify(encryptContextPayload(key, JSON.stringify(value), contextKey))

  const appendContext = async (command: ContextCommand): Promise<ContextReceipt> => {
    validateContextCommand(command)
    const work = contextWriteQueue.then(() => append(), () => append())
    contextWriteQueue = work.then(() => undefined, () => undefined)
    return work

    async function append(): Promise<ContextReceipt> {
      const existing = await bee.get(operationKey(command.operationId))
      if (existing) {
        const envelope = parseContextEnvelope(existing.value)
        validateEnvelope(envelope)
        const receipt = parseContextReceipt(parseStored(
          decryptContextPayload(operationKey(command.operationId), envelope, contextKey),
          'Stored context receipt is corrupted'
        ))
        if (receipt.operationId !== command.operationId) throw new Error('Stored context operation receipt is inconsistent')
        return { ...receipt, deduplicated: true }
      }

      const receivedAt = new Date().toISOString()
      const record: ContextRecord = {
        ...command,
        id: randomUUID(),
        createdAt: command.createdAt ?? receivedAt,
        receivedAt,
        schema: CONTEXT_SCHEMA_VERSION
      }
      validateContextRecord(record)
      await bee.put(recordKey(record.id), sealed(recordKey(record.id), record))
      await bee.put(`index/scope/${encodeURIComponent(record.scope)}/${record.id}`, record.id)
      await bee.put(`index/kind/${record.kind}/${record.id}`, record.id)
      await bee.put(`index/updated/${encodeURIComponent(record.receivedAt)}/${record.id}`, record.id)

      const receipt: ContextReceipt = {
        operationId: command.operationId,
        id: record.id,
        length: core.length,
        deduplicated: false
      }
      await bee.put(operationKey(command.operationId), JSON.stringify(encryptContextPayload(
        operationKey(command.operationId),
        JSON.stringify(receipt),
        contextKey
      )))
      options.onUpdate?.(receipt)
      return receipt
    }
  }

  const hello = (): ContextHello => ({
    protocol: 1,
    coreKey: b4a.toString(core.key, 'hex'),
    contextKey: contextKey.toString('hex'),
    length: core.length
  })

  return {
    contextKey,
    core,
    coreKey: b4a.toString(core.key, 'hex'),
    hello,
    appendContext,
    close: async () => {
      await contextWriteQueue
      await bee.close()
    }
  }
}
