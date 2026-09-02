/// <reference types="node" />

import type { Duplex } from 'node:stream'
import DHT from 'hyperdht'
import { createMux, waitForOpen } from './protocol.js'
import type { BootstrapNode } from './validation.js'

export interface PeerSessionOptions {
  publicKey: Buffer
  bootstrap?: BootstrapNode[]
  label: string
  connectionTimeoutMs?: number
  connectionAttemptTimeoutMs?: number
  connectionRetryDelayMs?: number
  connectionFailureMessage?: string
  bootstrappingMessage?: string
  onConnectionStatus?: (message: string) => void
}

export interface PeerSessionConnection {
  socket: Duplex
  mux: any
}

export interface PeerSessionDomain {
  restore: (connection: PeerSessionConnection) => Promise<void>
  disconnect: (error: Error) => void
}

export interface PeerSession {
  readonly connected: boolean
  readonly reconnectAttempts: number
  addDomain: (domain: PeerSessionDomain) => void
  onState: (listener: (connected: boolean, error?: Error) => void) => () => void
  start: () => Promise<void>
  close: () => Promise<void>
}

export function createPeerSession(options: PeerSessionOptions): PeerSession {
  const dht = new DHT(options.bootstrap ? { bootstrap: options.bootstrap } : undefined)
  const domains = new Set<PeerSessionDomain>()
  const stateListeners = new Set<(connected: boolean, error?: Error) => void>()
  let activeSocket: any
  let connected = false
  let started = false
  let closing = false
  let reconnectAttempts = 0
  let reconnectPromise: Promise<void> | undefined
  let startPromise: Promise<void> | undefined

  const reportState = (next: boolean, error?: Error): void => {
    connected = next
    for (const listener of stateListeners) listener(next, error)
  }

  const disconnectDomains = (error: Error): void => {
    for (const domain of domains) {
      try {
        domain.disconnect(error)
      } catch {
        // A domain must not prevent the remaining domains from resetting.
      }
    }
  }

  const connect = async (initial: boolean): Promise<void> => {
    const totalTimeoutMs = options.connectionTimeoutMs ?? 45_000
    const attemptTimeoutMs = options.connectionAttemptTimeoutMs ?? 10_000
    const retryDelayMs = options.connectionRetryDelayMs ?? 1_000
    const deadline = initial ? Date.now() + totalTimeoutMs : undefined
    let attempt = 0
    let lastError = 'connection timed out'

    while (!closing && (deadline === undefined || Date.now() < deadline)) {
      attempt++
      if (!initial) reconnectAttempts++
      const suffix = initial ? ` (attempt ${attempt})` : ` (reconnect attempt ${attempt})`
      options.onConnectionStatus?.(`Connecting to ${options.label}${suffix}...`)
      const socket = dht.connect(options.publicKey)
      try {
        const remaining = deadline === undefined
          ? attemptTimeoutMs
          : Math.min(attemptTimeoutMs, Math.max(1, deadline - Date.now()))
        await waitForOpen(socket, remaining)
        const connection = { socket, mux: createMux(socket) }
        for (const domain of domains) await domain.restore(connection)
        if (closing) {
          socket.destroy()
          return
        }
        activeSocket = socket
        socket.once('close', () => onSocketClosed(socket, new Error(`${options.label} connection closed`)))
        socket.once('error', error => onSocketClosed(socket, error instanceof Error ? error : new Error('Peer connection failed')))
        reportState(true)
        options.onConnectionStatus?.(`Connected to ${options.label}.`)
        return
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'connection failed'
        disconnectDomains(error instanceof Error ? error : new Error(lastError))
        socket.destroy()
        if (initial && deadline !== undefined && Date.now() + retryDelayMs >= deadline) break
        if (closing) return
        const delay = initial ? retryDelayMs : Math.min(retryDelayMs * 2 ** Math.min(attempt - 1, 5), 30_000)
        options.onConnectionStatus?.(`${options.label} not reachable yet; retrying in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }

    throw new Error(options.connectionFailureMessage
      ? `${options.connectionFailureMessage} Last error: ${lastError}`
      : `Unable to reach the ${options.label} after ${attempt} attempts. Keep the host running and verify both peers use the same --bootstrap setting. Last error: ${lastError}`)
  }

  const reconnect = (): void => {
    if (closing || reconnectPromise) return
    reconnectPromise = connect(false)
      .catch(error => {
        if (!closing) {
          options.onConnectionStatus?.(`${options.label} reconnect failed: ${error instanceof Error ? error.message : 'connection failed'}`)
          reconnectPromise = undefined
          reconnect()
        }
      })
      .finally(() => {
        if (connected || closing) reconnectPromise = undefined
      })
  }

  const onSocketClosed = (socket: any, error: Error): void => {
    if (socket !== activeSocket || closing) return
    activeSocket = undefined
    reportState(false, error)
    disconnectDomains(error)
    options.onConnectionStatus?.(`${options.label} disconnected; reconnecting...`)
    reconnect()
  }

  const start = async (): Promise<void> => {
    if (startPromise) return startPromise
    started = true
    startPromise = (async () => {
      try {
        options.onConnectionStatus?.(options.bootstrappingMessage ?? 'Bootstrapping HyperDHT…')
        await dht.fullyBootstrapped()
        await connect(true)
      } catch (error) {
        await dht.destroy()
        throw error
      }
    })()
    return startPromise
  }

  return {
    get connected() {
      return connected
    },
    get reconnectAttempts() {
      return reconnectAttempts
    },
    addDomain: domain => {
      if (started) throw new Error('Peer session domains must be added before start')
      domains.add(domain)
    },
    onState: listener => {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
    start,
    close: async () => {
      if (closing) return
      closing = true
      reportState(false)
      const error = new Error('Peer session closed')
      disconnectDomains(error)
      activeSocket?.destroy()
      if (reconnectPromise) await reconnectPromise.catch(() => undefined)
      await dht.destroy()
    }
  }
}
