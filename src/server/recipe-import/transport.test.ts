import { EventEmitter } from "node:events";
import type { IncomingMessage } from "node:http";
import type { RequestOptions } from "node:https";
import { PassThrough } from "node:stream";
import { brotliCompressSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { OUTGOING_HEADERS, UnsupportedEncodingError } from "./fetch-page";
import { createRateLimiter } from "./rate-limit";
import { createHttpsTransport } from "./transport";

class FakeReq extends EventEmitter {
  ended = false;
  destroyed = false;
  end(): void {
    this.ended = true;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

function fakeRes(status: number, headers: Record<string, string | string[]>, body: Buffer | string): IncomingMessage {
  const res = new PassThrough() as unknown as IncomingMessage;
  res.statusCode = status;
  res.headers = headers as IncomingMessage["headers"];
  (res as unknown as PassThrough).end(body);
  return res;
}

function setup(res: IncomingMessage | null) {
  const req = new FakeReq();
  let options: RequestOptions | undefined;
  const request = vi.fn((opts: RequestOptions, cb: (r: IncomingMessage) => void) => {
    options = opts;
    if (res) queueMicrotask(() => cb(res));
    return req as never;
  });
  return { req, request, options: () => options as RequestOptions };
}

const call = (transport: ReturnType<typeof createHttpsTransport>, url = "https://ricette.example.com/pasta?x=1", signal = new AbortController().signal) =>
  transport({ url: new URL(url), address: { address: "93.184.216.34", family: 4 }, headers: OUTGOING_HEADERS, signal });

async function readAll(it: AsyncIterable<Uint8Array>): Promise<string> {
  const parts: Uint8Array[] = [];
  for await (const c of it) parts.push(c);
  return Buffer.concat(parts).toString("utf8");
}

describe("createHttpsTransport", () => {
  it("collega all'indirizzo controllato mantenendo nome, certificato e verifica", async () => {
    const s = setup(fakeRes(200, { "content-type": "text/html" }, "<p>ciao</p>"));
    const r = await call(createHttpsTransport(s.request as never));
    const o = s.options();
    expect(o.host).toBe("ricette.example.com");
    expect(o.servername).toBe("ricette.example.com");
    expect(o.port).toBe(443);
    expect(o.method).toBe("GET");
    expect(o.path).toBe("/pasta?x=1");
    expect(o.rejectUnauthorized).toBe(true);
    expect(o.agent).toBe(false);
    expect(s.req.ended).toBe(true);
    expect(r.status).toBe(200);
    expect(await readAll(r.body)).toBe("<p>ciao</p>");

    // la risoluzione usata dalla connessione è quella già controllata, qualunque sia il nome
    const lookup = o.lookup as unknown as (h: string, opts: object, cb: (...a: unknown[]) => void) => void;
    const single = vi.fn();
    lookup("ricette.example.com", {}, single);
    expect(single).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    const all = vi.fn();
    lookup("ricette.example.com", { all: true }, all);
    expect(all).toHaveBeenCalledWith(null, [{ address: "93.184.216.34", family: 4 }]);
  });

  it("invia solo le intestazioni previste, senza cookie né credenziali", async () => {
    const s = setup(fakeRes(200, {}, ""));
    await call(createHttpsTransport(s.request as never));
    const keys = Object.keys(s.options().headers ?? {}).map((k) => k.toLowerCase()).sort();
    expect(keys).toEqual([...Object.keys(OUTGOING_HEADERS), "connection", "host"].sort());
  });

  it("non segue i reindirizzamenti: restituisce lo stato e l'intestazione Location", async () => {
    const s = setup(fakeRes(302, { location: "https://altro.example.com/" }, ""));
    const r = await call(createHttpsTransport(s.request as never));
    expect(r.status).toBe(302);
    expect(r.headers.location).toBe("https://altro.example.com/");
    expect(s.request).toHaveBeenCalledTimes(1);
  });

  it("decomprime gzip, deflate e brotli", async () => {
    const html = "<html>" + "ricetta ".repeat(500) + "</html>";
    for (const [enc, body] of [["gzip", gzipSync(html)], ["deflate", deflateSync(html)], ["br", brotliCompressSync(html)]] as const) {
      const s = setup(fakeRes(200, { "content-encoding": enc, "content-type": "text/html" }, body));
      const r = await call(createHttpsTransport(s.request as never));
      expect(await readAll(r.body), enc).toBe(html);
    }
  });

  it("rifiuta le codifiche non gestite", async () => {
    const res = fakeRes(200, { "content-encoding": "zstd" }, "x");
    const s = setup(res);
    await expect(call(createHttpsTransport(s.request as never))).rejects.toBeInstanceOf(UnsupportedEncodingError);
  });

  it("un corpo compresso corrotto fa fallire la lettura", async () => {
    const s = setup(fakeRes(200, { "content-encoding": "gzip" }, "non è gzip"));
    const r = await call(createHttpsTransport(s.request as never));
    await expect(readAll(r.body)).rejects.toBeTruthy();
  });

  it("un errore di connessione rifiuta la promessa", async () => {
    const s = setup(null);
    const p = call(createHttpsTransport(s.request as never));
    queueMicrotask(() => s.req.emit("error", new Error("ECONNREFUSED")));
    await expect(p).rejects.toThrow("ECONNREFUSED");
  });

  it("il segnale di annullamento chiude la richiesta", async () => {
    const s = setup(null);
    const ac = new AbortController();
    const p = call(createHttpsTransport(s.request as never), undefined, ac.signal);
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(s.req.destroyed).toBe(true);
    const s2 = setup(null);
    const done = new AbortController();
    done.abort();
    await expect(call(createHttpsTransport(s2.request as never), undefined, done.signal)).rejects.toThrow();
    expect(s2.req.destroyed).toBe(true);
  });

  it("close() interrompe la connessione", async () => {
    const s = setup(fakeRes(200, {}, "x"));
    const r = await call(createHttpsTransport(s.request as never));
    r.close();
    expect(s.req.destroyed).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("ammette fino al limite e poi rifiuta con il tempo di attesa", () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000, now: () => t });
    expect([1, 2, 3].map(() => rl.check("a").allowed)).toEqual([true, true, true]);
    const d = rl.check("a");
    expect(d).toEqual({ allowed: false, remaining: 0, retryAfterSeconds: 60 });
    t += 30_000;
    expect(rl.check("a").retryAfterSeconds).toBe(30);
  });

  it("i chiamanti sono indipendenti e la finestra si rinnova", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, now: () => t });
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(true);
    t = 1000;
    expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").remaining).toBe(0);
  });

  it("la memoria resta limitata: scade i vecchi e sacrifica i più vecchi", () => {
    let t = 0;
    const rl = createRateLimiter({ limit: 1, windowMs: 1000, maxKeys: 3, now: () => t });
    for (const k of ["a", "b", "c"]) rl.check(k);
    expect(rl.size()).toBe(3);
    rl.check("d");
    expect(rl.size()).toBe(3);
    t = 5000;
    rl.check("e");
    expect(rl.size()).toBe(1);
    for (let i = 0; i < 1000; i++) rl.check(`k${i}`);
    expect(rl.size()).toBeLessThanOrEqual(3);
  });
});
