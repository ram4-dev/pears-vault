/// <reference types="node" />
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseBootstrap, parsePublicKey, validateSecretName } from '../src/validation.js'

test('validates DHT public keys', () => {
  assert.equal(parsePublicKey('ab'.repeat(32)).length, 32)
  assert.throws(() => parsePublicKey('ab'))
  assert.throws(() => parsePublicKey('zz'.repeat(32)))
})

test('validates secret names', () => {
  assert.doesNotThrow(() => validateSecretName('prod.api-key_1'))
  assert.throws(() => validateSecretName('../escape'))
  assert.throws(() => validateSecretName('has spaces'))
  assert.throws(() => validateSecretName(''))
})

test('parses bootstrap addresses', () => {
  assert.deepEqual(parseBootstrap('127.0.0.1:49737'), [{ host: '127.0.0.1', port: 49737 }])
  assert.throws(() => parseBootstrap('127.0.0.1:not-a-port'))
})
