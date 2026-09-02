/// <reference types="node" />
import type { Duplex } from 'node:stream'
import { decryptSecret, validateEnvelope, type CiphertextEnvelope } from './crypto.js'
import { createMux, serveRpc, type RpcRequest } from './protocol.js'
import type { RpcServer } from './shared/transport.js'
import { validateSecretName } from './validation.js'

export interface VaultHello {
  protocol: number
  coreKey: string
  vaultKey: string
  length: number
}

export interface HostSession {
  notify(event: string, payload: unknown): void
  close(): void
}

export interface HostSessionOptions {
  socket: Duplex
  core: any
  hello: () => VaultHello
  upsertVault: (name: string, encoded: string, plaintext: string) => Promise<number>
  deleteVault: (name: string) => Promise<number>
  /** The vault key is used only to validate/decrypt a peer's submitted envelope. */
  vaultKey?: Buffer
  /** Allows callers to provide the existing vault decryptor without exposing key ownership. */
  decryptVault?: (name: string, envelope: CiphertextEnvelope) => string
}

function decodeEnvelope(
  name: string,
  value: unknown,
  options: HostSessionOptions
): { envelope: CiphertextEnvelope; plaintext: string } {
  validateEnvelope(value)
  const envelope = value
  const plaintext = options.decryptVault
    ? options.decryptVault(name, envelope)
    : options.vaultKey
      ? decryptSecret(name, envelope, options.vaultKey)
      : (() => {
          throw new Error('Host session has no vault decryption key')
        })()
  return { envelope, plaintext }
}

export function attachHostSession(options: HostSessionOptions): HostSession {
  const mux = createMux(options.socket)
  let replicationAttached = false
  let closed = false
  let rpc: RpcServer

  const handler = async (request: RpcRequest): Promise<unknown> => {
    if (request.type === 'hello') return options.hello()

    if (request.type === 'replicate-ready') {
      if (!replicationAttached) {
        replicationAttached = true
        options.core.replicate(mux)
      }
      return { length: options.core.length }
    }

    if (request.type === 'status') return { length: options.core.length }

    if (request.type === 'put') {
      validateSecretName(request.name)
      const name = request.name
      const { envelope, plaintext } = decodeEnvelope(name, request.envelope, options)
      const length = await options.upsertVault(name, JSON.stringify(envelope), plaintext)
      return { name, length, deleted: false }
    }

    if (request.type === 'delete') {
      validateSecretName(request.name)
      const name = request.name
      const length = await options.deleteVault(name)
      return { name, length, deleted: true }
    }

    throw new Error(`Unsupported request type: ${request.type}`)
  }

  rpc = serveRpc(mux, handler)
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
