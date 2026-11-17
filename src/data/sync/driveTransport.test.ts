import { describe, expect, it } from "vitest";
import { MemoryLocal, fromUtf8, runSync, utf8 } from "@/core/sync";
import { buy, canon, testKey } from "@/core/sync/test-helpers";
import { DriveTransport } from "./driveTransport";

interface FakeFile {
  id: string;
  name: string;
  parents: string[];
  version: number;
  modifiedTime: string;
  content: Uint8Array;
}

type Injected = { status: number; body?: unknown; headers?: Record<string, string>; apply?: boolean } | "network";

/** Drive finto: solo le chiamate che il trasporto usa, con guasti iniettabili. */
class FakeDrive {
  files: FakeFile[] = [];
  requests: { method: string; url: string; auth: string | null }[] = [];
  queue: Injected[] = [];
  validToken = "tok-1";
  private nextId = 1;
  private version = 1;

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? "GET";
    const auth = new Headers(init.headers).get("Authorization");
    this.requests.push({ method, url: url.toString(), auth });
    const injected = this.queue.shift();
    if (injected === "network") throw new TypeError("Failed to fetch");
    if (auth !== `Bearer ${this.validToken}`) return this.json(401, { error: { code: 401 } });
    if (injected && !injected.apply) return this.json(injected.status, injected.body ?? {}, injected.headers);
    const res = await this.handle(method, url, init);
    if (injected?.apply) return this.json(injected.status, injected.body ?? {}, injected.headers);
    return res;
  };

  private json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
  }

  private meta(f: FakeFile) {
    return { id: f.id, name: f.name, version: String(f.version), size: String(f.content.length), modifiedTime: f.modifiedTime };
  }

  private async handle(method: string, url: URL, init: RequestInit): Promise<Response> {
    const path = url.pathname;
    if (method === "GET" && path === "/drive/v3/files") {
      expect(url.searchParams.get("spaces")).toBe("appDataFolder");
      const q = url.searchParams.get("q") ?? "";
      const m = /name = '((?:[^'\\]|\\.)*)'/.exec(q);
      const name = m ? m[1].replace(/\\(.)/g, "$1") : undefined;
      const all = this.files.filter((f) => name === undefined || f.name === name);
      const size = Number(url.searchParams.get("pageSize") ?? 100);
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const page = all.slice(start, start + Math.min(size, 2));
      const next = start + page.length < all.length ? String(start + page.length) : undefined;
      return this.json(200, { files: page.map((f) => this.meta(f)), ...(next ? { nextPageToken: next } : {}) });
    }
    const fileMatch = /^\/(upload\/)?drive\/v3\/files\/([^/]+)$/.exec(path);
    if (fileMatch) {
      const f = this.files.find((x) => x.id === decodeURIComponent(fileMatch[2]));
      if (!f) return this.json(404, {});
      if (method === "GET" && url.searchParams.get("alt") === "media") return new Response(f.content.slice(), { status: 200 });
      if (method === "GET") return this.json(200, this.meta(f));
      if (method === "PATCH") {
        f.content = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
        f.version = ++this.version;
        f.modifiedTime = new Date().toISOString();
        return this.json(200, this.meta(f));
      }
    }
    if (method === "POST" && path === "/upload/drive/v3/files") {
      expect(url.searchParams.get("uploadType")).toBe("multipart");
      const raw = new Uint8Array(await new Response(init.body as BodyInit).arrayBuffer());
      const text = fromUtf8(raw);
      const boundary = /boundary=(.+)$/.exec(new Headers(init.headers).get("Content-Type") ?? "")![1];
      const parts = text.split(`--${boundary}`);
      const metaJson = parts[1].split("\r\n\r\n")[1].trim();
      const meta = JSON.parse(metaJson) as { name: string; parents: string[] };
      const content = parts[2].slice(parts[2].indexOf("\r\n\r\n") + 4, -2);
      const f: FakeFile = {
        id: `id${String(this.nextId++).padStart(4, "0")}`,
        name: meta.name,
        parents: meta.parents,
        version: ++this.version,
        modifiedTime: new Date().toISOString(),
        content: utf8(content),
      };
      this.files.push(f);
      return this.json(200, this.meta(f));
    }
    return this.json(400, { error: "unexpected" });
  }
}

function transport(drive: FakeDrive, sleeps: number[] = [], tokens: string[] = ["tok-1"]) {
  let i = 0;
  return new DriveTransport({
    fetch: drive.fetch as typeof fetch,
    getToken: async ({ refresh }) => {
      if (refresh) i++;
      if (i >= tokens.length) throw new Error("no token");
      return tokens[i];
    },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    random: () => 0.5,
  });
}

describe("trasporto Drive con fetch finto", () => {
  it("due dispositivi sincronizzano via Drive, tutto in appDataFolder, mai una cancellazione", async () => {
    const drive = new FakeDrive();
    const key = await testKey();
    const a = new MemoryLocal("a");
    const b = new MemoryLocal("b");
    a.useKey(key);
    b.useKey(key);
    a.author([buy("a", 1), buy("a", 2)]);
    b.author([buy("b", 3)]);
    for (const d of [a, b, a]) {
      const r = await runSync({ transport: transport(drive), local: d, requireEncryption: true });
      expect(r.status).toBe("ok");
    }
    expect(canon(a.events)).toBe(canon(b.events));
    expect(drive.files.every((f) => f.parents[0] === "appDataFolder")).toBe(true);
    expect(drive.requests.every((r) => r.method !== "DELETE")).toBe(true);
    expect(drive.requests.every((r) => r.url.startsWith("https://www.googleapis.com/"))).toBe(true);
    for (const f of drive.files) expect(fromUtf8(f.content)).not.toContain("farina");
    // Ripetere non crea file nuovi.
    const count = drive.files.length;
    await runSync({ transport: transport(drive), local: b, requireEncryption: true });
    expect(drive.files.length).toBe(count);
  });

  it("401: rinnova il token una volta e riprova", async () => {
    const drive = new FakeDrive();
    drive.validToken = "tok-2";
    const t = transport(drive, [], ["tok-1", "tok-2"]);
    expect(await t.list()).toEqual([]);
    expect(drive.requests.map((r) => r.auth)).toEqual(["Bearer tok-1", "Bearer tok-2"]);
  });

  it("401 anche dopo il rinnovo: non autorizzato", async () => {
    const drive = new FakeDrive();
    drive.validToken = "altro";
    await expect(transport(drive, [], ["tok-1", "tok-2"]).list()).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("429 e 5xx: attese crescenti, rispettando Retry-After", async () => {
    const drive = new FakeDrive();
    const sleeps: number[] = [];
    drive.queue = [{ status: 503 }, { status: 503 }, { status: 429, headers: { "Retry-After": "7" } }];
    expect(await transport(drive, sleeps).list()).toEqual([]);
    expect(sleeps).toEqual([375, 750, 7000]);
  });

  it("limite di frequenza su 403: riprova; altro 403: vietato subito", async () => {
    const drive = new FakeDrive();
    const sleeps: number[] = [];
    drive.queue = [{ status: 403, body: { error: { errors: [{ reason: "userRateLimitExceeded" }] } } }];
    await transport(drive, sleeps).list();
    expect(sleeps).toHaveLength(1);
    drive.queue = [{ status: 403, body: { error: { errors: [{ reason: "insufficientPermissions" }] } } }];
    await expect(transport(drive).list()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("senza rete: riprova con attese crescenti, poi errore chiaro e nessun dato toccato", async () => {
    const drive = new FakeDrive();
    const sleeps: number[] = [];
    drive.queue = Array.from({ length: 10 }, () => "network" as const);
    const a = new MemoryLocal("a");
    a.useKey(await testKey());
    a.author([buy("a", 1)]);
    const r = await runSync({ transport: transport(drive, sleeps), local: a, requireEncryption: true });
    expect(r).toMatchObject({ status: "failed", error: "offline" });
    expect(sleeps).toEqual([375, 750, 1500, 3000]);
    expect(a.seen.size).toBe(0);
    expect(drive.files).toEqual([]);
  });

  it("precondizioni: niente creazione sopra un file esistente, niente riscrittura con revisione vecchia", async () => {
    const drive = new FakeDrive();
    const t = transport(drive);
    const first = await t.put("man.a.json", utf8("1"), { ifRevision: null });
    await expect(t.put("man.a.json", utf8("2"), { ifRevision: null })).rejects.toMatchObject({ code: "precondition_failed" });
    const second = await t.put("man.a.json", utf8("2"), { ifRevision: first.revision });
    await expect(t.put("man.a.json", utf8("3"), { ifRevision: first.revision })).rejects.toMatchObject({ code: "precondition_failed" });
    const got = await t.get("man.a.json");
    expect(got && fromUtf8(got.bytes)).toBe("2");
    expect(got?.entry.revision).toBe(second.revision);
    await expect(t.put("man.b.json", utf8("x"), { ifRevision: "5" })).rejects.toMatchObject({ code: "precondition_failed" });
  });

  it("creazione riuscita ma risposta persa: nessun doppione", async () => {
    const drive = new FakeDrive();
    const t = transport(drive);
    // 1ª richiesta: ricerca per nome; 2ª: creazione che avviene ma risponde 503.
    drive.queue = [{ status: 200, apply: true }, { status: 503, apply: true }];
    const entry = await t.put("seg.a.0000000001.0123456789abcdef.json", utf8("{}"), { ifRevision: null });
    expect(entry.name).toBe("seg.a.0000000001.0123456789abcdef.json");
    expect(drive.files).toHaveLength(1);
  });

  it("file omonimi: si sceglie sempre lo stesso, e l'elenco segue le pagine", async () => {
    const drive = new FakeDrive();
    const t = transport(drive);
    for (const n of ["x.json", "y.json", "z.json"]) await t.put(n, utf8(n), { ifRevision: null });
    drive.files.push({ ...drive.files[0], id: "id0000" , content: utf8("copia") });
    const list = await t.list();
    expect(list.map((e) => e.name)).toEqual(["x.json", "y.json", "z.json"]);
    expect(fromUtf8((await t.get("x.json"))!.bytes)).toBe("copia");
  });

  it("non scarica un file oltre la dimensione massima", async () => {
    const drive = new FakeDrive();
    const t = transport(drive);
    await t.put("seg.big.json", utf8("x".repeat(1000)), { ifRevision: null });
    drive.requests.length = 0;
    await expect(t.get("seg.big.json", { maxBytes: 100 })).rejects.toMatchObject({ code: "too_large" });
    expect(drive.requests.some((r) => r.url.includes("alt=media"))).toBe(false);
  });

  it("l'elenco ha un limite di pagine", async () => {
    const drive = new FakeDrive();
    const endless = drive.fetch;
    drive.fetch = async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/drive/v3/files" && !url.searchParams.get("q")?.includes("name =")) {
        return new Response(JSON.stringify({ files: [], nextPageToken: "ancora" }), { status: 200 });
      }
      return endless(input, init);
    };
    await expect(transport(drive).list()).rejects.toMatchObject({ code: "too_many_files" });
  });
});
