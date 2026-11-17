// Archivio locale in memoria che rispetta `SyncLocalPort`: per i test del protocollo,
// con guasti iniettabili prima o dopo ogni scrittura atomica.
import { mergeAllEvents, type AnyEvent } from "../events";
import { eventKeys } from "./bytes";
import type {
  ApplyStats,
  IncomingCommit,
  LocalSyncState,
  OutgoingCommit,
  PendingBatch,
  QuarantineEntry,
  SyncLocalPort,
  WriteKey,
} from "./engine";

export type MemoryLocalOp = "commitIncoming" | "commitOutgoing";

export class MemoryLocal implements SyncLocalPort {
  events: AnyEvent[] = [];
  readonly remote = new Set<string>();
  readonly seen = new Set<string>();
  readonly quarantine = new Map<string, QuarantineEntry>();
  readonly keys = new Map<string, CryptoKey>();
  current: WriteKey | undefined;
  ownLastSeq = 0;
  uploadKeyId: string | null | undefined;
  /** Se restituisce `before` o `after`, la scrittura fallisce prima o dopo essere avvenuta. */
  fault?: (op: MemoryLocalOp) => "before" | "after" | null | undefined;

  constructor(readonly id: string) {}

  /** Eventi scritti sul dispositivo dall'utente. */
  author(events: readonly AnyEvent[]): void {
    this.events = mergeAllEvents(this.events, events).events;
  }

  useKey(key: WriteKey): void {
    this.keys.set(key.keyId, key.key);
    this.current = key;
  }

  private guard(phase: "before" | "after", decided: "before" | "after" | null | undefined): void {
    if (decided === phase) throw new Error(`local_${phase}`);
  }

  async deviceId(): Promise<string> {
    return this.id;
  }

  async state(): Promise<LocalSyncState> {
    return { seen: new Set(this.seen), ownLastSeq: this.ownLastSeq, uploadKeyId: this.uploadKeyId };
  }

  async pending(): Promise<PendingBatch> {
    const keys = await eventKeys(this.events);
    return { events: this.events.filter((_, i) => !this.remote.has(keys[i])) };
  }

  async resetUploadState(): Promise<void> {
    this.seen.clear();
    this.remote.clear();
    this.ownLastSeq = 0;
    this.uploadKeyId = undefined;
  }

  async commitIncoming(c: IncomingCommit): Promise<ApplyStats> {
    const fault = this.fault?.("commitIncoming");
    this.guard("before", fault);
    const before = new Set(this.events.map((e) => e.id));
    const merged = mergeAllEvents(this.events, c.events);
    const incoming = new Set(c.events.map((e) => e.id));
    this.events = merged.events;
    for (const k of c.remoteKeys) this.remote.add(k);
    for (const q of c.quarantine) this.quarantine.set(q.id, q);
    for (const id of c.release) this.quarantine.delete(id);
    if (c.markSeen) this.seen.add(c.segment);
    this.guard("after", fault);
    return {
      added: merged.events.filter((e) => !before.has(e.id)).length,
      conflicts: merged.conflicts.filter((x) => incoming.has(x.id)).length,
    };
  }

  async commitOutgoing(c: OutgoingCommit): Promise<void> {
    const fault = this.fault?.("commitOutgoing");
    this.guard("before", fault);
    for (const k of c.remoteKeys) this.remote.add(k);
    if (c.segment) this.seen.add(c.segment);
    this.ownLastSeq = Math.max(this.ownLastSeq, c.seq);
    if (c.keyId !== undefined) this.uploadKeyId = c.keyId;
    this.guard("after", fault);
  }

  async quarantined(): Promise<QuarantineEntry[]> {
    return [...this.quarantine.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  async keyFor(keyId: string): Promise<CryptoKey | undefined> {
    return this.keys.get(keyId);
  }

  async writeKey(): Promise<WriteKey | undefined> {
    return this.current;
  }
}
