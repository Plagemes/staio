// Trasporto Google Drive (REST v3 con fetch), solo nella cartella nascosta appDataFolder e con
// il solo ambito drive.appdata. Il token arriva da fuori ed è tenuto solo in memoria.
//
// Drive v3 non offre scritture condizionali: le precondizioni sono verificate subito prima di
// scrivere (esistenza per i file nuovi, `version` per le riscritture). Resta una finestra
// minima tra controllo e scrittura; la sicurezza non dipende da questo, perché ogni dispositivo
// scrive solo file propri, i segmenti hanno nomi unici e immutabili, e le schede dello stesso
// dispositivo sono serializzate da un lucchetto (vedi `actions.ts`).
import {
  TransportError,
  utf8,
  type GetOptions,
  type PutPrecondition,
  type RemoteEntry,
  type RemoteFile,
  type SyncTransport,
  type TransportErrorCode,
} from "@/core/sync";

export const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";
const FILE_FIELDS = "id,name,version,size,modifiedTime";
/** 1000 file per pagina: oltre 100 pagine l'elenco non è plausibile per questa app. */
export const MAX_LIST_PAGES = 100;

export type TokenProvider = (options: { refresh: boolean }) => Promise<string>;

export interface DriveTransportOptions {
  getToken: TokenProvider;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Tentativi oltre il primo per errori temporanei (rete, 429, 5xx, limiti di frequenza). */
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

interface DriveFile {
  id: string;
  name: string;
  version?: string;
  size?: string;
  modifiedTime?: string;
}

const RETRYABLE: ReadonlySet<TransportErrorCode> = new Set(["offline", "rate_limited", "server"]);

class Attempt extends TransportError {
  constructor(
    code: TransportErrorCode,
    status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(code, code, status);
  }
}

function escapeQuery(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function toEntry(f: DriveFile): RemoteEntry {
  return {
    name: f.name,
    revision: String(f.version ?? ""),
    size: f.size !== undefined ? Number(f.size) : undefined,
    modifiedAt: f.modifiedTime,
  };
}

function isDriveFile(v: unknown): v is DriveFile {
  return typeof v === "object" && v !== null && typeof (v as DriveFile).id === "string" && typeof (v as DriveFile).name === "string";
}

/** Tra file omonimi (possibili su Drive) si sceglie sempre lo stesso: id minore. */
function pick(files: DriveFile[]): DriveFile | undefined {
  return [...files].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))[0];
}

async function classify(res: Response): Promise<Attempt> {
  const retryAfter = Number(res.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined;
  if (res.status === 401) return new Attempt("unauthorized", 401);
  if (res.status === 404) return new Attempt("not_found", 404);
  if (res.status === 412) return new Attempt("precondition_failed", 412);
  if (res.status === 429) return new Attempt("rate_limited", 429, retryAfterMs);
  if (res.status === 403) {
    let reason = "";
    try {
      const body = (await res.json()) as { error?: { errors?: { reason?: string }[] } };
      reason = body.error?.errors?.map((e) => e.reason ?? "").join(",") ?? "";
    } catch {
      // corpo non JSON
    }
    return /rateLimitExceeded|userRateLimitExceeded/.test(reason) ? new Attempt("rate_limited", 403, retryAfterMs) : new Attempt("forbidden", 403);
  }
  if (res.status >= 500) return new Attempt("server", res.status, retryAfterMs);
  return new Attempt("invalid_response", res.status);
}

export class DriveTransport implements SyncTransport {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;

  constructor(private readonly options: DriveTransportOptions) {
    this.fetchFn = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = options.random ?? Math.random;
    this.maxRetries = options.maxRetries ?? 4;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 30_000;
  }

  private delay(attempt: number, hint?: number): number {
    if (hint !== undefined) return Math.min(hint, this.maxDelayMs);
    const exp = Math.min(this.maxDelayMs, this.baseDelayMs * 2 ** attempt);
    return Math.round(exp / 2 + (exp / 2) * this.random());
  }

  private async token(refresh: boolean): Promise<string> {
    try {
      return await this.options.getToken({ refresh });
    } catch (e) {
      if (e instanceof TransportError) throw e;
      throw new TransportError("unauthorized");
    }
  }

  /** Una sola richiesta, con un rinnovo del token su 401. */
  private async once(url: string, init: RequestInit): Promise<Response> {
    for (let refreshed = false; ; refreshed = true) {
      const token = await this.token(refreshed);
      let res: Response;
      try {
        res = await this.fetchFn(url, { ...init, headers: { ...(init.headers as Record<string, string>), Authorization: `Bearer ${token}` } });
      } catch {
        throw new Attempt("offline");
      }
      if (res.ok) return res;
      const err = await classify(res);
      if (err.code === "unauthorized" && !refreshed) continue;
      throw err;
    }
  }

  /** Richiesta idempotente con attese crescenti sugli errori temporanei. */
  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(url, init);
      } catch (e) {
        if (!(e instanceof Attempt) || !RETRYABLE.has(e.code) || attempt >= this.maxRetries) throw this.plain(e);
        await this.sleep(this.delay(attempt, e.retryAfterMs));
      }
    }
  }

  private plain(e: unknown): unknown {
    return e instanceof Attempt ? new TransportError(e.code, e.code, e.status) : e;
  }

  private async json<T>(res: Response): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch {
      throw new TransportError("invalid_response");
    }
  }

  private async findByName(name: string): Promise<DriveFile | undefined> {
    const q = encodeURIComponent(`name = '${escapeQuery(name)}' and trashed = false`);
    const res = await this.request(`${API}/files?spaces=appDataFolder&q=${q}&fields=files(${FILE_FIELDS})&pageSize=100`);
    const body = await this.json<{ files?: unknown[] }>(res);
    return pick((body.files ?? []).filter(isDriveFile));
  }

  async list(): Promise<RemoteEntry[]> {
    const all: DriveFile[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    do {
      if (++pages > MAX_LIST_PAGES) throw new TransportError("too_many_files");
      const q = encodeURIComponent("trashed = false");
      const page = pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "";
      const res = await this.request(
        `${API}/files?spaces=appDataFolder&q=${q}&fields=nextPageToken,files(${FILE_FIELDS})&pageSize=1000${page}`,
      );
      const body = await this.json<{ files?: unknown[]; nextPageToken?: string }>(res);
      all.push(...(body.files ?? []).filter(isDriveFile));
      pageToken = typeof body.nextPageToken === "string" && body.nextPageToken ? body.nextPageToken : undefined;
    } while (pageToken);
    const byName = new Map<string, DriveFile[]>();
    for (const f of all) byName.set(f.name, [...(byName.get(f.name) ?? []), f]);
    return [...byName.values()].map((files) => toEntry(pick(files)!)).sort((a, b) => (a.name < b.name ? -1 : 1));
  }

  async get(name: string, options: GetOptions = {}): Promise<RemoteFile | null> {
    const file = await this.findByName(name);
    if (!file) return null;
    try {
      // Prima i metadati e poi il contenuto: se cambia nel frattempo, la revisione è la più vecchia
      // e una riscrittura condizionata fallisce invece di sovrascrivere.
      const meta = await this.json<DriveFile>(await this.request(`${API}/files/${encodeURIComponent(file.id)}?fields=${FILE_FIELDS}`));
      const max = options.maxBytes;
      if (max !== undefined && Number(meta.size ?? file.size ?? 0) > max) throw new TransportError("too_large");
      const res = await this.request(`${API}/files/${encodeURIComponent(file.id)}?alt=media`);
      const declared = Number(res.headers.get("content-length"));
      if (max !== undefined && Number.isFinite(declared) && declared > max) throw new TransportError("too_large");
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (max !== undefined && bytes.length > max) throw new TransportError("too_large");
      return { entry: toEntry({ ...file, ...meta }), bytes };
    } catch (e) {
      if (e instanceof TransportError && e.code === "not_found") return null;
      throw e;
    }
  }

  async put(name: string, bytes: Uint8Array, precondition: PutPrecondition): Promise<RemoteEntry> {
    return precondition.ifRevision === null ? this.create(name, bytes) : this.update(name, bytes, precondition.ifRevision);
  }

  private async create(name: string, bytes: Uint8Array): Promise<RemoteEntry> {
    const boundary = `sync${Math.floor(this.random() * 1e12).toString(36)}${Date.now().toString(36)}`;
    const meta = JSON.stringify({ name, parents: ["appDataFolder"], mimeType: "application/json" });
    const head = utf8(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n`);
    const tail = utf8(`\r\n--${boundary}--`);
    const body = new Uint8Array(head.length + bytes.length + tail.length);
    body.set(head, 0);
    body.set(bytes, head.length);
    body.set(tail, head.length + bytes.length);
    // La creazione non è idempotente: prima di ogni nuovo tentativo si controlla se quello
    // precedente è arrivato comunque (connessione caduta dopo la scrittura).
    for (let attempt = 0; ; attempt++) {
      const existing = await this.findByName(name);
      if (existing) {
        if (attempt === 0) throw new TransportError("precondition_failed");
        return toEntry(existing);
      }
      try {
        const res = await this.once(`${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
          method: "POST",
          headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
          body: body.buffer as ArrayBuffer,
        });
        const created = await this.json<DriveFile>(res);
        if (!isDriveFile(created)) throw new TransportError("invalid_response");
        return toEntry(created);
      } catch (e) {
        if (!(e instanceof Attempt) || !RETRYABLE.has(e.code) || attempt >= this.maxRetries) throw this.plain(e);
        await this.sleep(this.delay(attempt, e.retryAfterMs));
      }
    }
  }

  private async update(name: string, bytes: Uint8Array, ifRevision: string): Promise<RemoteEntry> {
    const file = await this.findByName(name);
    if (!file) throw new TransportError("precondition_failed");
    const meta = await this.json<DriveFile>(await this.request(`${API}/files/${encodeURIComponent(file.id)}?fields=${FILE_FIELDS}`));
    if (String(meta.version ?? "") !== ifRevision) throw new TransportError("precondition_failed");
    const res = await this.request(`${UPLOAD}/files/${encodeURIComponent(file.id)}?uploadType=media&fields=${FILE_FIELDS}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: bytes.slice().buffer as ArrayBuffer,
    });
    const updated = await this.json<DriveFile>(res);
    return toEntry({ ...file, ...updated });
  }
}
