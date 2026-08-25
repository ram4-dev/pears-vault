/// <reference types="node" />
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { joinVault, type PeerOptions, type VaultPeer } from './peer.js'

function toolResult(value: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value
  }
}

export function createVaultMcpServer(peer: VaultPeer): McpServer {
  const server = new McpServer({ name: 'pears-vault', version: '0.1.0' })

  server.registerTool(
    'add_secret',
    {
      description: 'Encrypt and store a secret in the connected vault.',
      inputSchema: {
        name: z.string().min(1),
        value: z.string()
      }
    },
    async ({ name, value }) => {
      await peer.add(name, value)
      return toolResult({ stored: true, name })
    }
  )

  server.registerTool(
    'list_secrets',
    {
      description: 'List secret key names only. Secret values are never returned.',
      inputSchema: {}
    },
    async () => toolResult({ names: await peer.list() })
  )

  server.registerTool(
    'sync_status',
    {
      description: 'Synchronize the local encrypted peer copy and return its status.',
      inputSchema: {}
    },
    async () => toolResult({ ...(await peer.syncStatus()) })
  )

  return server
}

export async function runVaultMcpServer(publicKey: string, options: PeerOptions): Promise<void> {
  const peer = await joinVault(publicKey, options)
  const server = createVaultMcpServer(peer)
  const transport = new StdioServerTransport()
  let resolveClosed: (() => void) | undefined
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve
  })
  transport.onclose = () => resolveClosed?.()

  const stop = (): void => {
    void server.close().catch(() => resolveClosed?.())
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  try {
    await server.connect(transport)
    await closed
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    await server.close().catch(() => undefined)
    await peer.close()
  }
}
