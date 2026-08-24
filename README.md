# PEARS VAULT

PEARS VAULT M1 is a CLI-first peer-to-peer secret vault built with Pear Runtime primitives. A host owns one persistent Hypercore/Hyperbee database; peers keep a long-lived HyperDHT connection open, replicate the database live, and can submit encrypted writes.

## Install

```bash
npm install
npm run build
npm link
```

Node.js 22+ is supported. The runtime dependencies (`hyperdht`, `hypercore`, `hyperbee`, and `b4a`) are the same modules used by Pear Terminal applications.

## Usage

Start the host:

```bash
pears-vault host start
```

The host prints a 64-character value such as:

```text
PEARS_VAULT_PUBLIC_KEY=<share-code>
```

Join from another machine or terminal:

```bash
pears-vault join <share-code>
```

The joined peer provides a long-lived interactive prompt. It remains connected and prints `Vault updated: <name>` whenever any connected peer changes the vault:

```text
add github.token ghp_example
list
get github.token
exit
```

Use separate storage directories when running multiple peers on one machine:

```bash
pears-vault host start --data-dir /tmp/vault-host
pears-vault join <share-code> --data-dir /tmp/vault-peer
```

By default, data is stored under `~/.pears-vault`. To use an isolated DHT bootstrap node (for a LAN or test network), pass `--bootstrap host:port` or set `PEARS_VAULT_BOOTSTRAP=host:port`. Without that option HyperDHT uses its public bootstrap network and attempts direct hole punching.

## Architecture

- `host start` persists a HyperDHT keypair, a random 256-bit vault key, and a writer-owned Hypercore/Hyperbee.
- `join` uses `dht.connect(hostPublicKey)`. HyperDHT wraps each connection in Noise SecretStream encryption and performs hole punching where the network permits it.
- One persistent HyperDHT SecretStream is multiplexed with Protomux. Its control channel returns the Hypercore read capability and vault key, accepts ciphertext writes, and broadcasts update notifications.
- Native Hypercore replication attaches to the same Protomux connection and remains open. Peers listen for Hypercore `append` events and synchronize each announced length in the background.
- Hypercore is single-writer. Peers encrypt values locally, send only versioned AES-256-GCM envelopes to the host, and the host appends those ciphertext envelopes to Hyperbee. The replicated Hypercore therefore contains no plaintext secret values.
- Secret names are visible metadata. Values use a fresh 96-bit IV, a 128-bit authentication tag, and the secret name as AES-GCM additional authenticated data.

## Security model and M0 limitations

The 32-byte HyperDHT public key acts as the M0 invitation capability: anyone who has it can connect and receive the vault read/write capability while the host is online. There is no per-peer approval, revocation, role separation, relay fallback, recovery phrase, or key rotation yet. Do not publish the share code.

The vault key is delivered inside HyperDHT's authenticated encrypted connection. Secret values are additionally encrypted before write RPC and remain ciphertext in Hyperbee and Hypercore replication. Secret names, update timing, and database size are not hidden. The host must remain online for peer writes because it is the canonical Hypercore writer; already-replicated reads remain persisted locally.

HyperDHT does not relay by default, so two peers behind incompatible randomizing NATs may require a future relay mechanism.

## Tests

```bash
npm run build
npm test
```

The integration test starts an isolated local HyperDHT bootstrap, one host and two independent long-lived peers. It verifies peer A writes, peer B reads, peer B writes, peer A receives the background live-update callback before issuing another command, and persisted Hyperbee values do not contain the plaintext. The compiled CLI test separately verifies that peer A prints `Vault updated: beta` while it remains connected.

## Pear documentation followed

- [Connect two peers by key with HyperDHT](https://docs.pears.com/how-to/connect-to-peers/connect-two-peers-by-key-with-hyperdht/): `DHT.keyPair()`, `server.listen(keyPair)`, `dht.connect(publicKey)`, encrypted direct connections, and hole punching.
- [Replicate and persist with Hypercore](https://docs.pears.com/how-to/store-and-replicate/replicate-and-persist-with-hypercore/): disk-backed writer and reader cores, `core.key`, `core.update()`, and `core.replicate(stream)` for live replication.
- [Share append-only databases with Hyperbee](https://docs.pears.com/how-to/store-and-replicate/share-append-only-databases-with-hyperbee/): Hyperbee on a Hypercore with matching key/value encodings and reader-side queries over a replicated core.
