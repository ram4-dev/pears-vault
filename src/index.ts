export { startHost } from './host.js'
export { joinVault } from './peer.js'
export { joinContext } from './context-peer.js'
export { createContextProjection, ContextProjection } from './context-projection.js'
export * from './context.js'
export type {
  HostOptions,
  VaultHost
} from './host.js'
export type {
  PeerOptions,
  VaultPeer,
  VaultSyncStatus,
  VaultUpdate
} from './peer.js'
export type {
  ContextPeer,
  ContextPeerOptions
} from './context-peer.js'
