/// <reference types="node" />

import type { ContextSyncStatus } from './context.js'
import { joinContext, type ContextPeer } from './context-peer.js'
import { defaultContextPeerDataDir } from './paths.js'
import { type BootstrapNode } from './validation.js'

export interface ContextWatchOptions {
  dataDir?: string
  projectDir?: string
  bootstrap?: BootstrapNode[]
  onStatus?: (status: ContextWatchStatus) => void
  onConnectionStatus?: (message: string) => void
  onSyncError?: (error: Error) => void
  connectionTimeoutMs?: number
  connectionAttemptTimeoutMs?: number
  connectionRetryDelayMs?: number
}

export interface ContextWatchStatus {
  connected: boolean
  localLength: number
  remoteLength: number
  fullySynced: boolean
  lastSyncedAt: string | null
  lastError: string | null
  reconnectAttempts: number
}

export interface ContextWatch {
  close: () => Promise<void>
}

function statusLine(status: ContextWatchStatus): string {
  return JSON.stringify({
    ok: status.fullySynced && status.connected,
    connected: status.connected,
    localLength: status.localLength,
    remoteLength: status.remoteLength,
    fullySynced: status.fullySynced,
    lastSyncedAt: status.lastSyncedAt,
    lastError: status.lastError,
    reconnectAttempts: status.reconnectAttempts
  })
}

function emit(onStatus: ((status: ContextWatchStatus) => void) | undefined, status: ContextWatchStatus): void {
  onStatus?.(status)
  console.log(statusLine(status))
}

function toWatchStatus(status: ContextSyncStatus): ContextWatchStatus {
  return {
    connected: status.connected,
    localLength: status.localLength,
    remoteLength: status.remoteLength,
    fullySynced: status.fullySynced,
    lastSyncedAt: status.lastSyncedAt,
    lastError: status.lastError,
    reconnectAttempts: status.reconnectAttempts
  }
}

function statusOnError(): ContextWatchStatus {
  return {
    connected: false,
    localLength: 0,
    remoteLength: 0,
    fullySynced: false,
    lastSyncedAt: null,
    lastError: 'Sync error',
    reconnectAttempts: 0
  }
}

export async function startContextWatch(publicKey: string, options: ContextWatchOptions): Promise<ContextWatch> {
  const dataDir = options.dataDir ?? defaultContextPeerDataDir(publicKey, process.cwd())

  const peer = await joinContext(publicKey, {
    dataDir,
    projectRoot: options.projectDir,
    bootstrap: options.bootstrap,
    connectionTimeoutMs: options.connectionTimeoutMs,
    connectionAttemptTimeoutMs: options.connectionAttemptTimeoutMs,
    connectionRetryDelayMs: options.connectionRetryDelayMs,
    onConnectionStatus: options.onConnectionStatus,
    onSyncError: options.onSyncError,
    onSync: (status: ContextSyncStatus) => {
      emit(options.onStatus, toWatchStatus(status))
    }
  })

  // After joinContext returns the first sync has happened and onSync already
  // printed a status line.  Wait for any queued sync to finish, then emit
  // a stable status line so callers get a clean initial snapshot.
  await peer.syncStatus()
  const initialStatus = toWatchStatus(await peer.syncStatus())
  emit(options.onStatus, initialStatus)

  // Periodic status poll as a fallback when notifications are missed.
  let pollTimer: NodeJS.Timeout | undefined
  let pollTimeout: NodeJS.Timeout | undefined

  const poll = async (): Promise<void> => {
    try {
      const status = await peer.syncStatus()
      emit(options.onStatus, toWatchStatus(status))
    } catch {
      emit(options.onStatus, statusOnError())
    } finally {
      pollTimeout = setTimeout(poll, 5_000)
    }
  }

  pollTimer = setInterval(() => {}, 30_000)
  pollTimeout = setTimeout(poll, 5_000)

  return {
    close: async () => {
      clearInterval(pollTimer)
      clearTimeout(pollTimeout)
      await peer.close()
    }
  }
}