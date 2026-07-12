import { createIdempotencyKey } from '../types'

export interface IntentKeyTracker {
  get(fingerprint: string): string
  clear(): void
}

export function createIntentKeyTracker(keyFactory = createIdempotencyKey): IntentKeyTracker {
  let current: { fingerprint: string; key: string } | null = null
  return {
    get(fingerprint) {
      if (!current || current.fingerprint !== fingerprint) current = { fingerprint, key: keyFactory() }
      return current.key
    },
    clear() { current = null }
  }
}
