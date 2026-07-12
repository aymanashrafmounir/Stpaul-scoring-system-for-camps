import { describe, expect, it } from 'vitest'
import { createIntentKeyTracker } from './idempotency'

describe('intent idempotency keys', () => {
  it('reuses one key when the same intent is retried after a timeout', () => {
    let sequence = 0
    const tracker = createIntentKeyTracker(() => `key-${++sequence}`)

    const firstAttempt = tracker.get('slot-2|draw')
    const retryAttempt = tracker.get('slot-2|draw')

    expect(retryAttempt).toBe(firstAttempt)
    expect(sequence).toBe(1)
  })

  it('creates a new key when normalized user intent changes', () => {
    let sequence = 0
    const tracker = createIntentKeyTracker(() => `key-${++sequence}`)

    const firstIntent = tracker.get('team-1|5|روح رياضية')
    const changedIntent = tracker.get('team-1|7|روح رياضية')

    expect(changedIntent).not.toBe(firstIntent)
  })

  it('creates a fresh key after confirmed success clears the intent', () => {
    let sequence = 0
    const tracker = createIntentKeyTracker(() => `key-${++sequence}`)
    const committedKey = tracker.get('team-1|10|صرف')

    tracker.clear()

    expect(tracker.get('team-1|10|صرف')).not.toBe(committedKey)
  })
})
