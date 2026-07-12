const NFC_SESSION_KEY = 'sp:nfc-capability'
let memoryCapability: string | null = null

function persistCapability(capability: string) {
  memoryCapability = capability
  try {
    window.sessionStorage.setItem(NFC_SESSION_KEY, capability)
  } catch (error) {
    if (!(error instanceof DOMException)) throw error
  }
}

export function bootstrapNfcCapability() {
  if (window.location.pathname === '/nfc' && window.location.hash.length > 1) {
    try {
      const capability = decodeURIComponent(window.location.hash.slice(1))
      if (capability) persistCapability(capability)
    } finally {
      window.history.replaceState(window.history.state, '', '/nfc')
    }
    return
  }
  const match = window.location.pathname.match(/^\/nfc\/([^/]+)$/)
  if (!match) return
  try {
    const capability = decodeURIComponent(match[1])
    if (capability) persistCapability(capability)
  } finally {
    window.history.replaceState(window.history.state, '', '/nfc')
  }
}

export function getNfcCapability() {
  if (memoryCapability) return memoryCapability
  try {
    return window.sessionStorage.getItem(NFC_SESSION_KEY)
  } catch (error) {
    if (error instanceof DOMException) return null
    throw error
  }
}

export function clearNfcCapability() {
  memoryCapability = null
  try {
    window.sessionStorage.removeItem(NFC_SESSION_KEY)
  } catch (error) {
    if (!(error instanceof DOMException)) throw error
  }
}
