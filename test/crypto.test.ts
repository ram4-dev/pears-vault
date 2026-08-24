/// <reference types="node" />
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { test } from 'node:test'
import { decryptSecret, encryptSecret, validateEnvelope } from '../src/crypto.js'

const key = randomBytes(32)

test('AES-256-GCM encrypts and decrypts a secret', () => {
  const envelope = encryptSecret('api-key', 'correct horse battery staple', key)
  assert.equal(decryptSecret('api-key', envelope, key), 'correct horse battery staple')
})

test('each encryption uses a unique IV and ciphertext', () => {
  const first = encryptSecret('token', 'same-value', key)
  const second = encryptSecret('token', 'same-value', key)
  assert.notEqual(first.iv, second.iv)
  assert.notEqual(first.ciphertext, second.ciphertext)
})

test('tampering or changing the bound secret name is rejected', () => {
  const envelope = encryptSecret('token', 'sensitive-value', key)
  const tampered = { ...envelope, ciphertext: `00${envelope.ciphertext.slice(2)}` }
  assert.throws(() => decryptSecret('token', tampered, key))
  assert.throws(() => decryptSecret('another-token', envelope, key))
})

test('ciphertext envelope contains no plaintext secret', () => {
  const plaintext = 'plaintext-must-never-be-replicated'
  const envelope = encryptSecret('database', plaintext, key)
  const serialized = JSON.stringify(envelope)
  assert.equal(serialized.includes(plaintext), false)
  assert.deepEqual(Object.keys(envelope).sort(), ['alg', 'ciphertext', 'iv', 'tag', 'v'])
  validateEnvelope({ ...envelope })
})

test('malformed envelopes are rejected', () => {
  assert.throws(() => validateEnvelope({ v: 1, alg: 'aes-256-gcm', iv: '00', tag: '00', ciphertext: '00' }))
  assert.throws(() => validateEnvelope({
    v: 1,
    alg: 'aes-256-gcm',
    iv: '00'.repeat(12),
    tag: '00'.repeat(16),
    ciphertext: '00',
    plaintext: 'leak'
  }))
})
