import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_COMPLETION_REASON,
  isBillableCompletion,
} from '../functions/lib/completion'

test('isBillableCompletion: real content is billable', () => {
  assert.equal(isBillableCompletion('{"items":[]}'), true)
  assert.equal(isBillableCompletion('  hello  '), true)
})

test('isBillableCompletion: an empty upstream body is never billable', () => {
  assert.equal(isBillableCompletion(''), false)
  assert.equal(isBillableCompletion('   \n  '), false)
  assert.equal(isBillableCompletion(null), false)
  assert.equal(isBillableCompletion(undefined), false)
})

test('EMPTY_COMPLETION_REASON explains the failed settlement', () => {
  assert.match(EMPTY_COMPLETION_REASON, /empty/i)
})
