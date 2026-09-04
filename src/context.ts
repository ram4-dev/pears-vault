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

export interface ContextSupersedeInput extends ContextPublishInput {
  supersedes: string[]
}

export interface ContextCommand extends ContextPublishInput {
  peerId: string
  supersedes?: string[]
}

export interface ContextDeleteCommand {
  schema: 1
  operationId: string
  peerId: string
  id: string
}

export interface ContextRecord extends ContextCommand {
  id: string
  createdAt: string
  receivedAt: string
}

export interface ContextState {
  id: string
  supersededBy: string[]
  deletedAt?: string
}

export type ContextCurrentRecord = ContextRecord & { state: ContextState }

export interface ContextRecordSummary {
  id: string
  scope: string
  kind: ContextKind
  title: string
  author: string
  source?: string
  createdAt: string
  receivedAt: string
  supersedes?: string[]
  supersededBy: string[]
  deletedAt?: string
}

export interface ContextQuery {
  scope?: string
  kind?: ContextKind
  includeDeleted?: boolean
  limit?: number
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
  reconnectAttempts: number
}

const MAX_TEXT_BYTES = 64 * 1024
const MAX_SHORT_TEXT_BYTES = 4 * 1024
export const MAX_CONTEXT_QUERY_LIMIT = 100
const OPERATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/
const PEER_ID_RE = /^[0-9a-f]{32}$/i
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/

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

function validateRecordId(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || !RECORD_ID_RE.test(value)) {
    throw new Error(`Context ${field} is invalid`)
  }
}

function validateSupersedes(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CONTEXT_QUERY_LIMIT) {
    throw new Error('Context supersedes must be a non-empty array')
  }
  const seen = new Set<string>()
  for (const id of value) {
    validateRecordId(id, 'supersedes record id')
    if (seen.has(id)) throw new Error('Context supersedes contains duplicate record ids')
    seen.add(id)
  }
}

export function validateContextCommand(value: unknown): asserts value is ContextCommand {
  const command = value as unknown as Record<string, unknown>
  const supersedes = command.supersedes
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
  if (supersedes !== undefined) validateSupersedes(supersedes)
  if (typeof command.peerId !== 'string' || !PEER_ID_RE.test(command.peerId)) {
    throw new Error('Context peerId is invalid')
  }
}

export function validateContextSupersedeInput(value: unknown): asserts value is ContextSupersedeInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Context supersede input must be an object')
  const input = value as Record<string, unknown>
  const { supersedes, ...publishInput } = input
  validateContextPublishInput(publishInput)
  validateSupersedes(supersedes)
}

export function validateContextDeleteCommand(value: unknown): asserts value is ContextDeleteCommand {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Context delete command must be an object')
  const command = value as Record<string, unknown>
  const allowed = ['id', 'operationId', 'peerId', 'schema']
  if (Object.keys(command).some(key => !allowed.includes(key))) throw new Error('Context delete command has unexpected fields')
  if (command.schema !== CONTEXT_SCHEMA_VERSION) throw new Error('Unsupported context schema version')
  if (typeof command.operationId !== 'string' || !OPERATION_ID_RE.test(command.operationId)) {
    throw new Error('Context operationId is invalid')
  }
  validateRecordId(command.id, 'record id')
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
    'supersedes',
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
    ...(record.supersedes === undefined ? {} : { supersedes: record.supersedes }),
    peerId: record.peerId
  })
  if (record.supersedes !== undefined) validateSupersedes(record.supersedes)
  validateText(record.id, 'id', MAX_SHORT_TEXT_BYTES)
  validateTimestamp(record.createdAt, 'createdAt')
  validateTimestamp(record.receivedAt, 'receivedAt')
}

export function validateContextState(value: unknown): asserts value is ContextState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Context state must be an object')
  const state = value as Record<string, unknown>
  const allowed = ['deletedAt', 'id', 'supersededBy']
  if (Object.keys(state).some(key => !allowed.includes(key))) throw new Error('Context state has unexpected fields')
  validateRecordId(state.id, 'state id')
  if (!Array.isArray(state.supersededBy)) throw new Error('Context state supersededBy must be an array')
  const seen = new Set<string>()
  for (const id of state.supersededBy) {
    validateRecordId(id, 'supersededBy record id')
    if (seen.has(id)) throw new Error('Context state supersededBy contains duplicate record ids')
    seen.add(id)
  }
  if (state.deletedAt !== undefined) validateTimestamp(state.deletedAt, 'deletedAt')
}

export function validateContextQuery(value: unknown): asserts value is ContextQuery {
  if (value === undefined) return
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Context query must be an object')
  const query = value as Record<string, unknown>
  const allowed = ['includeDeleted', 'kind', 'limit', 'scope']
  if (Object.keys(query).some(key => !allowed.includes(key))) throw new Error('Context query has unexpected fields')
  if (query.scope !== undefined) validateText(query.scope, 'query scope', MAX_SHORT_TEXT_BYTES)
  if (query.kind !== undefined) validateContextKind(query.kind)
  if (query.includeDeleted !== undefined && typeof query.includeDeleted !== 'boolean') {
    throw new Error('Context query includeDeleted must be a boolean')
  }
  if (query.limit !== undefined && (!Number.isInteger(query.limit) || (query.limit as number) < 1 || (query.limit as number) > MAX_CONTEXT_QUERY_LIMIT)) {
    throw new Error(`Context query limit must be between 1 and ${MAX_CONTEXT_QUERY_LIMIT}`)
  }
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
