import { beforeEach, describe, expect, it } from 'vitest'
import { bootstrapNfcCapability, clearNfcCapability, getNfcCapability } from './nfcBootstrap'

describe('NFC capability bootstrap', () => {
  beforeEach(() => {
    clearNfcCapability()
    history.replaceState(null, '', '/')
  })

  it.each([
    ['/nfc#capability%2Fvalue', 'capability/value'],
    ['/nfc/legacy%2Fcapability', 'legacy/capability']
  ])('moves the capability from %s into session storage and removes it from the URL', (sourceUrl, expected) => {
    history.replaceState(null, '', sourceUrl)

    bootstrapNfcCapability()

    expect(getNfcCapability()).toBe(expected)
    expect(location.pathname).toBe('/nfc')
    expect(location.hash).toBe('')
    expect(location.href).not.toContain(encodeURIComponent(expected))
  })

  it('restores the existing capability on a tokenless refresh', () => {
    sessionStorage.setItem('sp:nfc-capability', 'saved-capability')
    history.replaceState(null, '', '/nfc')

    bootstrapNfcCapability()

    expect(getNfcCapability()).toBe('saved-capability')
    expect(location.pathname).toBe('/nfc')
  })
})
