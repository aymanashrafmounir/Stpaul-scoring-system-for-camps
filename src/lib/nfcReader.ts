interface NdefRecord {
  recordType: string;
  data?: DataView;
}

interface NdefReadingEvent extends Event {
  message: { records: NdefRecord[] };
}

interface NdefMessageInit {
  records: Array<{ recordType: "url"; data: string }>;
}

interface NdefReader {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(message: NdefMessageInit): Promise<void>;
  addEventListener(
    type: "reading",
    listener: (event: NdefReadingEvent) => void,
    options?: AddEventListenerOptions,
  ): void;
  removeEventListener(
    type: "reading",
    listener: (event: NdefReadingEvent) => void,
  ): void;
}

type NdefReaderConstructor = new () => NdefReader;

declare global {
  interface Window {
    NDEFReader?: NdefReaderConstructor;
  }
}

export const canReadNfc = () => window.isSecureContext && Boolean(window.NDEFReader);

function textFromRecord(record: NdefRecord): string | null {
  if (!record.data) return null;
  return new TextDecoder().decode(record.data);
}

/** Extracts the opaque wallet capability from the URLs written to team tags. */
export function capabilityFromNfcUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.pathname === "/nfc" && url.hash.length > 1) {
      return decodeURIComponent(url.hash.slice(1)) || null;
    }
    const legacy = url.pathname.match(/^\/nfc\/([^/]+)$/);
    return legacy ? decodeURIComponent(legacy[1]) || null : null;
  } catch {
    return null;
  }
}

/** Waits for one URL record from a nearby NFC tag and returns its capability. */
export async function readNfcCapability(): Promise<string> {
  const NdefReader = window.NDEFReader;
  if (!window.isSecureContext || !NdefReader) {
    throw new DOMException("Web NFC is not supported", "NotSupportedError");
  }

  const reader = new NdefReader();
  const controller = new AbortController();
  return new Promise<string>((resolve, reject) => {
    const onReading = (event: NdefReadingEvent) => {
      const urlRecord = event.message.records.find((record) => record.recordType === "url");
      const capability = urlRecord ? capabilityFromNfcUrl(textFromRecord(urlRecord) ?? "") : null;
      controller.abort();
      reader.removeEventListener("reading", onReading);
      if (capability) resolve(capability);
      else reject(new Error("الكارت ده مش كارت فريق Saint Paul صالح."));
    };

    reader.addEventListener("reading", onReading, { once: true });
    reader.scan({ signal: controller.signal }).catch((error: unknown) => {
      reader.removeEventListener("reading", onReading);
      if (!(error instanceof DOMException && error.name === "AbortError")) reject(error);
    });
  });
}
