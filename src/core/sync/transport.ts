// Interfaccia unica dei trasporti (memoria, file, Drive). Non esiste un'operazione di cancellazione:
// la sincronizzazione non può togliere dati da remoto, nemmeno per errore.

export type TransportErrorCode =
  | "offline"
  | "unauthorized"
  | "forbidden"
  | "rate_limited"
  | "precondition_failed"
  | "not_found"
  | "server"
  | "invalid_response"
  | "interrupted"
  /** Il file supera la dimensione massima richiesta: non è stato scaricato. */
  | "too_large"
  /** Troppi file da elencare. */
  | "too_many_files";

export class TransportError extends Error {
  constructor(
    readonly code: TransportErrorCode,
    message: string = code,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TransportError";
  }
}

export function isTransportError(e: unknown): e is TransportError {
  return e instanceof TransportError;
}

export interface RemoteEntry {
  name: string;
  /** Revisione opaca del file: cambia a ogni scrittura. */
  revision: string;
  size?: number;
  /** Istante di scrittura secondo il servizio remoto, se lo conosce (ISO 8601 UTC). */
  modifiedAt?: string;
}

export interface RemoteFile {
  entry: RemoteEntry;
  bytes: Uint8Array;
}

/**
 * `ifRevision: null` crea il file solo se non esiste; una stringa lo riscrive solo se la
 * revisione attuale è quella. Altrimenti `precondition_failed` e nulla cambia.
 */
export interface PutPrecondition {
  ifRevision: string | null;
}

export interface GetOptions {
  /** Oltre questa dimensione il file non si scarica: `too_large`. */
  maxBytes?: number;
}

export interface SyncTransport {
  list(): Promise<RemoteEntry[]>;
  get(name: string, options?: GetOptions): Promise<RemoteFile | null>;
  put(name: string, bytes: Uint8Array, precondition: PutPrecondition): Promise<RemoteEntry>;
}
