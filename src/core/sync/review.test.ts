// Regressioni dalla revisione indipendente (punti 1, 2, 3, 5 e parte del 6).
import { describe, expect, it } from "vitest";
import { validateAnyEvent } from "../events";
import { eventKey, fromUtf8, sha256Hex, toBase64, utf8 } from "./bytes";
import { MAX_QUARANTINE_ENTRIES, MAX_RAW_CHARS, runSync, type SyncOptions } from "./engine";
import { buildPackage, readPackage } from "./filePackage";
import { MAX_SEQ, SEGMENT_VERSION, parseRemoteName, segmentName } from "./format";
import { MemoryLocal } from "./memoryLocal";
import { MemoryTransport, type MemoryCall, type MemoryFault } from "./memoryTransport";
import { encodeSegment } from "./segment";
import { buy, testKey } from "./test-helpers";

function faulty() {
  const ctl: { fault: ((c: MemoryCall) => MemoryFault | null) | null; gets: string[] } = { fault: null, gets: [] };
  const transport = new MemoryTransport({
    fault: (c) => {
      if (c.op === "get" && c.name) ctl.gets.push(c.name);
      return ctl.fault?.(c) ?? null;
    },
  });
  return { transport, ctl };
}

const sync = (transport: MemoryTransport, local: MemoryLocal, extra: Partial<SyncOptions> = {}) => runSync({ transport, local, ...extra });

async function plainSegment(deviceId: string, seq: number, events: unknown[]) {
  return encodeSegment({ deviceId, seq, createdAt: "2026-01-01T00:00:00.000Z", events });
}

describe("1. un file che non si scarica non blocca il resto", () => {
  it("errore del singolo file: saltato, non segnato come visto, e il caricamento procede", async () => {
    const { transport: t, ctl } = faulty();
    const b = new MemoryLocal("b");
    b.author([buy("b", 1)]);
    await sync(t, b);
    b.author([buy("b", 2)]);
    await sync(t, b);
    const [broken] = [...t.snapshot().keys()].filter((n) => n.startsWith("seg.")).sort();
    ctl.fault = (c) => (c.op === "get" && c.name === broken ? { when: "before", code: "forbidden" } : null);

    const a = new MemoryLocal("a");
    a.author([buy("a", 3)]);
    for (let round = 0; round < 3; round++) {
      const r = await sync(t, a);
      expect(r.status).toBe("ok");
      expect(r.skipped).toEqual([{ name: broken, code: "forbidden" }]);
      if (round === 0) expect(r.sent.events).toBe(1);
    }
    expect(a.seen.has(broken)).toBe(false);
    expect(a.events.map((e) => e.id).sort()).toEqual([buy("a", 3).id, buy("b", 2).id].sort());
    ctl.fault = null;
    const r = await sync(t, a);
    expect(r.skipped).toEqual([]);
    expect(a.events).toHaveLength(3);
  });

  it("errore globale (rete assente, accesso negato) ferma ancora il giro", async () => {
    for (const code of ["offline", "unauthorized"] as const) {
      const { transport: t, ctl } = faulty();
      const b = new MemoryLocal("b");
      b.author([buy("b", 1)]);
      await sync(t, b);
      ctl.fault = (c) => (c.op === "get" ? { when: "before", code } : null);
      const a = new MemoryLocal("a");
      a.author([buy("a", 2)]);
      const r = await sync(t, a);
      expect(r).toMatchObject({ status: "failed", error: code, sent: { events: 0 } });
    }
  });
});

describe("2. la sequenza non si ricava dai soli nomi", () => {
  it("un nome ostile con sequenza massima non avvelena il dispositivo", async () => {
    const t = new MemoryTransport();
    const hostile = await plainSegment("a", MAX_SEQ, [buy("x", 9)]);
    expect(parseRemoteName(hostile.name)).toMatchObject({ kind: "segment", seq: MAX_SEQ });
    t.setRaw(hostile.name, hostile.bytes);
    const a = new MemoryLocal("a");
    a.author([buy("a", 1)]);
    const r = await sync(t, a);
    expect(r.status).toBe("ok");
    expect(r.sent.events).toBe(1);
    expect(a.ownLastSeq).toBeLessThan(1000);
    for (const name of t.snapshot().keys()) {
      if (name.startsWith("seg.")) expect(parseRemoteName(name).kind).toBe("segment");
    }
    const b = new MemoryLocal("b");
    await sync(t, b);
    expect(b.events.map((e) => e.id)).toContain(buy("a", 1).id);
  });

  it("la sequenza non supera mai il massimo del formato", async () => {
    await expect(plainSegment("a", MAX_SEQ + 1, [])).rejects.toThrow();
    expect(() => segmentName("a", MAX_SEQ + 1, "0".repeat(64))).toThrow();
  });

  it("un dispositivo già avvelenato si ripara e reinvia ciò che gli altri non hanno potuto leggere", async () => {
    const t = new MemoryTransport();
    const a = new MemoryLocal("a");
    const lost = buy("a", 1);
    a.author([lost]);
    // Stato lasciato dalla versione difettosa: sequenza a 11 cifre, eventi creduti inviati.
    const bogus = `seg.a.${String(MAX_SEQ + 1)}.0123456789abcdef.json`;
    t.setRaw(bogus, utf8("{}"));
    a.ownLastSeq = MAX_SEQ + 1;
    a.seen.add(bogus);
    a.remote.add(await eventKey(lost));
    const r = await sync(t, a);
    expect(r).toMatchObject({ status: "ok", recovered: true, sent: { events: 1 } });
    expect(a.ownLastSeq).toBeLessThan(1000);
    const b = new MemoryLocal("b");
    await sync(t, b);
    expect(b.events.map((e) => e.id)).toEqual([lost.id]);
  });
});

describe("3. con la cifratura richiesta non si torna al chiaro", () => {
  it("un segmento in chiaro iniettato va in quarantena e non si applica mai", async () => {
    const t = new MemoryTransport();
    const key = await testKey();
    const injected = await plainSegment("b", 1, [buy("b", 1)]);
    t.setRaw(injected.name, injected.bytes);
    const a = new MemoryLocal("a");
    a.useKey(key);
    for (let i = 0; i < 2; i++) {
      const r = await sync(t, a, { requireEncryption: true });
      expect(r.status).toBe("ok");
      expect(a.events).toEqual([]);
    }
    expect((await a.quarantined()).map((q) => q.reason)).toEqual(["unencrypted"]);
  });

  it("un segmento cifrato con una chiave sconosciuta non si applica e resta da leggere", async () => {
    const t = new MemoryTransport();
    const other = await testKey();
    const enc = await encodeSegment({ deviceId: "b", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [buy("b", 1)], key: other });
    t.setRaw(enc.name, enc.bytes);
    const a = new MemoryLocal("a");
    a.useKey(await testKey());
    const r = await sync(t, a, { requireEncryption: true });
    expect(r.locked).toBe(1);
    expect(a.events).toEqual([]);
    expect(a.seen.has(enc.name)).toBe(false);
  });
});

describe("5. quarantena con limiti", () => {
  it("un file troppo grande non si scarica: messo da parte con la sola dimensione", async () => {
    const { transport: t, ctl } = faulty();
    const big = await plainSegment("b", 1, Array.from({ length: 20 }, (_, i) => buy("b", i)));
    t.setRaw(big.name, big.bytes);
    const a = new MemoryLocal("a");
    const r = await sync(t, a, { maxSegmentBytes: 500 });
    expect(r.quarantined).toBe(1);
    expect(ctl.gets).not.toContain(big.name);
    const [q] = await a.quarantined();
    expect(q).toMatchObject({ reason: "too_large", raw: "", size: big.bytes.length });
    expect(a.events).toEqual([]);
  });

  it("contenuto troncato con l'impronta dell'originale", async () => {
    const t = new MemoryTransport();
    const junk = utf8("x".repeat(MAX_RAW_CHARS * 3));
    t.setRaw("seg.b.0000000001.0123456789abcdef.json", junk);
    const a = new MemoryLocal("a");
    await sync(t, a);
    const [q] = await a.quarantined();
    expect(q.raw.length).toBeLessThanOrEqual(MAX_RAW_CHARS);
    expect(q).toMatchObject({ truncated: true, size: junk.length, digest: await sha256Hex(junk) });
  });

  it("numero di voci limitato: oltre il tetto si scarta la voce più vecchia, e si conta", async () => {
    const t = new MemoryTransport();
    for (let i = 1; i <= 3; i++) t.setRaw(`seg.b.000000000${i}.0123456789abcde${i}.json`, utf8("{rotto"));
    const a = new MemoryLocal("a");
    const r = await sync(t, a, { maxQuarantine: 2 });
    expect(r).toMatchObject({ quarantined: 3, overflow: 1 });
    expect(a.quarantine.size).toBe(2);
    expect(a.seen.size).toBe(3);
    expect(MAX_QUARANTINE_ENTRIES).toBeGreaterThan(0);
  });

  it("ciò che è noto come rotto non si rielabora a ogni giro; ciò che può diventare valido sì, dopo un aggiornamento", async () => {
    const { transport: t, ctl } = faulty();
    t.setRaw("seg.b.0000000001.0123456789abcdef.json", utf8("{rotto"));
    const future = await plainSegment("b", 2, [buy("b", 2)]);
    const doc = JSON.parse(fromUtf8(future.bytes));
    doc.header.version = SEGMENT_VERSION + 1;
    t.setRaw(future.name, utf8(JSON.stringify(doc)));
    const unknown = { ...buy("b", 3), type: "teleport" };
    const withUnknown = await plainSegment("b", 3, [unknown]);
    t.setRaw(withUnknown.name, withUnknown.bytes);

    const a = new MemoryLocal("a");
    let validations = 0;
    const counting = (e: unknown) => {
      validations++;
      return validateAnyEvent(e);
    };
    await sync(t, a, { validate: counting, epoch: "v1" });
    expect(a.quarantine.size).toBe(3);
    ctl.gets.length = 0;
    validations = 0;
    await sync(t, a, { validate: counting, epoch: "v1" });
    expect(ctl.gets.filter((n) => n.startsWith("seg."))).toEqual([]);
    expect(validations).toBe(0);
    // Aggiornamento dell'app: il segmento di versione futura si riscarica, l'evento si rivaluta.
    const upgraded = (e: unknown) => ((e as { type?: string }).type === "teleport" ? [] : validateAnyEvent(e));
    const r = await sync(t, a, { validate: upgraded, epoch: "v2" });
    expect(ctl.gets).toContain(future.name);
    expect(r.released).toBe(1);
    expect(a.events.map((e) => e.id)).toEqual([unknown.id]);
  });
});

describe("6. chiavi degli eventi e pacchetti", () => {
  it("la chiave di una versione usa SHA-256", async () => {
    const e = buy("a", 1);
    expect(await eventKey(e)).toMatch(new RegExp(`^${e.id}\\|[0-9a-f]{64}$`));
  });

  it("i file del pacchetto con nomi non riconosciuti sono contati, non ignorati in silenzio", async () => {
    const built = await buildPackage({ deviceId: "a", events: [buy("a", 1)] });
    const doc = JSON.parse(fromUtf8(built.bytes));
    doc.files.push({ name: "altro.json", data: toBase64(utf8("{}")) }, { name: "seg.rotto.json", data: toBase64(utf8("{}")) });
    const pkg = readPackage(JSON.stringify(doc));
    expect(pkg).toMatchObject({ ok: true, ignored: 2 });
  });
});
