/// <reference types="node" />
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export function findProjectRoot(cwd = process.cwd()): string {
  let current = resolve(cwd)
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

export function defaultHostEnvPath(cwd = process.cwd()): string {
  return projectEnvPath(findProjectRoot(cwd))
}

export function projectEnvPath(projectRoot: string): string {
  return join(projectRoot, '.env')
}

export function peerStorageIdentity(projectRoot: string, hostPublicKey: string): string {
  return createHash('sha256').update(projectRoot).update('\0').update(hostPublicKey).digest('hex').slice(0, 20)
}

export function defaultPeerDataDir(publicKey: string, cwd = process.cwd(), home = homedir()): string {
  return join(home, '.pears-vault', 'peers', peerStorageIdentity(findProjectRoot(cwd), publicKey))
}

export function contextStorageIdentity(projectRoot: string, hostPublicKey: string): string {
  return createHash('sha256')
    .update('context-v1')
    .update('\0')
    .update(projectRoot)
    .update('\0')
    .update(hostPublicKey)
    .digest('hex')
    .slice(0, 20)
}

export function defaultContextPeerDataDir(publicKey: string, cwd = process.cwd(), home = homedir()): string {
  return join(home, '.pears-vault', 'context-peers', contextStorageIdentity(findProjectRoot(cwd), publicKey))
}

export function contextCorePath(dataDir: string): string {
  return join(dataDir, 'context-hypercore')
}

export function contextProjectionPath(projectRoot: string): string {
  return join(projectRoot, '.pears-context')
}
