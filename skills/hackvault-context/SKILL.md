---
name: hackvault-context
---

# Hackvault Shared Context

Use the Hackvault CLI as the only interface for shared context. The `.pears-context/` directory is a generated, read-only projection for humans and tools; never edit it to publish, update, supersede, or delete context.

## Before reading

Sync the local replica before every bounded retrieval:

```bash
hackvault context sync <public-key>
hackvault context list <public-key> [--scope <scope>] [--kind <kind>] [--limit <n>]
hackvault context get <public-key> <record-id>
```

The commands return one JSON value on stdout. Connection and synchronization diagnostics go to stderr. Use the JSON result from `sync` to confirm the replica is complete before relying on fresh context.

## Publishing

Publish only explicit, durable knowledge. Every input requires `schema`, `operationId`, `scope`, `kind`, `title`, `body`, and `author`; `source` and `createdAt` are optional. Use one of these kinds: `decision`, `product`, `architecture`, `convention`, `work-state`, or `note`.

```bash
hackvault context add <public-key> '<publish-json>'
```

Example:

```json
{"schema":1,"operationId":"agent-2026-09-01-001","scope":"engineering/runtime","kind":"decision","title":"Keep the context projection read-only","body":"Agents publish through the CLI so canonical receipts and validation remain intact.","author":"agent-name","source":"session note"}
```

Use a new operation ID for a new command. Retrying the same operation ID is safe and returns the original canonical receipt.

## Superseding and deleting

Do not silently replace an existing observation. Create a new record and name the records it supersedes:

```bash
hackvault context supersede <public-key> '<publish-json-with-supersedes>'
hackvault context delete <public-key> <record-id> <operation-id>
```

The superseding input includes every normal publish field plus a non-empty `supersedes` array. Deletion is an inspectable lifecycle event. Use `context list --kind ...` or `context get ...` to inspect lifecycle metadata.

## Boundaries

- Never read or modify `.pears-vault`, context replica storage, encryption keys, or wire protocol frames.
- Never treat `.pears-context/` files as a write API.
- The host public key is a bearer invitation: anyone who possesses it can read and write shared context while the host is online.
- Context is durable and available from the synchronized local replica, but new writes require a connected host.
