# PEARS VAULT

PEARS VAULT M2 is a CLI-first peer-to-peer secret vault built with Pear Runtime primitives. A host owns one persistent Hypercore/Hyperbee database; CLI and MCP peers keep a long-lived HyperDHT connection open, persist a complete encrypted local copy, and apply live updates without reconnecting.

## Install

```bash
npm install
npm run build
npm link
```

Node.js 22+ is supported. The runtime uses `hyperdht`, `hypercore`, `hyperbee`, `protomux`, `compact-encoding`, `b4a`, and `@modelcontextprotocol/sdk`.

## Host and interactive CLI

Start the host:

```bash
pears-vault host start
```

The host prints a 64-character share code immediately:

```text
PEARS_VAULT_PUBLIC_KEY=<share-code>
```

Keep that process running and wait for `Host is serving encrypted vault replication and peer write requests.` before connecting. The key exists before its DHT announcement is reachable.

Join interactively:

```bash
pears-vault join <share-code>
```

The interactive CLI remains connected and supports:

```text
add github.token ghp_example
list
get github.token
exit
```

`join` waits for DHT bootstrap and makes bounded connection retries. If it cannot connect, verify host readiness and that both processes use the same `--bootstrap` setting.

## Persistent local peer copy

Every peer uses a disk-backed read-only replica of the host Hypercore/Hyperbee. On first connection it downloads every existing block before reporting synchronization complete. While connected, each host append is downloaded and persisted automatically.

Unless `--data-dir` is supplied, peer storage is isolated under:

```text
~/.pears-vault/peers/<project-or-cwd-and-vault-hash>
```

The hash binds the nearest Git repository root (or current directory) and host public key, preventing unrelated projects or vaults from sharing storage.

Run a one-shot full synchronization and print JSON status:

```bash
pears-vault sync <share-code>
```

The status includes the local data directory, local and remote Hypercore lengths, whether every block is present, and the last successful synchronization time.

## MCP server

Start the persistent stdio MCP server with the host public key:

```bash
pears-vault mcp <share-code>
```

Or provide the key through the environment, which is convenient for MCP client configuration:

```bash
PEARS_VAULT_PUBLIC_KEY=<share-code> pears-vault mcp
```

Example MCP client configuration:

```json
{
  "mcpServers": {
    "pears-vault": {
      "command": "pears-vault",
      "args": ["mcp"],
      "env": {
        "PEARS_VAULT_PUBLIC_KEY": "<share-code>"
      }
    }
  }
}
```

The stdio server keeps one persistent vault peer alive and exposes exactly these tools:

- `add_secret(name, value)` — encrypt and store a value.
- `list_secrets()` — return secret key names only.
- `sync_status()` — synchronize the encrypted local copy and return status.

**There is intentionally no MCP tool for reading secret values.** The MCP layer never returns a stored secret value. Interactive CLI `get` remains available for a human-operated peer.

MCP protocol messages use stdout; connection and sync diagnostics use stderr so they cannot corrupt the stdio transport.

## Network options

Use explicit storage or bootstrap settings when needed:

```bash
pears-vault host start --data-dir /tmp/vault-host
pears-vault join <share-code> --data-dir /tmp/vault-peer
pears-vault sync <share-code> --bootstrap 127.0.0.1:49737
pears-vault mcp <share-code> --bootstrap 127.0.0.1:49737
```

`PEARS_VAULT_BOOTSTRAP=host:port` is equivalent to `--bootstrap`. Without it HyperDHT uses its public bootstrap network and attempts direct hole punching.

## Architecture

- `host start` persists a HyperDHT keypair, a random 256-bit vault key, and the canonical writable Hypercore/Hyperbee.
- One persistent HyperDHT Noise SecretStream is multiplexed with Protomux for control RPC and native Hypercore replication.
- Hypercore is single-writer. Peers encrypt values locally and send versioned AES-256-GCM ciphertext envelopes to the host writer.
- Peers open a disk-backed read-only Hypercore with the host core key. Initial synchronization downloads the complete finite range; live update notifications trigger downloads through each announced append length.
- `join`, `sync`, and `mcp` share the same persistent peer implementation and local-copy guarantees.
- Secret names are visible metadata. Values use a fresh 96-bit IV, a 128-bit authentication tag, and the secret name as AES-GCM additional authenticated data.

## Security model and current limitations

The 32-byte HyperDHT public key is an invitation capability: anyone who has it can connect and receive the vault read/write capability while the host is online. There is no per-peer approval, revocation, role separation, relay fallback, recovery phrase, or key rotation yet. Do not publish the share code.

The vault key is delivered only inside HyperDHT's authenticated encrypted connection. Secret values remain ciphertext in host and peer Hyperbee/Hypercore storage. Secret names, update timing, and database size are not hidden. The host must remain online for writes because it is the canonical Hypercore writer.

The MCP API is deliberately narrower than the interactive CLI: agents can add values, list names, and inspect sync status, but cannot retrieve secret values. HyperDHT does not relay by default, so peers behind incompatible randomizing NATs may require a future relay mechanism.

## Tests

```bash
npm run check
```

Integration coverage verifies:

- two connected peers exchange writes and receive live updates;
- a new peer downloads all pre-existing encrypted key-values;
- later appends persist into that peer's offline local copy;
- the one-shot CLI sync command reports a complete local copy;
- the MCP stdio server exposes only `add_secret`, `list_secrets`, and `sync_status`;
- MCP list results never contain secret values;
- persisted Hyperbee values contain ciphertext, not plaintext.

## Documentation followed

- [Connect two peers by key with HyperDHT](https://docs.pears.com/how-to/connect-to-peers/connect-two-peers-by-key-with-hyperdht/)
- [Replicate and persist with Hypercore](https://docs.pears.com/how-to/store-and-replicate/replicate-and-persist-with-hypercore/)
- [Share append-only databases with Hyperbee](https://docs.pears.com/how-to/store-and-replicate/share-append-only-databases-with-hyperbee/)
- [MCP TypeScript SDK server documentation](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.29.0/docs/server.md)
