# Hackvault

Hackvault is a peer-to-peer encrypted secret vault with automatic `.env` mirroring. A host owns the canonical Hypercore/Hyperbee database; interactive and programmatic peers keep encrypted disk-backed replicas and apply bidirectional updates without reconnecting.

## Install

Install or update Hackvault with one command:

```bash
curl -fsSL https://raw.githubusercontent.com/ram4-dev/pears-vault/main/scripts/install.sh | bash
```

The installer builds the current `main` branch, stores the runtime under `~/.local/share/hackvault`, and creates the `hackvault` command in Homebrew's bin directory on macOS when writable, or `~/.local/bin` on macOS/Linux.

Node.js 22+ and npm are required. If `~/.local/bin` is not already available in your shell, the installer prints the PATH entry to add.

Uninstall the managed command and runtime files with:

```bash
curl -fsSL https://raw.githubusercontent.com/ram4-dev/pears-vault/main/scripts/install.sh | bash -s -- --uninstall
```

To build a development checkout instead, run `npm install && npm run build`.

## Start the host

```bash
hackvault host start
```

The host prints a 64-character share code:

```text
HACKVAULT_PUBLIC_KEY=<public-key>
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
hackvault add <public-key> <name> <value>
```

Output:

```json
{"ok":true,"name":"API_TOKEN"}
```

List key names only:

```bash
hackvault list <public-key>
```

Output:

```json
["API_TOKEN","DATABASE_URL"]
```

Get one secret value:

```bash
hackvault get <public-key> <name>
```

Output:

```json
{"name":"API_TOKEN","value":"secret-value"}
```

A missing key returns `{"name":"API_TOKEN","value":null}`. `get` intentionally reveals the value to the owner of the CLI process, so callers must protect stdout and logs.

Shell-quote values containing spaces or special characters:

```bash
hackvault add <public-key> DATABASE_URL 'postgres://user:password@host/db'
```

All programmatic commands accept `--data-dir <path>` and `--bootstrap <host:port,...>`.

## Interactive peer

```bash
hackvault join <public-key>
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
hackvault sync <public-key>
```

This downloads every existing Hypercore block, updates `<project-root>/.env` (nearest Git root, with cwd fallback), prints JSON synchronization status, and exits.

Unless `--data-dir` is supplied, peers use a stable local data directory derived from the project/cwd and vault public key.

Peer Hypercore storage remains in the peer data directory, but every CLI peer command (`join`, `add`, `list`, `get`, and `sync`) mirrors plaintext into `<project-root>/.env`. Supplying `--data-dir` changes storage only; it does not move the project `.env`.

## Bidirectional `.env` synchronization

- The host and long-lived peers watch their local `.env` approximately every two seconds.
- Adding a `KEY=value` line or editing its value performs an authenticated vault upsert.
- Removing a key that the vault manages deletes that secret from Hyperbee and removes it from every connected host/peer `.env`. `KEY=` remains an empty-string value and is not a deletion.
- Every connected peer downloads each announced append or tombstone and updates its own `.env` before reporting the live update.
- A newly connected peer first reconciles edits made since its last synchronized snapshot, then downloads and mirrors the full vault.
- One-shot `add`, `list`, `get`, and `sync` commands reconcile pending project `.env` edits before performing their requested operation.
- Snapshot metadata stores value hashes and managed key names, not a second plaintext copy.
- Existing comments, blank lines, and unrelated variables are preserved. Duplicate assignments for a managed key are collapsed.
- Values requiring quoting are JSON-escaped on one line.
- Generated `.env` and snapshot files use restrictive permissions; `.env` is ignored by Git.

The `.env` files intentionally contain plaintext values. Treat every project `.env`, host directory, and peer data directory as sensitive.

## Network options

```bash
hackvault host start --data-dir /tmp/vault-host
hackvault add <public-key> API_TOKEN secret --data-dir /tmp/vault-peer
hackvault list <public-key> --bootstrap 127.0.0.1:49737
```

`HACKVAULT_BOOTSTRAP=host:port` is equivalent to `--bootstrap`. Without an override, HyperDHT uses its public bootstrap network and attempts direct hole punching.

## Architecture

- The host persists a HyperDHT keypair, a random 256-bit vault key, and the canonical writable Hypercore/Hyperbee.
- A persistent HyperDHT Noise SecretStream is multiplexed with Protomux for control RPC and native Hypercore replication.
- Hypercore is single-writer. Peers encrypt values locally and submit versioned AES-256-GCM ciphertext envelopes to the host.
- Peers maintain full disk-backed read-only replicas and verify that every announced block is locally available; local `.env` edits are sent to the canonical host as authenticated upsert/delete requests.
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

Coverage includes encrypted persistence, complete peer bootstrap, live replication, bidirectional host/peer `.env` upserts and deletions, loop prevention through durable snapshots, one-shot reconciliation, exact programmatic JSON output, bounded commands, and existing interactive CLI behavior.

## Documentation followed

- [Connect two peers by key with HyperDHT](https://docs.pears.com/how-to/connect-to-peers/connect-two-peers-by-key-with-hyperdht/)
- [Replicate and persist with Hypercore](https://docs.pears.com/how-to/store-and-replicate/replicate-and-persist-with-hypercore/)
- [Share append-only databases with Hyperbee](https://docs.pears.com/how-to/store-and-replicate/share-append-only-databases-with-hyperbee/)
