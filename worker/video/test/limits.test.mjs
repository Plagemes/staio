import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALLOWED_DOMAINS } from "../src/url.mjs";
import { HARD_LIMITS, checkInfo, clampInt, cleanText, frameTimestamps, keepFrames } from "../src/limits.mjs";

const base = {
  extractor_key: "Instagram",
  webpage_url: "https://www.instagram.com/reel/abc/",
  duration: 60,
  description: "Pasta",
};
const opts = { maxDurationSec: 300, maxFileBytes: 80 * 1024 * 1024, domains: ALLOWED_DOMAINS };

describe("checkInfo", () => {
  it("accetta un video normale e arrotonda la durata", () => {
    assert.deepEqual(checkInfo({ ...base, duration: 59.96 }, opts), { ok: true, durationSec: 60 });
  });
  it("rifiuta oltre cinque minuti", () => {
    assert.deepEqual(checkInfo({ ...base, duration: 300.4 }, opts), { ok: false, code: "too_long" });
    assert.equal(checkInfo({ ...base, duration: 300 }, opts).ok, true);
  });
  it("rifiuta durata assente, nulla o non numerica", () => {
    for (const duration of [undefined, null, 0, -5, NaN, Infinity, "60"]) {
      assert.equal(checkInfo({ ...base, duration }, opts).ok, false, String(duration));
    }
  });
  it("rifiuta le dirette", () => {
    assert.equal(checkInfo({ ...base, is_live: true }, opts).ok, false);
    assert.equal(checkInfo({ ...base, live_status: "is_live" }, opts).ok, false);
    assert.equal(checkInfo({ ...base, live_status: "is_upcoming" }, opts).ok, false);
  });
  it("un video per richiesta: niente elenchi", () => {
    assert.deepEqual(checkInfo({ ...base, _type: "playlist" }, opts), { ok: false, code: "invalid_url" });
    assert.deepEqual(checkInfo({ ...base, entries: [{}] }, opts), { ok: false, code: "invalid_url" });
  });
  it("rifiuta l'estrattore generico e le pagine fuori elenco, anche dopo i reindirizzamenti", () => {
    assert.deepEqual(checkInfo({ ...base, extractor_key: "Generic" }, opts), { ok: false, code: "domain_not_allowed" });
    assert.deepEqual(checkInfo({ ...base, webpage_url: "https://evil.example/v" }, opts), { ok: false, code: "domain_not_allowed" });
    assert.deepEqual(checkInfo({ ...base, webpage_url: "https://instagram.com.evil.example/v" }, opts), { ok: false, code: "domain_not_allowed" });
    assert.equal(checkInfo({ ...base, webpage_url: undefined }, opts).ok, false);
  });
  it("rifiuta file dichiarati troppo grandi", () => {
    assert.deepEqual(checkInfo({ ...base, filesize_approx: 81 * 1024 * 1024 }, opts), { ok: false, code: "too_large" });
    assert.equal(checkInfo({ ...base, filesize: 10 }, opts).ok, true);
  });
  it("rifiuta metadati che non sono un oggetto", () => {
    for (const v of [null, undefined, 5, "x", []]) assert.equal(checkInfo(v, opts).ok, false);
  });
});

describe("frameTimestamps", () => {
  it("al centro di parti uguali", () => {
    assert.deepEqual(frameTimestamps(80, 4), [10, 30, 50, 70]);
  });
  it("mai più di otto, mai con durata nulla", () => {
    assert.equal(frameTimestamps(100, 50).length, 8);
    assert.deepEqual(frameTimestamps(0, 4), []);
    assert.deepEqual(frameTimestamps(60, 0), []);
    assert.deepEqual(frameTimestamps(NaN, 4), []);
  });
  it("tutti gli istanti stanno dentro il video", () => {
    for (const t of frameTimestamps(7.3, 8)) assert.ok(t > 0 && t < 7.3);
  });
});

describe("keepFrames", () => {
  it("scarta i fotogrammi troppo grandi o vuoti", () => {
    assert.deepEqual(keepFrames([100, HARD_LIMITS.maxFrameBytes + 1, 0, 200]), [0, 3]);
  });
  it("rispetta il tetto complessivo", () => {
    const each = HARD_LIMITS.maxFrameBytes;
    const kept = keepFrames(Array.from({ length: 8 }, () => each));
    assert.ok(kept.length * each <= HARD_LIMITS.maxTotalFrameBytes);
    assert.ok(kept.length < 8);
  });
});

describe("clampInt e cleanText", () => {
  it("clampInt limita e ripiega", () => {
    assert.equal(clampInt("500", 1, 300, 10), 300);
    assert.equal(clampInt("0", 1, 300, 10), 1);
    assert.equal(clampInt(undefined, 1, 300, 10), 10);
    assert.equal(clampInt("abc", 1, 300, 10), 10);
    assert.equal(clampInt("", 1, 300, 10), 10);
    assert.equal(clampInt("12.9", 1, 300, 10), 12);
  });
  it("cleanText toglie i caratteri di controllo e taglia", () => {
    assert.equal(cleanText(`a${String.fromCharCode(0)}b\r\nc`, 100), "ab\nc");
    assert.equal(cleanText("x".repeat(10_000), 5000).length, 5000);
    assert.equal(cleanText(undefined, 10), "");
    assert.equal(cleanText(12, 10), "");
  });
});
