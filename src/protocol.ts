/// <reference types="node" />
import type { Duplex } from 'node:stream'
import c from 'compact-encoding'
import Protomux from 'protomux'

const CONTROL_PROTOCOL = 'pears-vault/control/1'
export const MAX_FRAME_BYTES = 256 * 1024

export interface RpcRequest {
  id: number
  type: string
  [key: string]: unknown
}

interface RpcResponse {
  kind: 'response'
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

interface RpcEvent {
  kind: 'event'
  event: string
  payload?: unknown
}

export interface RpcServer {
  notify: (event: string, payload?: unknown) => void
  close: () => void
}

export async function waitForOpen(stream: Duplex & { opened?: boolean }): Promise<void> {
  if (stream.opened) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      stream.off('open', onOpen)
      stream.off('error', onError)
    }
    const onOpen = (): void => {
      cleanup()
      resolve()
    }
    const onError = (error: Error): void => {
      cleanup()
      reject(error)
    }
    stream.once('open', onOpen)
    stream.once('error', onError)
  })
}

export function createMux(stream: Duplex): any {
  return Protomux.from(stream)
}

function assertFrame(value: unknown): void {
  let size: number
  try {
    size = Buffer.byteLength(JSON.stringify(value), 'utf8')
  } catch {
    throw new Error('Protocol message is not serializable')
  }
  if (size > MAX_FRAME_BYTES) throw new Error('Protocol message is too large')
}

export class RpcClient {
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private readonly notificationListeners = new Set<(event: string, payload: unknown) => void>()
  private readonly channel: any
  private readonly message: any
  private readonly opened: Promise<void>

  constructor(mux: any, stream: Duplex) {
    let resolveOpened: () => void
    this.opened = new Promise(resolve => { resolveOpened = resolve })
    this.channel = mux.createChannel({
      protocol: CONTROL_PROTOCOL,
      onopen: () => resolveOpened()
    })
    if (!this.channel) throw new Error('PEARS VAULT control channel is already open')
    this.message = this.channel.addMessage({
      encoding: c.json,
      onmessage: (value: unknown) => this.onMessage(value)
    })
    stream.once('close', () => this.rejectAll(new Error('Host connection closed')))
    stream.once('error', error => this.rejectAll(error))
    this.channel.open()
  }

  async request(type: string, fields: Record<string, unknown> = {}): Promise<unknown> {
    await this.opened
    const id = this.nextId++
    const request = { kind: 'request', id, type, ...fields }
    assertFrame(request)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try {
        this.message.send(request)
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  onNotification(listener: (event: string, payload: unknown) => void): () => void {
    this.notificationListeners.add(listener)
    return () => this.notificationListeners.delete(listener)
  }

  close(): void {
    this.channel.close()
  }

  private onMessage(value: unknown): void {
    assertFrame(value)
    if (!value || typeof value !== 'object') return
    const message = value as RpcResponse | RpcEvent
    if (message.kind === 'event') {
      if (typeof message.event !== 'string') return
      for (const listener of this.notificationListeners) listener(message.event, message.payload)
      return
    }
    if (message.kind !== 'response' || !Number.isInteger(message.id) || typeof message.ok !== 'boolean') return
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.ok) pending.resolve(message.result)
    else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Host request failed'))
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

export function serveRpc(mux: any, handler: (request: RpcRequest) => Promise<unknown>): RpcServer {
  const channel = mux.createChannel({ protocol: CONTROL_PROTOCOL })
  if (!channel) throw new Error('PEARS VAULT control channel is already open')
  const message = channel.addMessage({
    encoding: c.json,
    onmessage: async (value: unknown) => {
      assertFrame(value)
      if (!value || typeof value !== 'object') return
      const request = value as RpcRequest & { kind?: string }
      if (request.kind !== 'request' || !Number.isInteger(request.id) || request.id < 1 || typeof request.type !== 'string') {
        return
      }
      try {
        const result = await handler(request)
        const response = { kind: 'response', id: request.id, ok: true, result }
        assertFrame(response)
        message.send(response)
      } catch (error) {
        const response = {
          kind: 'response',
          id: request.id,
          ok: false,
          error: error instanceof Error ? error.message : 'Request failed'
        }
        assertFrame(response)
        message.send(response)
      }
    }
  })
  channel.open()

  return {
    notify: (event, payload) => {
      const notification = { kind: 'event', event, payload }
      assertFrame(notification)
      message.send(notification)
    },
    close: () => channel.close()
  }
}
