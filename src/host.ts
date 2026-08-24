/// <reference types="node" />
import { join } from 'node:path'
import b4a from 'b4a'
import DHT from 'hyperdht'
import Hypercore from 'hypercore'
import Hyperbee from 'hyperbee'
import { validateEnvelope } from './crypto.js'
import {
  CONTROL_CHANNEL,
  REPLICATION_CHANNEL,
  readChannel,
  serveRpc,
  type RpcRequest
} from './protocol.js'
import { ensureDataDir, loadOrCreateDhtKeyPair, loadOrCreateVaultKey } from './storage.js'
import { type BootstrapNode, validateSecretName } from './validation.js'

export interface HostOptions {
  dataDir: string
  bootstrap?: BootstrapNode[]
  log?: (message: string) => void
}

export interface VaultHost {
  publicKey: string
  coreKey: string
  close: () => Promise<void>
}

function serializeEnvelope(value: unknown): string {
  validateEnvelope(value)
  return JSON.stringify(value)
}

export async function startHost(options: HostOptions): Promise<VaultHost> {
  const log = options.log ?? console.log
  await ensureDataDir(options.dataDir)
  const keyPair = await loadOrCreateDhtKeyPair(options.dataDir)
  const vaultKey = await loadOrCreateVaultKey(options.dataDir)

  const core = new Hypercore(join(options.dataDir, 'hypercore'))
  const bee = new Hyperbee(core, { keyEncoding: 'utf-8', valueEncoding: 'utf-8' })
  await bee.ready()

  const dht = new DHT(options.bootstrap ? { bootstrap: options.bootstrap } : undefined)
  const sockets = new Set<any>()
  let writeQueue: Promise<unknown> = Promise.resolve()

  const handleRequest = async (request: RpcRequest): Promise<unknown> => {
    if (request.type === 'hello') {
      return {
        protocol: 1,
        coreKey: b4a.toString(core.key, 'hex'),
        vaultKey: vaultKey.toString('hex'),
        length: core.length
      }
    }

    if (request.type === 'put') {
      validateSecretName(request.name)
      const encoded = serializeEnvelope(request.envelope)
      writeQueue = writeQueue.then(async () => {
        await bee.put(request.name, encoded)
        return core.length
      })
      const length = await writeQueue
      return { name: request.name, length }
    }

    throw new Error(`Unsupported request type: ${request.type}`)
  }

  const server = dht.createServer(async (socket: any) => {
    sockets.add(socket)
    socket.once('close', () => sockets.delete(socket))
    socket.once('error', () => sockets.delete(socket))

    try {
      const channel = await readChannel(socket)
      if (channel === CONTROL_CHANNEL) {
        serveRpc(socket, handleRequest)
        return
      }
      if (channel === REPLICATION_CHANNEL) {
        core.replicate(socket)
        return
      }
      socket.destroy(new Error('Unknown PEARS VAULT channel'))
    } catch (error) {
      socket.destroy(error as Error)
    }
  })

  await server.listen(keyPair)
  const publicKey = b4a.toString(keyPair.publicKey, 'hex')
  const coreKey = b4a.toString(core.key, 'hex')
  log(`PEARS_VAULT_PUBLIC_KEY=${publicKey}`)
  log(`Vault data: ${options.dataDir}`)
  log('Host is serving encrypted vault replication and peer write requests.')

  return {
    publicKey,
    coreKey,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await server.close()
      await dht.destroy()
      await bee.close()
    }
  }
}
