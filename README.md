# PEARS VAULT

PEARS VAULT is a CLI-first peer-to-peer secret vault built with Pear Runtime primitives. A host owns the canonical Hypercore/Hyperbee database; interactive and programmatic peers keep encrypted disk-backed replicas and apply live updates without reconnecting.

## Install

```bash
npm install
npm run build
npm link
```

Node.js 22+ is supported.

## Start the host

```bash
pears-vault host start
```

The host prints a 64-character share code:

```text
PEARS_VAULT_PUBLIC_KEY=<public-key>
```

Keep the process running and wait for:

```text
Host is serving encrypted vault replication and peer write requests.
```

With the default host storage, secrets are mirrored into `<current-repository-or-cwd>/.env`. When `--data-dir` is supplied, the host mirror is `<data-dir>/.env`.

## Programmatic commands

These commands are non-interactive, use bounded connection and operation timeouts, print machine-readable JSON to stdout, and exit without reading stdin. Connection diagnostics and errors use stderr.

Add or replace a secret:

```bash
pears-vault add <public-key> <name> <value>
```

Output:

```json
{"ok":true,"name":"API_TOKEN"}
```

List key names only:

```bash
pears-vault list <public-key>
```

Output:

```json
["API_TOKEN","DATABASE_URL"]
```

Get one secret value:

```bash
pears-vault get <public-key> <name>
```

Output:

```json
{"name":"API_TOKEN","value":"secret-value"}
```

A missing key returns `{"name":"API_TOKEN","value":null}`. `get` intentionally reveals the value to the owner of the CLI process, so callers must protect stdout and logs.

Shell-quote values containing spaces or special characters:

```bash
pears-vault add <public-key> DATABASE_URL 'postgres://user:password@host/db'
```

All programmatic commands accept `--data-dir <path>` and `--bootstrap <host:port,...>`.

## Interactive peer

```bash
pears-vault join <public-key>
```

Commands:

```text
add <name> <value>
list
get <name>
help
exit
```

The peer remains connected and prints `Vault updated: <name>` after a live update has been downloaded and written to its local `.env`.

## Synchronize a local copy

```bash
pears-vault sync <public-key>
```

This downloads every existing Hypercore block, updates `<peer-data-dir>/.env`, prints JSON synchronization status, and exits.

Unless `--data-dir` is supplied, peers use:

```text
~/.pears-vault/peers/<project-or-cwd-and-vault-hash>
```

Each peer's plaintext environment mirror is `<peer-data-dir>/.env`.

## `.env` propagation

- The host updates its own `.env` after accepting a write.
- Every connected peer downloads each announced append, decrypts the changed value locally, and updates its own `.env` before reporting the live update.
- A newly connected peer first downloads the full vault and mirrors every key/value into its `.env`.
- Existing comments, blank lines, and unrelated variables are preserved.
- Existing assignments are replaced by exact key name; duplicate assignments for that key are collapsed.
- Values requiring quoting are JSON-escaped on one line.
- Generated `.env` files use restrictive permissions and are ignored by Git.

The `.env` files intentionally contain plaintext values. Treat every host and peer data directory as sensitive.

## Network options

```bash
pears-vault host start --data-dir /tmp/vault-host
pears-vault add <public-key> API_TOKEN secret --data-dir /tmp/vault-peer
pears-vault list <public-key> --bootstrap 127.0.0.1:49737
```

`PEARS_VAULT_BOOTSTRAP=host:port` is equivalent to `--bootstrap`. Without an override, HyperDHT uses its public bootstrap network and attempts direct hole punching.

## Architecture

- The host persists a HyperDHT keypair, a random 256-bit vault key, and the canonical writable Hypercore/Hyperbee.
- A persistent HyperDHT Noise SecretStream is multiplexed with Protomux for control RPC and native Hypercore replication.
- Hypercore is single-writer. Peers encrypt values locally and submit versioned AES-256-GCM ciphertext envelopes to the host.
- Peers maintain full disk-backed read-only replicas and verify that every announced block is locally available.
- Replicated Hypercore/Hyperbee data remains ciphertext. Plaintext exists only in process memory and each node's intentional local `.env` mirror.
- Secret names, update timing, and database size are visible metadata.

## Security and current limitations

The HyperDHT public key is an invitation capability: anyone with it can connect and receive the current read/write capability while the host is online. There is no per-peer approval, revocation, role separation, relay fallback, recovery phrase, or key rotation yet. Do not publish the key.

Programmatic `list` returns names only. Programmatic `get` returns a plaintext value by explicit design. `.env` propagation also stores plaintext locally by explicit design. Keep command output, repository roots, and peer data directories private.

HyperDHT does not relay by default, so peers behind incompatible randomizing NATs may require a future relay mechanism.

## Tests

```bash
npm run check
```

Coverage includes encrypted persistence, complete peer bootstrap, live replication, host and peer `.env` propagation, merge/replace behavior, exact programmatic JSON output, bounded non-interactive commands, and existing interactive CLI behavior.

## Documentation followed

- [Connect two peers by key with HyperDHT](https://docs.pears.com/how-to/connect-to-peers/connect-two-peers-by-key-with-hyperdht/)
- [Replicate and persist with Hypercore](https://docs.pears.com/how-to/store-and-replicate/replicate-and-persist-with-hypercore/)
- [Share append-only databases with Hyperbee](https://docs.pears.com/how-to/store-and-replicate/share-append-only-databases-with-hyperbee/)
