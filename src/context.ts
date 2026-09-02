/// <reference types="node" />

import type { CiphertextEnvelope } from './crypto.js'

export const CONTEXT_SCHEMA_VERSION = 1
export const CONTEXT_KINDS = [
  'decision',
  'product',
  'architecture',
  'convention',
  'work-state',
  'note'
] as const

export type ContextKind = (typeof CONTEXT_KINDS)[number]

export interface ContextPublishInput {
  schema: 1
  operationId: string
  scope: string
  kind: ContextKind
  title: string
  body: string
  author: string
  source?: string
  createdAt?: string
}

export interface ContextCommand extends ContextPublishInput {
  peerId: string
}

export interface ContextRecord extends ContextCommand {
  id: string
  createdAt: string
  receivedAt: string
}

export interface ContextReceipt {
  operationId: string
  id: string
  length: number
  deduplicated: boolean
}

export interface ContextPublishResult extends ContextReceipt {
  record: ContextRecord
}

export interface ContextHello {
  protocol: 1
  coreKey: string
  contextKey: string
  length: number
}

export interface ContextSyncStatus {
  connected: boolean
  dataDir: string
  localLength: number
  remoteLength: number
  fullySynced: boolean
  lastSyncedAt: string | null
  lastError: string | null
}

const MAX_TEXT_BYTES = 64 * 1024
const MAX_SHORT_TEXT_BYTES = 4 * 1024
const OPERATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const PEER_ID_RE = /^[0-9a-f]{32}$/i

function validateText(value: unknown, field: string, maxBytes = MAX_TEXT_BYTES): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`Context ${field} must be a non-empty string`)
  if (Buffer.byteLength(value, 'utf8') > maxBytes) throw new Error(`Context ${field} is too large`)
}

function validateTimestamp(value: unknown, field: string): asserts value is string {
  validateText(value, field, 128)
  if (Number.isNaN(Date.parse(value))) throw new Error(`Context ${field} must be an ISO timestamp`)
}

export function validateContextKind(value: unknown): asserts value is ContextKind {
  if (typeof value !== 'string' || !(CONTEXT_KINDS as readonly string[]).includes(value)) {
    throw new Error(`Unsupported context kind: ${String(value)}`)
  }
}

export function validateContextPublishInput(value: unknown): asserts value is ContextPublishInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Context publish input must be an object')
  const input = value as Record<string, unknown>
  const allowed = ['author', 'body', 'createdAt', 'kind', 'operationId', 'schema', 'scope', 'source', 'title']
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new Error('Context publish input has unexpected fields')
  if (input.schema !== CONTEXT_SCHEMA_VERSION) throw new Error('Unsupported context schema version')
  if (typeof input.operationId !== 'string' || !OPERATION_ID_RE.test(input.operationId)) {
    throw new Error('Context operationId is invalid')
  }
  validateText(input.scope, 'scope', MAX_SHORT_TEXT_BYTES)
  validateContextKind(input.kind)
  validateText(input.title, 'title', MAX_SHORT_TEXT_BYTES)
  validateText(input.body, 'body')
  validateText(input.author, 'author', MAX_SHORT_TEXT_BYTES)
  if (input.source !== undefined) validateText(input.source, 'source', MAX_SHORT_TEXT_BYTES)
  if (input.createdAt !== undefined) validateTimestamp(input.createdAt, 'createdAt')
}

export function validateContextCommand(value: unknown): asserts value is ContextCommand {
  const command = value as unknown as Record<string, unknown>
  validateContextPublishInput({
    schema: command.schema,
    operationId: command.operationId,
    scope: command.scope,
    kind: command.kind,
    title: command.title,
    body: command.body,
    author: command.author,
    source: command.source,
    createdAt: command.createdAt
  })
  if (typeof command.peerId !== 'string' || !PEER_ID_RE.test(command.peerId)) {
    throw new Error('Context peerId is invalid')
  }
}

export function validateContextRecord(value: unknown): asserts value is ContextRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Context record must be an object')
  const record = value as Record<string, unknown>
  const allowed = [
    'author',
    'body',
    'createdAt',
    'id',
    'kind',
    'operationId',
    'peerId',
    'receivedAt',
    'schema',
    'scope',
    'source',
    'title'
  ]
  if (Object.keys(record).some(key => !allowed.includes(key))) throw new Error('Context record has unexpected fields')
  validateContextCommand({
    schema: record.schema,
    operationId: record.operationId,
    scope: record.scope,
    kind: record.kind,
    title: record.title,
    body: record.body,
    author: record.author,
    source: record.source,
    createdAt: record.createdAt,
    peerId: record.peerId
  })
  validateText(record.id, 'id', MAX_SHORT_TEXT_BYTES)
  validateTimestamp(record.createdAt, 'createdAt')
  validateTimestamp(record.receivedAt, 'receivedAt')
}

export function validateContextReceipt(value: unknown): asserts value is ContextReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Context receipt must be an object')
  const receipt = value as Record<string, unknown>
  if (Object.keys(receipt).sort().join(',') !== 'deduplicated,id,length,operationId') {
    throw new Error('Context receipt has unexpected fields')
  }
  if (typeof receipt.operationId !== 'string' || !OPERATION_ID_RE.test(receipt.operationId)) {
    throw new Error('Context receipt has an invalid operationId')
  }
  validateText(receipt.id, 'id', MAX_SHORT_TEXT_BYTES)
  if (!Number.isInteger(receipt.length) || (receipt.length as number) < 0) throw new Error('Context receipt has an invalid length')
  if (typeof receipt.deduplicated !== 'boolean') throw new Error('Context receipt has an invalid deduplication flag')
}

export function parseContextReceipt(value: unknown): ContextReceipt {
  validateContextReceipt(value)
  return value
}

export function encodeContextPublishInput(input: ContextPublishInput): string {
  validateContextPublishInput(input)
  return JSON.stringify(input)
}

export function decodeContextPublishInput(value: string): ContextPublishInput {
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    throw new Error('Context publish input is not valid JSON')
  }
  validateContextPublishInput(decoded)
  return decoded
}

export function encodeContextReceipt(receipt: ContextReceipt): string {
  validateContextReceipt(receipt)
  return JSON.stringify(receipt)
}

export function decodeContextReceipt(value: string): ContextReceipt {
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    throw new Error('Context receipt is not valid JSON')
  }
  return parseContextReceipt(decoded)
}

export function parseContextRecord(value: string): ContextRecord {
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    throw new Error('Stored context record is corrupted')
  }
  validateContextRecord(decoded)
  return decoded
}

export function parseContextEnvelope(value: string): CiphertextEnvelope {
  let decoded: unknown
  try {
    decoded = JSON.parse(value)
  } catch {
    throw new Error('Stored context ciphertext is corrupted')
  }
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)) throw new Error('Stored context ciphertext is invalid')
  return decoded as CiphertextEnvelope
}
