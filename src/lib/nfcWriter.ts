import "./nfcReader";

export const canWriteNfc = () => window.isSecureContext && Boolean(window.NDEFReader)

export type NfcWriteAvailability = 'supported' | 'ios' | 'unsupported' | 'insecure'

export const getNfcWriteAvailability = (): NfcWriteAvailability => {
  if (!window.isSecureContext) return 'insecure'
  if (window.NDEFReader) return 'supported'
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  return ios ? 'ios' : 'unsupported'
}

export async function writeUrlToNfc(url: string): Promise<void> {
  const NdefReader = window.NDEFReader
  if (!window.isSecureContext || !NdefReader) throw new DOMException('Web NFC is not supported', 'NotSupportedError')
  const reader = new NdefReader()
  await reader.write({ records: [{ recordType: 'url', data: url }] })
}
