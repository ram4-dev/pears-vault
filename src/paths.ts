/// <reference types="node" />
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

function findProjectRoot(cwd: string): string {
  let current = resolve(cwd)
  while (true) {
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

export function defaultHostEnvPath(cwd = process.cwd()): string {
  return join(findProjectRoot(cwd), '.env')
}

export function defaultPeerDataDir(publicKey: string, cwd = process.cwd(), home = homedir()): string {
  const projectRoot = findProjectRoot(cwd)
  const identity = createHash('sha256').update(projectRoot).update('\0').update(publicKey).digest('hex').slice(0, 20)
  return join(home, '.pears-vault', 'peers', identity)
}
