/// <reference types="node" />
import { join } from 'node:path'
import b4a from 'b4a'
import DHT from 'hyperdht'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { decryptSecret, encryptSecret, validateEnvelope } from './crypto.js'
import { DotEnvMirror, type EnvChanges } from './env.js'
import { attachHostSession, type HostSession } from './host-session.js'
import { ensureDataDir, loadOrCreateDhtKeyPair, loadOrCreateVaultKey } from './storage.js'
import { type BootstrapNode, validateSecretName } from './validation.js'

export interface HostOptions {
  dataDir: string
  bootstrap?: BootstrapNode[]
  envPath?: string
  envPollIntervalMs?: number
  log?: (message: string) => void
}

export interface VaultHost {
  publicKey: string
  coreKey: string
  close: () => Promise<void>
}

function parseStoredEnvelope(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error('Stored ciphertext envelope is corrupted')
  }
}

export async function startHost(options: HostOptions): Promise<VaultHost> {
  const log = options.log ?? console.log
  const envPath = options.envPath ?? join(options.dataDir, '.env')
  await ensureDataDir(options.dataDir)
  const envMirror = new DotEnvMirror(envPath, join(options.dataDir, 'env-snapshot.json'))
  await envMirror.ready()
  const keyPair = await loadOrCreateDhtKeyPair(options.dataDir)
  const publicKey = b4a.toString(keyPair.publicKey, 'hex')
  log(`HACKVAULT_PUBLIC_KEY=${publicKey}`)
  log('Starting vault storage and announcing on HyperDHT…')
  const vaultKey = await loadOrCreateVaultKey(options.dataDir)

  const core = new Hypercore(join(options.dataDir, 'hypercore'))
  const bee = new Hyperbee(core, {
    keyEncoding: 'utf-8',
    valueEncoding: 'utf-8'
  })
  await bee.ready()

  const readVaultValues = async (): Promise<Map<string, string>> => {
    const values = new Map<string, string>()
    for await (const node of bee.createReadStream()) {
      const envelope = parseStoredEnvelope(node.value)
      validateEnvelope(envelope)
      values.set(node.key, decryptSecret(node.key, envelope, vaultKey))
    }
    return values
  }

  const applyStartupEnvChanges = async (): Promise<void> => {
    const changes = await envMirror.detectLocalChanges()
    for (const upsert of changes.upserts) {
      validateSecretName(upsert.name)
      await bee.put(upsert.name, JSON.stringify(encryptSecret(upsert.name, upsert.value, vaultKey)))
      await envMirror.commitLocalChanges({ upserts: [upsert], deletes: [] })
    }
    for (const name of changes.deletes) {
      validateSecretName(name)
      await bee.del(name)
      await envMirror.commitLocalChanges({ upserts: [], deletes: [name] })
    }
    await envMirror.applyVaultSnapshot(await readVaultValues())
  }
  await applyStartupEnvChanges()

  const dht = new DHT(options.bootstrap ? { bootstrap: options.bootstrap } : undefined)
  const sessions = new Set<HostSession>()
  let writeQueue: Promise<unknown> = Promise.resolve()

  const broadcastUpdate = (name: string, length: number, deleted: boolean): void => {
    for (const session of sessions) {
      try {
        session.notify('updated', { name, length, deleted })
      } catch {
        sessions.delete(session)
      }
    }
  }

  const upsertVault = async (name: string, encoded: string, plaintext: string, updateEnv: boolean): Promise<number> => {
    writeQueue = writeQueue.then(async () => {
      const existing = await bee.get(name)
      if (existing) {
        const envelope = parseStoredEnvelope(existing.value)
        validateEnvelope(envelope)
        if (decryptSecret(name, envelope, vaultKey) === plaintext) {
          if (updateEnv) await envMirror.applyVaultUpsert(name, plaintext)
          return { length: core.length, changed: false }
        }
      }
      await bee.put(name, encoded)
      if (updateEnv) await envMirror.applyVaultUpsert(name, plaintext)
      return { length: core.length, changed: true }
    })
    const result = (await writeQueue) as { length: number; changed: boolean }
    if (result.changed) broadcastUpdate(name, result.length, false)
    return result.length
  }

  const deleteVault = async (name: string, updateEnv: boolean): Promise<number> => {
    writeQueue = writeQueue.then(async () => {
      const existing = await bee.get(name)
      if (!existing) {
        if (updateEnv) await envMirror.applyVaultDelete(name)
        return { length: core.length, changed: false }
      }
      await bee.del(name)
      if (updateEnv) await envMirror.applyVaultDelete(name)
      return { length: core.length, changed: true }
    })
    const result = (await writeQueue) as { length: number; changed: boolean }
    if (result.changed) broadcastUpdate(name, result.length, true)
    return result.length
  }

  const reconcileLocalEnv = async (): Promise<void> => {
    const changes: EnvChanges = await envMirror.detectLocalChanges()
    for (const upsert of changes.upserts) {
      validateSecretName(upsert.name)
      const encoded = JSON.stringify(encryptSecret(upsert.name, upsert.value, vaultKey))
      await upsertVault(upsert.name, encoded, upsert.value, false)
      await envMirror.commitLocalChanges({ upserts: [upsert], deletes: [] })
    }
    for (const name of changes.deletes) {
      validateSecretName(name)
      await deleteVault(name, false)
      await envMirror.commitLocalChanges({ upserts: [], deletes: [name] })
    }
  }

  const server = dht.createServer((socket: any) => {
    const session = attachHostSession({
      socket,
      core,
      hello: () => ({
        protocol: 1,
        coreKey: b4a.toString(core.key, 'hex'),
        vaultKey: vaultKey.toString('hex'),
        length: core.length
      }),
      vaultKey,
      upsertVault: (name, encoded, plaintext) => upsertVault(name, encoded, plaintext, true),
      deleteVault: name => deleteVault(name, true)
    })
    sessions.add(session)

    const cleanup = (): void => {
      sessions.delete(session)
    }
    socket.once('close', cleanup)
    socket.once('error', cleanup)
  })

  await server.listen(keyPair)
  const pollInterval = options.envPollIntervalMs ?? 2_000
  let watcherQueue: Promise<void> = Promise.resolve()
  const watcher = setInterval(() => {
    watcherQueue = watcherQueue.then(reconcileLocalEnv).catch((error) => {
      log(`Host .env sync error: ${error instanceof Error ? error.message : 'unknown error'}`)
    })
  }, pollInterval)

  const coreKey = b4a.toString(core.key, 'hex')
  log(`Vault data: ${options.dataDir}`)
  log(`Vault environment: ${envPath}`)
  log('Host is serving encrypted vault replication and peer write requests.')

  return {
    publicKey,
    coreKey,
    close: async () => {
      clearInterval(watcher)
      await watcherQueue
      for (const session of sessions) session.close()
      sessions.clear()
      await server.close()
      await dht.destroy()
      await bee.close()
    }
  }
}
