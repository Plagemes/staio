import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { describe, it } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { createHandler } from "../src/handler.mjs";
import { ServiceError } from "../src/limits.mjs";

const TOKEN = "t".repeat(32);
const ORIGIN = "https://app.esempio.it";
const VIDEO = "https://www.instagram.com/reel/abc/";
const cfgOf = (extra = {}) => loadConfig({ STAIO_VIDEO_TOKEN: TOKEN, STAIO_VIDEO_CORS_ORIGIN: ORIGIN, ...extra });

/** Richiesta e risposta finte: nessuna rete, nessun server. */
function exchange({ method = "POST", url = "/estrai", headers = {}, body, ip = "10.0.0.1" } = {}) {
  const raw = body === undefined ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))];
  const req = Object.assign(Readable.from(raw), {
    method,
    url,
    headers: { "content-type": "application/json", ...headers },
    socket: { remoteAddress: ip },
  });
  const res = {
    headersSent: false,
    status: 0,
    headers: {},
    body: "",
    writeHead(status, h) {
      this.status = status;
      this.headers = h;
      this.headersSent = true;
    },
    end(chunk) {
      if (chunk) this.body += chunk;
    },
  };
  return { req, res };
}

async function call(handler, options) {
  const { req, res } = exchange(options);
  await handler(req, res);
  return { status: res.status, headers: res.headers, json: res.body ? JSON.parse(res.body) : undefined };
}

const auth = { authorization: `Bearer ${TOKEN}` };
const okExtract = async () => ({ caption: "Pasta", frames: [], durationSec: 12 });
const silent = () => {};

describe("percorsi e metodi", () => {
  const handler = createHandler(cfgOf(), { extract: okExtract, log: silent });
  it("lo stato è pubblico e non richiede il token", async () => {
    const r = await call(handler, { method: "GET", url: "/salute" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { ok: true });
  });
  it("percorsi e metodi sconosciuti", async () => {
    assert.equal((await call(handler, { url: "/altro", headers: auth })).status, 404);
    assert.equal((await call(handler, { method: "GET", url: "/estrai", headers: auth })).status, 405);
    assert.equal((await call(handler, { method: "POST", url: "/salute" })).status, 405);
  });
  it("le risposte non si conservano", async () => {
    const r = await call(handler, { method: "GET", url: "/salute" });
    assert.equal(r.headers["cache-control"], "no-store");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
  });
});

describe("CORS", () => {
  const handler = createHandler(cfgOf(), { extract: okExtract, log: silent });
  it("risponde al preflight solo per l'origine configurata", async () => {
    const ok = await call(handler, { method: "OPTIONS", headers: { origin: ORIGIN } });
    assert.equal(ok.status, 204);
    assert.equal(ok.headers["access-control-allow-origin"], ORIGIN);
    const other = await call(handler, { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    assert.equal(other.status, 403);
    assert.equal(other.headers["access-control-allow-origin"], undefined);
  });
  it("non serve le richieste di un'altra origine, nemmeno con il token giusto", async () => {
    let called = false;
    const h = createHandler(cfgOf(), { extract: async () => ((called = true), {}), log: silent });
    const r = await call(h, { headers: { ...auth, origin: "https://evil.example" }, body: { url: VIDEO } });
    assert.equal(r.status, 403);
    assert.equal(called, false);
  });
  it("senza origine configurata nessun browser è ammesso", async () => {
    const h = createHandler(loadConfig({ STAIO_VIDEO_TOKEN: TOKEN }), { extract: okExtract, log: silent });
    assert.equal((await call(h, { headers: { ...auth, origin: ORIGIN }, body: { url: VIDEO } })).status, 403);
    assert.equal((await call(h, { headers: auth, body: { url: VIDEO } })).status, 200);
  });
});

describe("autenticazione", () => {
  it("senza token o con token sbagliato: 401, e l'estrazione non parte", async () => {
    let called = false;
    const handler = createHandler(cfgOf(), { extract: async () => ((called = true), {}), log: silent });
    for (const headers of [{}, { authorization: "Bearer sbagliato" }, { authorization: `Basic ${TOKEN}` }]) {
      const r = await call(handler, { headers, body: { url: VIDEO } });
      assert.equal(r.status, 401);
      assert.deepEqual(r.json, { error: "unauthorized" });
    }
    assert.equal(called, false);
  });
});

describe("limite di richieste e posti", () => {
  it("dopo il massimo risponde 429 con Retry-After, anche per i tentativi con token sbagliato", async () => {
    const handler = createHandler(cfgOf({ STAIO_VIDEO_RATE_MAX: "2" }), { extract: okExtract, log: silent });
    await call(handler, { headers: { authorization: "Bearer x" }, body: { url: VIDEO } });
    await call(handler, { headers: auth, body: { url: VIDEO } });
    const r = await call(handler, { headers: auth, body: { url: VIDEO } });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers["retry-after"]) >= 1);
    // un altro client non è toccato
    assert.equal((await call(handler, { headers: auth, body: { url: VIDEO }, ip: "10.0.0.2" })).status, 200);
  });
  it("un solo video per volta: il secondo trova «occupato»", async () => {
    let release;
    const gate = new Promise((r) => (release = r));
    const handler = createHandler(cfgOf(), { extract: async () => (await gate, { caption: "x", frames: [], durationSec: 1 }), log: silent });
    const first = call(handler, { headers: auth, body: { url: VIDEO }, ip: "10.0.0.5" });
    await new Promise((r) => setImmediate(r));
    const second = await call(handler, { headers: auth, body: { url: VIDEO }, ip: "10.0.0.6" });
    assert.equal(second.status, 503);
    assert.deepEqual(second.json, { error: "busy" });
    release();
    assert.equal((await first).status, 200);
    // il posto torna libero
    assert.equal((await call(handler, { headers: auth, body: { url: VIDEO }, ip: "10.0.0.7" })).status, 200);
  });
  it("il posto torna libero anche se l'estrazione fallisce", async () => {
    let fail = true;
    const handler = createHandler(cfgOf(), {
      extract: async () => {
        if (fail) throw new ServiceError("unavailable", 502);
        return { caption: "x", frames: [], durationSec: 1 };
      },
      log: silent,
    });
    assert.equal((await call(handler, { headers: auth, body: { url: VIDEO } })).status, 502);
    fail = false;
    assert.equal((await call(handler, { headers: auth, body: { url: VIDEO }, ip: "10.0.0.9" })).status, 200);
  });
});

describe("corpo e indirizzo", () => {
  const handler = createHandler(cfgOf({ STAIO_VIDEO_RATE_MAX: "1000" }), { extract: okExtract, log: silent });
  it("indirizzo non valido o fuori elenco: 422 con codice, senza rieccheggiarlo", async () => {
    const bad = await call(handler, { headers: auth, body: { url: "http://www.instagram.com/x" } });
    assert.equal(bad.status, 422);
    assert.deepEqual(bad.json, { error: "invalid_url" });
    const off = await call(handler, { headers: auth, body: { url: "https://evil.example/segreto-123" } });
    assert.equal(off.status, 422);
    assert.deepEqual(off.json, { error: "domain_not_allowed" });
  });
  it("corpo non JSON, non oggetto, troppo grande o di tipo sbagliato", async () => {
    assert.equal((await call(handler, { headers: auth, body: "{non json" })).status, 400);
    assert.equal((await call(handler, { headers: auth, body: "[1,2]" })).status, 400);
    assert.equal((await call(handler, { headers: auth, body: { url: VIDEO, extra: "x".repeat(10_000) } })).status, 413);
    assert.equal((await call(handler, { headers: { ...auth, "content-type": "text/plain" }, body: { url: VIDEO } })).status, 415);
  });
  it("un solo indirizzo per richiesta: una lista è rifiutata", async () => {
    assert.equal((await call(handler, { headers: auth, body: { url: [VIDEO, VIDEO] } })).status, 422);
    assert.equal((await call(handler, { headers: auth, body: { urls: [VIDEO] } })).status, 422);
  });
  it("un indirizzo valido arriva all'estrazione già normalizzato", async () => {
    let received;
    const h = createHandler(cfgOf(), { extract: async (u) => ((received = u), { caption: "x", frames: [], durationSec: 1 }), log: silent });
    const r = await call(h, { headers: { ...auth, origin: ORIGIN }, body: { url: `${VIDEO}#frammento` } });
    assert.equal(r.status, 200);
    assert.equal(received, VIDEO);
    assert.equal(r.headers["access-control-allow-origin"], ORIGIN);
  });
});

describe("errori e registro", () => {
  it("un errore imprevisto diventa 500 senza dettagli, e non finisce nel registro", async () => {
    const lines = [];
    const handler = createHandler(cfgOf(), {
      extract: async () => {
        throw new Error(`fallito su ${VIDEO} con ${TOKEN}`);
      },
      log: (l) => lines.push(JSON.stringify(l)),
    });
    const r = await call(handler, { headers: auth, body: { url: VIDEO } });
    assert.equal(r.status, 500);
    assert.deepEqual(r.json, { error: "internal" });
    const all = lines.join("\n");
    assert.ok(!all.includes("instagram"));
    assert.ok(!all.includes(TOKEN));
  });
  it("il registro delle richieste riuscite non contiene link né contenuti", async () => {
    const lines = [];
    const handler = createHandler(cfgOf(), { extract: async () => ({ caption: "ricetta segreta", frames: [], durationSec: 3 }), log: (l) => lines.push(JSON.stringify(l)) });
    await call(handler, { headers: auth, body: { url: VIDEO } });
    const all = lines.join("\n");
    assert.ok(lines.length > 0);
    assert.ok(!all.includes("instagram"));
    assert.ok(!all.includes("segreta"));
    assert.ok(!all.includes("10.0.0.1"));
  });
});
