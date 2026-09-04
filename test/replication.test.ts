/// <reference types="node" />
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { downloadCoreCopy, parseLengthReceipt } from '../src/replication.js'

class FakeCore extends EventEmitter {
  length = 1
  downloaded = false

  async update(): Promise<void> {}

  download(): { done: () => Promise<void>; destroy: () => void } {
    return {
      done: async () => {
        this.downloaded = true
      },
      destroy: () => undefined
    }
  }

  async has(start: number, end: number): Promise<boolean> {
    return start === 0 && end === 1 && this.downloaded
  }
}

test('length receipts require a non-negative integer', () => {
  assert.equal(parseLengthReceipt({ length: 4 }, 'write receipt'), 4)
  assert.throws(() => parseLengthReceipt({ length: -1 }, 'write receipt'), /invalid write receipt/)
  assert.throws(() => parseLengthReceipt({ length: 1.5 }, 'write receipt'), /invalid write receipt/)
  assert.throws(() => parseLengthReceipt({}, 'write receipt'), /invalid write receipt/)
})

test('downloadCoreCopy downloads and verifies the receipt range', async () => {
  const core = new FakeCore()
  await downloadCoreCopy(core, 1, 100)
  assert.equal(core.downloaded, true)
})

test('downloadCoreCopy bounds waiting for missing metadata', async () => {
  const core = new EventEmitter() as EventEmitter & { length: number; update: () => Promise<void> }
  core.length = 0
  core.update = () => new Promise(() => undefined)
  await assert.rejects(downloadCoreCopy(core, 1, 10), /Timed out while syncing local core/)
})
