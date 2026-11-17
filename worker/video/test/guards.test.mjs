import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { bearerToken, isAuthorized, tokensEqual } from "../src/auth.mjs";
import { loadConfig } from "../src/config.mjs";
import { corsHeaders, originAllowed, parseOrigin } from "../src/cors.mjs";
import { logLine } from "../src/logger.mjs";
import { createRateLimiter, createSlots } from "../src/rateLimit.mjs";

const TOKEN = "t".repeat(32);

describe("token", () => {
  it("legge l'intestazione Bearer", () => {
    assert.equal(bearerToken(`Bearer ${TOKEN}`), TOKEN);
    assert.equal(bearerToken(`bearer   ${TOKEN}`), TOKEN);
    for (const h of [undefined, "", "Basic abc", `Bearer`, `Bearer a b`, `Token ${TOKEN}`, 5]) assert.equal(bearerToken(h), undefined, String(h));
  });
  it("accetta solo il token giusto", () => {
    assert.equal(isAuthorized(`Bearer ${TOKEN}`, TOKEN), true);
    assert.equal(isAuthorized(`Bearer ${TOKEN}x`, TOKEN), false);
    assert.equal(isAuthorized(`Bearer ${TOKEN.slice(1)}`, TOKEN), false);
    assert.equal(isAuthorized(undefined, TOKEN), false);
    assert.equal(isAuthorized("Bearer ", TOKEN), false);
  });
  it("il confronto non lancia con lunghezze diverse", () => {
    assert.equal(tokensEqual("a", "abcdefgh"), false);
    assert.equal(tokensEqual("", ""), true);
    assert.equal(tokensEqual(undefined, "x"), false);
  });
});

describe("limite di richieste", () => {
  it("lascia passare fino al massimo, poi dice quando riprovare", () => {
    const limiter = createRateLimiter({ max: 3, windowMs: 60_000 });
    for (let i = 0; i < 3; i++) assert.deepEqual(limiter.take("a", 1000 + i), { allowed: true });
    const blocked = limiter.take("a", 2000);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfterSec >= 1 && blocked.retryAfterSec <= 60);
  });
  it("ogni client ha il suo conto e la finestra scorre", () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 });
    assert.equal(limiter.take("a", 0).allowed, true);
    assert.equal(limiter.take("b", 0).allowed, true);
    assert.equal(limiter.take("a", 500).allowed, false);
    assert.equal(limiter.take("a", 1001).allowed, true);
  });
});

describe("posti contemporanei", () => {
  it("un solo video per volta e rilascio una volta sola", () => {
    const slots = createSlots(1);
    const release = slots.acquire();
    assert.equal(typeof release, "function");
    assert.equal(slots.acquire(), undefined);
    release();
    release();
    assert.equal(slots.inUse(), 0);
    assert.equal(typeof slots.acquire(), "function");
  });
});

describe("CORS", () => {
  it("accetta solo origini pulite", () => {
    assert.equal(parseOrigin("https://app.esempio.it"), "https://app.esempio.it");
    assert.equal(parseOrigin("https://app.esempio.it/"), "https://app.esempio.it");
    assert.equal(parseOrigin("http://localhost:3000"), "http://localhost:3000");
    for (const v of ["http://app.esempio.it", "https://app.esempio.it/percorso", "https://u:p@app.esempio.it", "*", "", undefined, "https://a.it?x=1"]) {
      assert.equal(parseOrigin(v), undefined, String(v));
    }
  });
  it("risponde solo all'origine configurata", () => {
    const allowed = "https://app.esempio.it";
    assert.equal(corsHeaders(allowed, allowed)["access-control-allow-origin"], allowed);
    assert.equal(corsHeaders("https://altra.it", allowed)["access-control-allow-origin"], undefined);
    assert.equal(corsHeaders(allowed, undefined)["access-control-allow-origin"], undefined);
    assert.equal(corsHeaders(allowed, allowed, true)["access-control-allow-headers"], "authorization, content-type");
    assert.equal(corsHeaders(allowed, allowed)["vary"], "Origin");
  });
  it("rifiuta le richieste di un'altra origine, ammette quelle senza origine", () => {
    assert.equal(originAllowed(undefined, undefined), true);
    assert.equal(originAllowed("https://altra.it", "https://app.esempio.it"), false);
    assert.equal(originAllowed("https://app.esempio.it", "https://app.esempio.it"), true);
    assert.equal(originAllowed("https://app.esempio.it", undefined), false);
  });
});

describe("configurazione", () => {
  it("non parte senza un token lungo abbastanza", () => {
    assert.throws(() => loadConfig({}));
    assert.throws(() => loadConfig({ STAIO_VIDEO_TOKEN: "corto" }));
    assert.throws(() => loadConfig({ STAIO_VIDEO_TOKEN: "con spazi dentro ma lungo abbastanza davvero" }));
  });
  it("non parte con un'origine CORS non valida", () => {
    assert.throws(() => loadConfig({ STAIO_VIDEO_TOKEN: TOKEN, STAIO_VIDEO_CORS_ORIGIN: "*" }));
  });
  it("valori predefiniti prudenti", () => {
    const cfg = loadConfig({ STAIO_VIDEO_TOKEN: TOKEN });
    assert.equal(cfg.host, "127.0.0.1");
    assert.equal(cfg.maxDurationSec, 300);
    assert.equal(cfg.frames, 8);
    assert.equal(cfg.maxConcurrent, 1);
    assert.equal(cfg.corsOrigin, undefined);
    assert.equal(cfg.trustProxy, false);
    assert.ok(cfg.timeoutMs <= 300_000);
  });
  it("i limiti si possono solo abbassare", () => {
    const cfg = loadConfig({
      STAIO_VIDEO_TOKEN: TOKEN,
      STAIO_VIDEO_MAX_DURATION_SEC: "9999",
      STAIO_VIDEO_FRAMES: "50",
      STAIO_VIDEO_MAX_FILE_MB: "99999",
      STAIO_VIDEO_TIMEOUT_SEC: "99999",
      STAIO_VIDEO_CONCURRENCY: "50",
    });
    assert.equal(cfg.maxDurationSec, 300);
    assert.equal(cfg.frames, 8);
    assert.equal(cfg.maxFileBytes, 200 * 1024 * 1024);
    assert.equal(cfg.timeoutMs, 300_000);
    assert.equal(cfg.maxConcurrent, 2);
    const lower = loadConfig({ STAIO_VIDEO_TOKEN: TOKEN, STAIO_VIDEO_MAX_DURATION_SEC: "120" });
    assert.equal(lower.maxDurationSec, 120);
  });
});

describe("registro", () => {
  it("scrive solo i campi ammessi, mai link, contenuti o token", () => {
    const line = logLine(
      { event: "request", status: 200, ms: 12, url: "https://www.instagram.com/reel/x", caption: "ricetta segreta", token: TOKEN, ip: "1.2.3.4", code: "https://x" },
      new Date("2026-11-17T10:00:00Z"),
    );
    assert.deepEqual(JSON.parse(line), { t: "2026-11-17T10:00:00.000Z", event: "request", status: 200, ms: 12 });
    assert.ok(!line.includes("instagram"));
    assert.ok(!line.includes(TOKEN));
  });
});
