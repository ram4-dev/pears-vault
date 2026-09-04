/// <reference types="node" />
import assert from 'node:assert/strict'
import { Duplex } from 'node:stream'
import { test } from 'node:test'
import { createMux, MAX_FRAME_BYTES, RpcClient, serveRpc, waitForOpen } from '../src/protocol.js'

function linkedStreams(): [Duplex, Duplex] {
  let left: Duplex
  let right: Duplex
  left = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      right.push(chunk)
      callback()
    }
  })
  right = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      left.push(chunk)
      callback()
    }
  })
  return [left, right]
}

test('waitForOpen supports an emitted stream open event and timeout', async () => {
  const stream = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } }) as Duplex & {
    opened?: boolean
    connected?: boolean
  }
  const opening = waitForOpen(stream, 100)
  stream.emit('open')
  await opening

  const unopened = new Duplex({ read() {}, write(_chunk, _encoding, callback) { callback() } }) as Duplex & {
    opened?: boolean
    connected?: boolean
  }
  await assert.rejects(waitForOpen(unopened, 10), /connection timed out/)
  unopened.destroy()
  stream.destroy()
})

test('RPC client and server share one framed control stream', async () => {
  const [clientStream, serverStream] = linkedStreams()
  const serverMux = createMux(serverStream)
  const server = serveRpc(serverMux, async request => {
    if (request.type === 'fail') throw new Error('expected failure')
    return { type: request.type, value: request.value }
  })
  const client = new RpcClient(createMux(clientStream), clientStream)
  const events: unknown[] = []
  client.onNotification((_event, payload) => events.push(payload))

  assert.deepEqual(await client.request('echo', { value: 'ok' }), { type: 'echo', value: 'ok' })
  await assert.rejects(client.request('fail'), /expected failure/)
  server.notify('updated', { length: 3 })
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(events, [{ length: 3 }])

  client.close()
  server.close()
  clientStream.destroy()
  serverStream.destroy()
})

test('RPC requests enforce the shared frame limit', async () => {
  const [clientStream, serverStream] = linkedStreams()
  const server = serveRpc(createMux(serverStream), async () => undefined)
  const client = new RpcClient(createMux(clientStream), clientStream)
  await assert.rejects(client.request('oversized', { value: 'x'.repeat(MAX_FRAME_BYTES) }), /too large/)
  client.close()
  server.close()
  clientStream.destroy()
  serverStream.destroy()
})
