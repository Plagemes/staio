// Protocollo di sincronizzazione: scarica i segmenti non visti, valida ogni evento, unisce,
// poi carica i propri eventi nuovi. Ogni passo locale è un'unica scrittura atomica (`commit*`),
// ogni file remoto si scrive una volta sola: un'interruzione in qualunque punto lascia uno stato
// da cui la sincronizzazione successiva riprende senza perdere né duplicare eventi.
import type { ValidationError } from "../ledger";
import { ALL_EVENT_TYPES, isKnownEvent, validateAnyEvent, type AnyEvent } from "../events";
import { eventKey, eventKeys, fromUtf8, sha256Hex, utf8 } from "./bytes";
import { clockSkewMs, collectClockWarnings, futureRecordsMs, CLOCK_TOLERANCE_MS, type ClockWarning } from "./clock";
import { parseKeyInfo, type KeyInfo } from "./crypto";
import {
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  SEGMENT_VERSION,
  isSeq,
  keyFileName,
  manifestName,
  mergeManifestSegments,
  parseManifest,
  parseRemoteName,
  type Manifest,
  type ManifestSegment,
} from "./format";
import { decodeSegment, encodeSegment, type SegmentRejectReason } from "./segment";
import { isTransportError, type RemoteEntry, type SyncTransport, type TransportErrorCode } from "./transport";

export type QuarantineReason =
  | SegmentRejectReason
  /** Segmento di una versione del formato più recente di questa app. */
  | "future_version"
  /** File oltre la dimensione massima: non scaricato. */
  | "too_large"
  /** Evento di un tipo o di una versione che questa app non conosce. */
  | "future_event"
  | "invalid_event";

/** Dato ricevuto e non applicato: conservato, visibile, mai scartato in silenzio. */
export interface QuarantineEntry {
  /** `ev:<segmento>:<posizione>` o `seg:<segmento>`: lo stesso dato ha sempre lo stesso id. */
  id: string;
  kind: "event" | "segment";
  reason: QuarantineReason;
  segment: string;
  deviceId?: string;
  index?: number;
  receivedAt: string;
  /** Errori di validazione come `percorso:codice`. */
  errors: string[];
  /** Testo originale, troncato a `MAX_RAW_CHARS` (vedi `truncated`). */
  raw: string;
  /** Il testo originale è più lungo di `raw`. */
  truncated?: boolean;
  /** Dimensione in byte dell'originale. */
  size?: number;
  /** SHA-256 dell'originale completo. */
  digest?: string;
  /**
   * Si può riprovare dopo un aggiornamento dell'app: `event` si rivaluta da `raw`, `segment` si
   * riscarica. Si riprova solo quando cambia l'`epoch` (versione del formato e tipi noti).
   */
  retry?: "event" | "segment";
  epoch?: string;
  /** `package`: arrivato da un file, quindi non presente sul remoto. */
  origin?: "package";
}

export interface LocalSyncState {
  /** Segmenti già elaborati (applicati o messi in quarantena). */
  seen: ReadonlySet<string>;
  /** Sequenza più alta usata da questo dispositivo. */
  ownLastSeq: number;
  /**
   * Chiave con cui valgono le versioni segnate come presenti sul remoto (`null`: in chiaro).
   * Se la chiave di scrittura cambia, quelle versioni vanno ripubblicate con la nuova.
   */
  uploadKeyId?: string | null;
}

export interface PendingBatch {
  /** Eventi locali la cui versione non risulta ancora sul remoto. */
  events: AnyEvent[];
  /** Cursore opaco da confermare quando tutti sono stati caricati. */
  cursor?: number;
}

export interface IncomingCommit {
  segment: string;
  events: AnyEvent[];
  /** Chiavi (`eventKey`) delle versioni ormai presenti sul remoto. */
  remoteKeys: string[];
  quarantine: QuarantineEntry[];
  /** Voci di quarantena da togliere perché ora applicate. */
  release: string[];
  markSeen: boolean;
}

export interface OutgoingCommit {
  /** Segmento appena caricato; assente quando si conferma solo il cursore. */
  segment?: string;
  remoteKeys: string[];
  seq: number;
  cursor?: number;
  /** Chiave usata per questo caricamento (`null`: in chiaro). */
  keyId?: string | null;
}

export interface ApplyStats {
  added: number;
  conflicts: number;
}

export interface WriteKey {
  keyId: string;
  key: CryptoKey;
  keyInfo: KeyInfo;
}

/** Ciò che il protocollo chiede all'archivio locale. Ogni `commit*` è atomico. */
export interface SyncLocalPort {
  deviceId(): Promise<string>;
  state(): Promise<LocalSyncState>;
  pending(): Promise<PendingBatch>;
  commitIncoming(commit: IncomingCommit): Promise<ApplyStats>;
  commitOutgoing(commit: OutgoingCommit): Promise<void>;
  quarantined(): Promise<QuarantineEntry[]>;
  /**
   * Dimentica segmenti visti, versioni caricate, cursore e sequenza (non la quarantena né le
   * chiavi): il giro successivo rilegge tutto e ricarica ciò che il remoto non ha.
   */
  resetUploadState(): Promise<void>;
  keyFor(keyId: string): Promise<CryptoKey | undefined>;
  /** Chiave con cui cifrare ciò che si carica, se la frase segreta è stata inserita. */
  writeKey(): Promise<WriteKey | undefined>;
}

/**
 * `key_mismatch`: su Drive ci sono chiavi e la chiave di scrittura di questo dispositivo non è
 * quella corrente. Non si carica niente finché non si inserisce la frase giusta.
 */
export type SyncErrorCode = TransportErrorCode | "no_key" | "key_mismatch" | "key_unreadable" | "unexpected";

export interface SyncReport {
  status: "ok" | "failed" | "locked";
  error?: SyncErrorCode;
  startedAt: string;
  finishedAt: string;
  received: { segments: number; events: number; added: number; conflicts: number };
  sent: { segments: number; events: number };
  /** Voci nuove in quarantena in questo giro. */
  quarantined: number;
  /** Voci uscite dalla quarantena perché ora leggibili. */
  released: number;
  /** Segmenti cifrati con una chiave che il dispositivo non ha. Restano da leggere. */
  locked: number;
  unknownKeys: string[];
  /** File che non si sono potuti scaricare in questo giro: restano da leggere. */
  skipped: { name: string; code: TransportErrorCode }[];
  /**
   * Dati non conservati perché la quarantena è piena: voci vecchie scartate per far posto, o
   * voci nuove che non ci stavano. Gli eventi validi si applicano comunque.
   */
  overflow: number;
  /** Stato del caricamento ricostruito (sequenza fuori misura lasciata da una versione precedente). */
  recovered: boolean;
  /** Segmenti elencati nel manifesto di un dispositivo ma assenti dal remoto. */
  missing: { deviceId: string; name: string }[];
  clock: ClockWarning[];
  manifestUpdated: boolean;
}

export interface SyncOptions {
  transport: SyncTransport;
  local: SyncLocalPort;
  now?: () => Date;
  /** Drive: senza chiave non si scarica né si carica niente, e i segmenti in chiaro non si applicano. */
  requireEncryption?: boolean;
  /** `false` per la sola lettura (importazione di un pacchetto). */
  upload?: boolean;
  /** Importazione di un pacchetto: sola lettura, niente stato remoto, niente rivalutazione della quarantena. */
  packageImport?: boolean;
  maxEventsPerSegment?: number;
  maxSegmentBytes?: number;
  maxQuarantine?: number;
  /** Solo per i test: di norma `validateAnyEvent`. */
  validate?: (e: unknown) => ValidationError[];
  /** Solo per i test: di norma `syncEpoch()`. */
  epoch?: string;
  clockToleranceMs?: number;
}

export const MAX_EVENTS_PER_SEGMENT = 1000;
/** Un segmento più grande non si scarica. I nostri restano molto sotto (1000 eventi). */
export const MAX_SEGMENT_BYTES = 8 * 1024 * 1024;
export const MAX_RAW_CHARS = 4096;
export const MAX_QUARANTINE_ENTRIES = 500;
/**
 * Una sequenza propria oltre questa soglia non è plausibile (un miliardo di caricamenti): è lo
 * stato lasciato da un nome ostile letto da una versione precedente, e va ricostruito.
 */
export const SEQ_SANITY_LIMIT = 1_000_000_000;

/** Errori che riguardano tutto il giro, non un singolo file. */
const GLOBAL_ERRORS: ReadonlySet<TransportErrorCode> = new Set(["offline", "unauthorized", "rate_limited", "interrupted"]);
const MAX_KEY_FILE_BYTES = 64 * 1024;

/**
 * Chiave corrente tra quelle pubblicate: la più recente (`createdAt`), a parità l'id più alto.
 * Tutti i dispositivi arrivano alla stessa scelta, così dopo una gara tra due prime chiavi, o
 * dopo un cambio di frase, una sola resta quella con cui si scrive.
 */
export function currentKeyId(infos: readonly KeyInfo[]): string | undefined {
  let best: KeyInfo | undefined;
  for (const k of infos) {
    if (!best || k.createdAt > best.createdAt || (k.createdAt === best.createdAt && k.keyId > best.keyId)) best = k;
  }
  return best?.keyId;
}

/** Cambia quando l'app impara un formato o un tipo di evento nuovo: allora si riprova la quarantena. */
export async function syncEpoch(): Promise<string> {
  const text = `${SEGMENT_VERSION}|${[...ALL_EVENT_TYPES].sort().join(",")}`;
  return (await sha256Hex(utf8(text))).slice(0, 16);
}

function emptyReport(startedAt: string): SyncReport {
  return {
    status: "ok",
    startedAt,
    finishedAt: startedAt,
    received: { segments: 0, events: 0, added: 0, conflicts: 0 },
    sent: { segments: 0, events: 0 },
    quarantined: 0,
    released: 0,
    locked: 0,
    unknownKeys: [],
    skipped: [],
    overflow: 0,
    recovered: false,
    missing: [],
    clock: [],
    manifestUpdated: false,
  };
}

function eventText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

async function rawSnapshot(bytes: Uint8Array): Promise<Pick<QuarantineEntry, "raw" | "truncated" | "size" | "digest">> {
  const text = fromUtf8(bytes.length > MAX_RAW_CHARS * 4 ? bytes.slice(0, MAX_RAW_CHARS * 4) : bytes);
  const truncated = bytes.length > MAX_RAW_CHARS * 4 || text.length > MAX_RAW_CHARS;
  return { raw: text.slice(0, MAX_RAW_CHARS), truncated, size: bytes.length, digest: await sha256Hex(bytes) };
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

type SegmentName = Extract<ReturnType<typeof parseRemoteName>, { kind: "segment" }>;

export async function runSync(options: SyncOptions): Promise<SyncReport> {
  const { transport, local } = options;
  const now = options.now ?? (() => new Date());
  const validate = options.validate ?? validateAnyEvent;
  const upload = options.upload !== false && options.packageImport !== true;
  const maxPerSegment = Math.max(1, options.maxEventsPerSegment ?? MAX_EVENTS_PER_SEGMENT);
  const maxBytes = options.maxSegmentBytes ?? MAX_SEGMENT_BYTES;
  const maxQuarantine = options.maxQuarantine ?? MAX_QUARANTINE_ENTRIES;
  const report = emptyReport(now().toISOString());
  const clock: ClockWarning[] = [];
  const unknownKeys = new Set<string>();

  try {
    const epoch = options.epoch ?? (await syncEpoch());
    const deviceId = await local.deviceId();
    const writeKey = await local.writeKey();
    if (options.requireEncryption && !writeKey) {
      return { ...report, status: "locked", error: "no_key", finishedAt: now().toISOString() };
    }
    const listing = await transport.list();
    const names = new Set(listing.map((e) => e.name));
    let state = await local.state();
    if (state.ownLastSeq >= SEQ_SANITY_LIMIT) {
      await local.resetUploadState();
      state = await local.state();
      report.recovered = true;
    }
    const quarantine = new Map((await local.quarantined()).map((q) => [q.id, q]));
    /** Sequenza più alta tra i propri segmenti autenticati (cifrati con una nostra chiave). */
    let ownSeqSeen = 0;

    /**
     * Ammette voci in quarantena entro il tetto. Se non c'è posto scarta prima le voci più vecchie
     * che non possono più diventare valide (senza `retry`); ciò che resta fuori si conta.
     */
    const admit = (entries: QuarantineEntry[]): { admitted: QuarantineEntry[]; evicted: string[]; added: number; dropped: number } => {
      const incoming = new Set(entries.map((q) => q.id));
      const replacing = entries.filter((q) => quarantine.has(q.id));
      const fresh = entries.filter((q) => !quarantine.has(q.id));
      let room = maxQuarantine - quarantine.size;
      const evicted: string[] = [];
      if (fresh.length > room) {
        const candidates = [...quarantine.values()]
          .filter((q) => q.retry === undefined && !incoming.has(q.id))
          .sort((a, b) => cmp(a.receivedAt, b.receivedAt) || cmp(a.id, b.id));
        for (const old of candidates) {
          if (fresh.length <= room) break;
          evicted.push(old.id);
          room++;
        }
      }
      const taken = fresh.slice(0, Math.max(0, room));
      for (const id of evicted) quarantine.delete(id);
      const admitted = [...replacing, ...taken];
      for (const q of admitted) quarantine.set(q.id, q);
      const dropped = fresh.length - taken.length;
      report.overflow += evicted.length + dropped;
      return { admitted, evicted, added: taken.length, dropped };
    };

    const quarantineSegment = async (
      name: string,
      entry: Omit<QuarantineEntry, "id" | "kind" | "segment" | "receivedAt" | "errors" | "raw"> &
        Partial<Pick<QuarantineEntry, "errors" | "raw">>,
      markSeen: boolean,
      packageOrigin: boolean,
    ): Promise<void> => {
      const q: QuarantineEntry = {
        id: `seg:${name}`,
        kind: "segment",
        segment: name,
        receivedAt: now().toISOString(),
        errors: [],
        raw: "",
        ...entry,
        ...(packageOrigin ? { origin: "package" as const, retry: undefined } : {}),
      };
      const { admitted, evicted, added } = admit([q]);
      await local.commitIncoming({
        segment: name,
        events: [],
        remoteKeys: [],
        quarantine: admitted,
        release: evicted,
        markSeen: markSeen && !packageOrigin,
      });
      report.quarantined += added;
    };

    const processSegment = async (name: string, bytes: Uint8Array, entry: RemoteEntry | undefined, packageOrigin: boolean) => {
      const decoded = await decodeSegment(name, bytes, (id) => local.keyFor(id), { requireEncryption: options.requireEncryption });
      const receivedAt = now().toISOString();
      const previous = quarantine.get(`seg:${name}`);
      if (decoded.status === "locked") {
        report.locked++;
        unknownKeys.add(decoded.keyId);
        return;
      }
      if (decoded.status === "future") {
        // Si riprova (riscaricando) quando l'app cambia: intanto il segmento non è "visto".
        await quarantineSegment(
          name,
          { reason: "future_version", deviceId: decoded.deviceId, errors: [`version:${decoded.version}`], retry: "segment", epoch, ...(await rawSnapshot(bytes)) },
          false,
          packageOrigin,
        );
        return;
      }
      if (decoded.status === "rejected") {
        await quarantineSegment(name, { reason: decoded.reason, deviceId: decoded.deviceId, ...(await rawSnapshot(bytes)) }, true, packageOrigin);
        return;
      }
      const { header, events } = decoded;
      const valid = new Map<string, AnyEvent>();
      const entries: QuarantineEntry[] = [];
      for (const [index, e] of events.entries()) {
        const errors = validate(e);
        if (errors.length === 0) {
          valid.set(await eventKey(e), e as AnyEvent);
          continue;
        }
        const future = !isKnownEvent(e) || errors.some((x) => x.path === "schemaVersion");
        const text = eventText(e);
        const snap = await rawSnapshot(utf8(text));
        entries.push({
          id: `ev:${name}:${index}`,
          kind: "event",
          reason: future ? "future_event" : "invalid_event",
          segment: name,
          deviceId: header.deviceId,
          index,
          receivedAt,
          errors: errors.map((x) => `${x.path}:${x.code}`),
          ...snap,
          // Solo un evento conservato per intero si può rivalutare.
          ...(snap.truncated ? {} : { retry: "event" as const, epoch }),
          ...(packageOrigin ? { origin: "package" as const } : {}),
        });
      }
      // Gli eventi validi si applicano sempre, anche con la quarantena piena. Se qualche evento non
      // applicabile resta fuori, il segmento non è "visto": si riprova al giro dopo (applicare è idempotente).
      const { admitted, evicted, added, dropped } = admit(entries);
      // Presenti sul remoto solo se scritti con la chiave con cui questo dispositivo scrive.
      const countsAsRemote = !packageOrigin && (!writeKey || header.encryption?.keyId === writeKey.keyId);
      const stats = await local.commitIncoming({
        segment: name,
        events: [...valid.values()],
        remoteKeys: countsAsRemote ? [...valid.keys()] : [],
        quarantine: admitted,
        release: [...new Set([...evicted, ...(previous ? [previous.id] : [])])],
        markSeen: !packageOrigin && dropped === 0,
      });
      if (previous) {
        quarantine.delete(previous.id);
        report.released++;
      }
      report.received.segments++;
      report.received.events += valid.size;
      report.received.added += stats.added;
      report.received.conflicts += stats.conflicts;
      report.quarantined += added;
      if (header.deviceId === deviceId && header.encryption !== null && header.seq < SEQ_SANITY_LIMIT) {
        ownSeqSeen = Math.max(ownSeqSeen, header.seq);
      }
      const skew = clockSkewMs(header.createdAt, entry?.modifiedAt);
      if (skew !== undefined) clock.push({ deviceId: header.deviceId, kind: "device_clock", skewMs: skew });
      const refMs = entry?.modifiedAt ? Date.parse(entry.modifiedAt) : now().getTime();
      clock.push({ deviceId: header.deviceId, kind: "future_records", skewMs: futureRecordsMs([...valid.values()], refMs) });
    };

    // Chiave di scrittura: si carica solo con la chiave corrente del remoto. Una chiave nuova si
    // pubblica solo se sul remoto non ce n'è nessuna, o se questo dispositivo ha già tutte quelle
    // pubblicate (cambio di frase voluto) e la nuova diventa la corrente.
    let canUpload = upload;
    let mismatch = false;
    let keyUnreadable = false;
    if (writeKey && upload) {
      const remoteKeys: KeyInfo[] = [];
      let uncertain = false;
      for (const e of listing) {
        const p = parseRemoteName(e.name);
        if (p.kind !== "key") continue;
        if (e.size !== undefined && e.size > MAX_KEY_FILE_BYTES) {
          report.skipped.push({ name: e.name, code: "too_large" });
          uncertain = true;
          continue;
        }
        let file;
        try {
          file = await transport.get(e.name, { maxBytes: MAX_KEY_FILE_BYTES });
        } catch (err) {
          if (isTransportError(err) && !GLOBAL_ERRORS.has(err.code)) {
            report.skipped.push({ name: e.name, code: err.code });
            uncertain = true;
            continue;
          }
          throw err;
        }
        if (!file) continue;
        let info: KeyInfo | undefined;
        try {
          info = parseKeyInfo(JSON.parse(fromUtf8(file.bytes, true)));
        } catch {
          info = undefined;
        }
        if (info && info.keyId === p.keyId) remoteKeys.push(info);
      }
      const current = currentKeyId(remoteKeys);
      const listed = names.has(keyFileName(writeKey.keyId));
      let publish = false;
      if (uncertain) {
        canUpload = false; // una chiave remota non si legge: meglio non scrivere
        keyUnreadable = true;
      } else if (current === undefined) {
        publish = !listed;
      } else if (current !== writeKey.keyId) {
        const holdsAll = (await Promise.all(remoteKeys.map((k) => local.keyFor(k.keyId)))).every(Boolean);
        if (!listed && holdsAll && currentKeyId([...remoteKeys, writeKey.keyInfo]) === writeKey.keyId) publish = true;
        else mismatch = true;
      }
      if (mismatch) canUpload = false;
      if (publish) {
        try {
          await transport.put(keyFileName(writeKey.keyId), utf8(JSON.stringify(writeKey.keyInfo)), { ifRevision: null });
        } catch (e) {
          if (!isTransportError(e) || e.code !== "precondition_failed") throw e;
        }
      }
      // Passati a un'altra chiave: ciò che risultava caricato lo era con la vecchia, che gli altri
      // possono non avere. Si rilegge tutto e si ripubblica con la corrente ciò che lì manca.
      if (canUpload && state.uploadKeyId !== writeKey.keyId && (state.uploadKeyId !== undefined || state.ownLastSeq > 0)) {
        await local.resetUploadState();
        state = await local.state();
      }
    }
    for (const e of listing) {
      const p = parseRemoteName(e.name);
      if (p.kind === "key" && !(await local.keyFor(p.keyId))) unknownKeys.add(p.keyId);
    }

    // 1. Scarica e applica i segmenti non ancora visti, in ordine deterministico.
    const packageOrigin = options.packageImport === true;
    const segments = listing
      .map((entry) => ({ entry, parsed: parseRemoteName(entry.name) }))
      .filter((s): s is { entry: RemoteEntry; parsed: SegmentName } => s.parsed.kind === "segment")
      .sort((a, b) => cmp(a.parsed.deviceId, b.parsed.deviceId) || a.parsed.seq - b.parsed.seq || cmp(a.entry.name, b.entry.name));
    for (const { entry } of segments) {
      if (state.seen.has(entry.name)) continue;
      const deferred = quarantine.get(`seg:${entry.name}`);
      if (deferred && (deferred.retry !== "segment" || deferred.epoch === epoch)) continue;
      if (entry.size !== undefined && entry.size > maxBytes) {
        await quarantineSegment(entry.name, { reason: "too_large", size: entry.size }, true, packageOrigin);
        continue;
      }
      let file;
      try {
        file = await transport.get(entry.name, { maxBytes });
      } catch (e) {
        if (isTransportError(e) && e.code === "too_large") {
          await quarantineSegment(entry.name, { reason: "too_large", size: entry.size }, true, packageOrigin);
          continue;
        }
        if (isTransportError(e) && !GLOBAL_ERRORS.has(e.code)) {
          report.skipped.push({ name: entry.name, code: e.code });
          continue;
        }
        throw e;
      }
      if (!file) continue;
      if (file.bytes.length > maxBytes) {
        await quarantineSegment(entry.name, { reason: "too_large", size: file.bytes.length }, true, packageOrigin);
        continue;
      }
      await processSegment(entry.name, file.bytes, file.entry, packageOrigin);
    }

    // 2. Rivaluta gli eventi in quarantena, solo se l'app è cambiata da quando sono arrivati.
    if (!packageOrigin) {
      for (const q of [...quarantine.values()]) {
        if (q.kind !== "event" || q.retry !== "event" || q.epoch === epoch) continue;
        let event: unknown;
        try {
          event = JSON.parse(q.raw);
        } catch {
          continue;
        }
        const pkg = q.origin === "package";
        if (validate(event).length > 0) {
          const updated = { ...q, epoch };
          await local.commitIncoming({ segment: q.segment, events: [], remoteKeys: [], quarantine: [updated], release: [], markSeen: false });
          quarantine.set(q.id, updated);
          continue;
        }
        const stats = await local.commitIncoming({
          segment: q.segment,
          events: [event as AnyEvent],
          remoteKeys: pkg ? [] : [await eventKey(event)],
          quarantine: [],
          release: [q.id],
          markSeen: false,
        });
        quarantine.delete(q.id);
        report.released++;
        report.received.added += stats.added;
        report.received.conflicts += stats.conflicts;
      }
    }

    // 3. Carica i propri eventi nuovi in segmenti nuovi (mai riscritti). La sequenza viene solo
    //    dallo stato locale e dai propri segmenti autenticati, mai dai nomi dei file.
    const ownListed: ManifestSegment[] = segments
      .filter((s) => s.parsed.deviceId === deviceId && s.parsed.seq < SEQ_SANITY_LIMIT && state.seen.has(s.entry.name))
      .map((s) => ({ name: s.entry.name, seq: s.parsed.seq }));
    const uploaded: ManifestSegment[] = [];
    if (canUpload) {
      const pending = await local.pending();
      const unique = new Map<string, AnyEvent>();
      const keys = await eventKeys(pending.events);
      pending.events.forEach((e, i) => unique.set(keys[i], e));
      const all = [...unique.entries()];
      let seq = Math.max(state.ownLastSeq, ownSeqSeen, 0) + 1;
      for (let i = 0; i < all.length; i += maxPerSegment) {
        const chunk = all.slice(i, i + maxPerSegment);
        if (!isSeq(seq)) throw new RangeError("invalid_seq");
        const createdAt = now().toISOString();
        const enc = await encodeSegment({ deviceId, seq, createdAt, events: chunk.map(([, e]) => e), key: writeKey });
        const check = parseRemoteName(enc.name);
        if (check.kind !== "segment" || check.deviceId !== deviceId || check.seq !== seq) throw new RangeError("unreadable_name");
        try {
          const entry = await transport.put(enc.name, enc.bytes, { ifRevision: null });
          const skew = clockSkewMs(createdAt, entry.modifiedAt);
          if (skew !== undefined) clock.push({ deviceId, kind: "device_clock", skewMs: skew });
        } catch (e) {
          // Stesso nome vuol dire stessa impronta: il segmento identico c'è già.
          if (!isTransportError(e) || e.code !== "precondition_failed") throw e;
        }
        const last = i + maxPerSegment >= all.length;
        await local.commitOutgoing({
          segment: enc.name,
          remoteKeys: chunk.map(([k]) => k),
          seq,
          cursor: last ? pending.cursor : undefined,
          keyId: writeKey?.keyId ?? null,
        });
        uploaded.push({ name: enc.name, seq });
        report.sent.segments++;
        report.sent.events += chunk.length;
        seq++;
      }
      if (all.length === 0 && pending.cursor !== undefined) {
        await local.commitOutgoing({ remoteKeys: [], seq: state.ownLastSeq, cursor: pending.cursor, keyId: writeKey?.keyId ?? null });
      }

      // 4. Manifesto del dispositivo, con precondizione sulla revisione.
      const mine = mergeManifestSegments(ownListed, uploaded);
      if (mine.length > 0) report.manifestUpdated = await writeManifest(transport, deviceId, mine, now, clock);
    }

    // 5. Manifesti degli altri: segmenti mancanti e orologi. Un manifesto illeggibile si salta.
    for (const e of listing) {
      const p = parseRemoteName(e.name);
      if (p.kind !== "manifest" || p.deviceId === deviceId) continue;
      let file;
      try {
        file = await transport.get(e.name, { maxBytes });
      } catch (err) {
        if (isTransportError(err) && !GLOBAL_ERRORS.has(err.code)) continue;
        throw err;
      }
      if (!file || file.entry.revision !== e.revision) continue; // cambiato dopo l'elenco
      const m = readManifest(file.bytes);
      if (!m || m.deviceId !== p.deviceId) continue;
      for (const s of m.segments) if (!names.has(s.name)) report.missing.push({ deviceId: m.deviceId, name: s.name });
      const skew = clockSkewMs(m.updatedAt, file.entry.modifiedAt);
      if (skew !== undefined) clock.push({ deviceId: m.deviceId, kind: "device_clock", skewMs: skew });
    }
    if (mismatch || keyUnreadable) {
      report.status = "locked";
      report.error = mismatch ? "key_mismatch" : "key_unreadable";
    }
  } catch (e) {
    report.status = "failed";
    report.error = isTransportError(e) ? e.code : "unexpected";
  }
  report.unknownKeys = [...unknownKeys].sort();
  report.clock = collectClockWarnings(clock, options.clockToleranceMs ?? CLOCK_TOLERANCE_MS);
  report.finishedAt = now().toISOString();
  return report;
}

function readManifest(bytes: Uint8Array): Manifest | undefined {
  try {
    return parseManifest(JSON.parse(fromUtf8(bytes, true)));
  } catch {
    return undefined;
  }
}

const MANIFEST_ATTEMPTS = 3;

/** Il manifesto è un aiuto: se non si riesce a scriverlo, la sincronizzazione resta valida. */
async function writeManifest(
  transport: SyncTransport,
  deviceId: string,
  mine: ManifestSegment[],
  now: () => Date,
  clock: ClockWarning[],
): Promise<boolean> {
  const name = manifestName(deviceId);
  for (let attempt = 0; attempt < MANIFEST_ATTEMPTS; attempt++) {
    try {
      const current = await transport.get(name);
      const existing = current ? readManifest(current.bytes) : undefined;
      const segments = mergeManifestSegments(existing?.segments ?? [], mine);
      if (existing && existing.segments.length === segments.length) return false;
      const updatedAt = now().toISOString();
      const manifest: Manifest = {
        format: MANIFEST_FORMAT,
        version: MANIFEST_VERSION,
        deviceId,
        updatedAt,
        lastSeq: Math.max(0, ...segments.map((s) => s.seq)),
        segments,
      };
      const entry = await transport.put(name, utf8(JSON.stringify(manifest)), {
        ifRevision: current ? current.entry.revision : null,
      });
      const skew = clockSkewMs(updatedAt, entry.modifiedAt);
      if (skew !== undefined) clock.push({ deviceId, kind: "device_clock", skewMs: skew });
      return true;
    } catch (e) {
      if (isTransportError(e) && e.code === "precondition_failed") continue;
      return false;
    }
  }
  return false;
}
