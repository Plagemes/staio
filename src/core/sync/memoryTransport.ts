// Trasporto in memoria: per i test (con guasti iniettabili) e come contenitore del pacchetto su file.
import { TransportError, type GetOptions, type PutPrecondition, type RemoteEntry, type RemoteFile, type SyncTransport, type TransportErrorCode } from "./transport";

export type MemoryOp = "list" | "get" | "put";

export interface MemoryCall {
  op: MemoryOp;
  name?: string;
  /** Numero progressivo della chiamata su questo trasporto, da 0. */
  index: number;
}

/**
 * Guasto da iniettare: `before` l'operazione non avviene; `after` avviene ma la risposta va
 * persa (come una connessione che cade dopo la scrittura).
 */
export interface MemoryFault {
  when: "before" | "after";
  code?: TransportErrorCode;
}

export interface MemoryTransportOptions {
  /** Orologio del servizio remoto. */
  now?: () => Date;
  /** Decide per ogni chiamata se fallire. */
  fault?: (call: MemoryCall) => MemoryFault | null | undefined;
  /** Attesa simulata prima di ogni operazione (per intrecciare dispositivi concorrenti). */
  delay?: (call: MemoryCall) => Promise<void>;
}

interface StoredFile {
  bytes: Uint8Array;
  revision: number;
  modifiedAt: string;
}

export class MemoryTransport implements SyncTransport {
  private readonly files = new Map<string, StoredFile>();
  private calls = 0;
  private revisions = 0;

  constructor(private readonly options: MemoryTransportOptions = {}) {}

  get callCount(): number {
    return this.calls;
  }

  private entry(name: string, f: StoredFile): RemoteEntry {
    return { name, revision: String(f.revision), size: f.bytes.length, modifiedAt: f.modifiedAt };
  }

  private async step<T>(op: MemoryOp, name: string | undefined, run: () => T): Promise<T> {
    const call: MemoryCall = { op, name, index: this.calls++ };
    await this.options.delay?.(call);
    const fault = this.options.fault?.(call);
    if (fault?.when === "before") throw new TransportError(fault.code ?? "interrupted");
    const result = run();
    if (fault?.when === "after") throw new TransportError(fault.code ?? "interrupted");
    return result;
  }

  list(): Promise<RemoteEntry[]> {
    return this.step("list", undefined, () =>
      [...this.files.entries()].map(([name, f]) => this.entry(name, f)).sort((a, b) => (a.name < b.name ? -1 : 1)),
    );
  }

  get(name: string, options: GetOptions = {}): Promise<RemoteFile | null> {
    return this.step("get", name, () => {
      const f = this.files.get(name);
      if (f && options.maxBytes !== undefined && f.bytes.length > options.maxBytes) throw new TransportError("too_large");
      return f ? { entry: this.entry(name, f), bytes: f.bytes.slice() } : null;
    });
  }

  put(name: string, bytes: Uint8Array, precondition: PutPrecondition): Promise<RemoteEntry> {
    return this.step("put", name, () => {
      const current = this.files.get(name);
      const ok =
        precondition.ifRevision === null ? current === undefined : current !== undefined && String(current.revision) === precondition.ifRevision;
      if (!ok) throw new TransportError("precondition_failed");
      const f: StoredFile = {
        bytes: bytes.slice(),
        revision: ++this.revisions,
        modifiedAt: (this.options.now?.() ?? new Date()).toISOString(),
      };
      this.files.set(name, f);
      return this.entry(name, f);
    });
  }

  /** Solo per i test e per il pacchetto: scrive senza passare dal protocollo. */
  setRaw(name: string, bytes: Uint8Array, modifiedAt?: string): void {
    this.files.set(name, {
      bytes: bytes.slice(),
      revision: ++this.revisions,
      modifiedAt: modifiedAt ?? (this.options.now?.() ?? new Date()).toISOString(),
    });
  }

  /** Copia dei file presenti, per nome. */
  snapshot(): Map<string, Uint8Array> {
    return new Map([...this.files.entries()].map(([n, f]) => [n, f.bytes.slice()]));
  }
}
