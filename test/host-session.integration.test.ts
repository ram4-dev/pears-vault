/// <reference types="node" />
/// <reference path="./vendor.d.ts" />
import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import DHT from 'hyperdht'
import { encryptSecret } from '../src/crypto.js'
import { startHost } from '../src/host.js'
import { createMux, RpcClient, waitForOpen } from '../src/protocol.js'

async function getFreeUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', resolve)
  })
  const address = socket.address()
  await new Promise<void>(resolve => socket.close(() => resolve()))
  return address.port
}

test('a raw control session performs the encrypted vault handshake and command path', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pears-vault-host-session-'))
  const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
  let host: Awaited<ReturnType<typeof startHost>> | undefined
  let clientDht: any
  let connection: any
  let rpc: RpcClient | undefined

  try {
    await bootstrapper.fullyBootstrapped()
    const bootstrap = [{ host: '127.0.0.1', port: bootstrapper.address().port }]
    host = await startHost({ dataDir: join(root, 'host'), bootstrap, log: () => undefined })
    clientDht = new DHT({ bootstrap })
    await clientDht.fullyBootstrapped()
    connection = clientDht.connect(Buffer.from(host.publicKey, 'hex'))
    await waitForOpen(connection)
    rpc = new RpcClient(createMux(connection), connection)

    const hello = await rpc.request('hello') as Record<string, unknown>
    assert.equal(hello.protocol, 1)
    assert.equal(typeof hello.coreKey, 'string')
    const vaultKey = Buffer.from(hello.vaultKey as string, 'hex')
    const receipt = await rpc.request('put', {
      name: 'RAW_SESSION',
      envelope: encryptSecret('RAW_SESSION', 'session-value', vaultKey)
    }) as Record<string, unknown>
    assert.equal(receipt.name, 'RAW_SESSION')
    assert.equal(receipt.deleted, false)
    assert.equal(typeof receipt.length, 'number')
    assert.deepEqual(await rpc.request('status'), { length: receipt.length })
  } finally {
    rpc?.close()
    connection?.destroy()
    await clientDht?.destroy().catch(() => undefined)
    await host?.close().catch(() => undefined)
    await bootstrapper.destroy().catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
