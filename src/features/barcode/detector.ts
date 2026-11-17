/** Quello che serve di un lettore di codici, sia quello del browser sia quello della libreria. */
export interface CodeReader {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

const FORMATS = ["ean_13", "ean_8", "upc_a"] as const;
/** Codici GS1 che possono portare anche la data: si usano solo se il lettore li sa leggere. */
const EXTRA_FORMATS = ["data_matrix", "code_128"] as const;

/**
 * Copia del file `zxing_reader.wasm` della libreria, servita dalla stessa origine dell'app.
 * Se manca, la libreria ripiega sul suo indirizzo predefinito (jsDelivr): vedi `useLocalWasm`.
 */
export const LOCAL_WASM_URL = "/vendor/zxing_reader.wasm";

type BrowserDetectorClass = {
  new (options: { formats: string[] }): CodeReader;
  getSupportedFormats(): Promise<readonly string[]>;
};

async function nativeReader(): Promise<CodeReader | null> {
  const Native = (globalThis as { BarcodeDetector?: BrowserDetectorClass }).BarcodeDetector;
  if (!Native) return null;
  try {
    const supported = await Native.getSupportedFormats();
    if (!FORMATS.every((f) => supported.includes(f))) return null;
    return new Native({ formats: [...FORMATS, ...EXTRA_FORMATS.filter((f) => supported.includes(f))] });
  } catch {
    return null;
  }
}

async function localWasmAvailable(): Promise<boolean> {
  try {
    const response = await fetch(LOCAL_WASM_URL, { method: "HEAD", cache: "no-cache" });
    return response.ok && !(response.headers.get("content-type") ?? "").includes("text/html");
  } catch {
    return false;
  }
}

/**
 * Sceglie il lettore: quello del browser se riconosce i formati che servono (veloce e senza scaricare nulla),
 * altrimenti `barcode-detector`, caricato solo ora. La libreria legge i codici in WebAssembly, quindi
 * funziona anche su iPhone.
 */
export async function createCodeReader(): Promise<CodeReader> {
  const native = await nativeReader();
  if (native) return native;

  const lib = await import("barcode-detector/ponyfill");
  if (await localWasmAvailable()) {
    lib.prepareZXingModule({
      overrides: {
        locateFile: (path: string, prefix: string) => (path.endsWith(".wasm") ? LOCAL_WASM_URL : prefix + path),
      },
    });
  }
  const known = await lib.BarcodeDetector.getSupportedFormats().catch(() => [] as string[]);
  return new lib.BarcodeDetector({
    formats: [...FORMATS, ...EXTRA_FORMATS.filter((f) => (known as readonly string[]).includes(f))],
  });
}
