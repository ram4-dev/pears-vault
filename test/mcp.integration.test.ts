/// <reference types="node" />
/// <reference path="./vendor.d.ts" />
import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import DHT from 'hyperdht'
import { startHost } from '../src/host.js'

async function getFreeUdpPort(): Promise<number> {
  const socket = createSocket('udp4')
  await new Promise<void>((resolveBind, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', resolveBind)
  })
  const address = socket.address()
  await new Promise<void>((resolveClose) => socket.close(() => resolveClose()))
  return address.port
}

test(
  'MCP stdio tools use a persistent vault peer',
  {
    timeout: 30_000
  },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'pears-vault-mcp-'))
    const bootstrapper = DHT.bootstrapper(await getFreeUdpPort(), '127.0.0.1')
    let host: Awaited<ReturnType<typeof startHost>> | undefined
    let client: Client | undefined

    try {
      await bootstrapper.fullyBootstrapped()
      const bootstrap = `127.0.0.1:${bootstrapper.address().port}`
      host = await startHost({
        dataDir: join(root, 'host'),
        bootstrap: [{ host: '127.0.0.1', port: bootstrapper.address().port }],
        log: () => undefined
      })

      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [resolve('dist/cli.js'), 'mcp', host.publicKey, '--data-dir', join(root, 'peer')],
        env: {
          PATH: process.env.PATH ?? '',
          PEARS_VAULT_BOOTSTRAP: bootstrap
        },
        stderr: 'pipe'
      })
      client = new Client({ name: 'pears-vault-test', version: '1.0.0' })
      await client.connect(transport)

      const { tools } = await client.listTools()
      assert.deepEqual(tools.map((tool) => tool.name).sort(), ['add_secret', 'list_secrets', 'sync_status'])

      await client.callTool({
        name: 'add_secret',
        arguments: { name: 'api.token', value: 'mcp-secret' }
      })
      const listed = await client.callTool({
        name: 'list_secrets',
        arguments: {}
      })
      assert.match(JSON.stringify(listed.structuredContent), /api\.token/)
      assert.doesNotMatch(JSON.stringify(listed), /mcp-secret/)
      const status = await client.callTool({
        name: 'sync_status',
        arguments: {}
      })
      assert.match(JSON.stringify(status.structuredContent), /"fullySynced":true/)
    } finally {
      await client?.close().catch(() => undefined)
      await host?.close().catch(() => undefined)
      await bootstrapper.destroy().catch(() => undefined)
      await rm(root, { recursive: true, force: true })
    }
  }
)
