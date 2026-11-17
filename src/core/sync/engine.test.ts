import { describe, expect, it } from "vitest";
import { mergeAllEvents, validateAnyEvent, type AnyEvent } from "../events";
import { seededRandom, shuffled } from "../ledger/test-helpers";
import { eventKey, fromUtf8, utf8 } from "./bytes";
import { runSync, type SyncReport, type WriteKey } from "./engine";
import { SEGMENT_VERSION, manifestName, parseManifest, parseRemoteName } from "./format";
import { MemoryLocal } from "./memoryLocal";
import { MemoryTransport, type MemoryCall, type MemoryFault } from "./memoryTransport";
import { decodeSegment, encodeSegment } from "./segment";
import { buy, canon, testKey, voidEv } from "./test-helpers";

/** Trasporto con guasti decisi da una funzione sostituibile durante il test. */
function faulty(now?: () => Date) {
  const ctl: { fault: ((c: MemoryCall) => MemoryFault | null) | null } = { fault: null };
  const transport = new MemoryTransport({ now, fault: (c) => ctl.fault?.(c) ?? null });
  return { transport, ctl };
}

function device(id: string, key?: WriteKey): MemoryLocal {
  const d = new MemoryLocal(id);
  if (key) d.useKey(key);
  return d;
}

const sync = (transport: MemoryTransport, local: MemoryLocal, extra: Partial<Parameters<typeof runSync>[0]> = {}) =>
  runSync({ transport, local, ...extra });

/** Tutte le versioni di evento presenti nei segmenti remoti, con il numero di copie. */
async function remoteKeys(transport: MemoryTransport, key?: WriteKey): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const [name, bytes] of transport.snapshot()) {
    if (parseRemoteName(name).kind !== "segment") continue;
    const dec = await decodeSegment(name, bytes, async (id) => (key && id === key.keyId ? key.key : undefined));
    expect(dec.status).toBe("ok");
    if (dec.status !== "ok") continue;
    for (const e of dec.events) {
      const k = await eventKey(e);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return counts;
}

function expectNoRemoteDuplicates(counts: Map<string, number>): void {
  expect([...counts.entries()].filter(([, n]) => n > 1)).toEqual([]);
}

describe("eventi di prova", () => {
  it("sono validi per validateAnyEvent", () => {
    const e = buy("a", 1);
    expect(validateAnyEvent(e)).toEqual([]);
    expect(validateAnyEvent(voidEv("a", e, 2))).toEqual([]);
  });
});

describe("convergenza", () => {
  it("due dispositivi si scambiano gli eventi", async () => {
    const t = new MemoryTransport();
    const a = device("a");
    const b = device("b");
    a.author([buy("a", 1), buy("a", 2)]);
    b.author([buy("b", 3)]);
    const ra = await sync(t, a);
    expect(ra).toMatchObject({ status: "ok", sent: { segments: 1, events: 2 } });
    const rb = await sync(t, b);
    expect(rb).toMatchObject({ status: "ok", received: { segments: 1, added: 2 }, sent: { events: 1 } });
    await sync(t, a);
    expect(canon(a.events)).toBe(canon(b.events));
    expect(a.events).toHaveLength(3);
  });

  it("tre dispositivi in ordini casuali a seme fisso convergono, con e senza cifratura", async () => {
    const key = await testKey();
    for (let seed = 1; seed <= 24; seed++) {
      const rnd = seededRandom(seed);
      const t = new MemoryTransport();
      const encrypted = seed % 2 === 0;
      const ids = ["a", "b", "c"];
      const devices = ids.map((id) => device(id, encrypted ? key : undefined));
      const created: AnyEvent[] = [];
      let n = seed * 1000;
      for (let step = 0; step < 30; step++) {
        const d = devices[Math.floor(rnd() * devices.length)];
        if (rnd() < 0.55) {
          const batch: AnyEvent[] = [];
          const k = 1 + Math.floor(rnd() * 3);
          for (let i = 0; i < k; i++) batch.push(buy(d.id, n++));
          if (created.length > 0 && rnd() < 0.3) batch.push(voidEv(d.id, created[Math.floor(rnd() * created.length)], n++));
          d.author(batch);
          created.push(...batch);
        } else {
          const r = await sync(t, d, { maxEventsPerSegment: 1 + Math.floor(rnd() * 4) });
          expect(r.status).toBe("ok");
        }
      }
      for (let round = 0; round < 2; round++) {
        for (const d of shuffled(devices, rnd)) expect((await sync(t, d)).status).toBe("ok");
      }
      const expected = canon(mergeAllEvents([], created).events);
      for (const d of devices) {
        expect(canon(d.events)).toBe(expected);
        expect((await d.pending()).events).toEqual([]);
      }
      expectNoRemoteDuplicates(await remoteKeys(t, encrypted ? key : undefined));
    }
  }, 30_000);

  it("lo stesso evento con contenuti diversi su due dispositivi converge alla stessa versione", async () => {
    const t = new MemoryTransport();
    const a = device("a");
    const b = device("b");
    const base = buy("a", 1);
    a.author([base]);
    b.author([{ ...base, recordedAt: "2026-03-01T00:00:00.000Z" } as AnyEvent]);
    await sync(t, a);
    await sync(t, b);
    await sync(t, a);
    await sync(t, b);
    expect(canon(a.events)).toBe(canon(b.events));
  });
});

describe("idempotenza", () => {
  it("ripetere la sincronizzazione non cambia né lo stato locale né il remoto", async () => {
    const t = new MemoryTransport();
    const a = device("a");
    const b = device("b");
    a.author([buy("a", 1)]);
    b.author([buy("b", 2)]);
    await sync(t, a);
    await sync(t, b);
    await sync(t, a);
    const before = { a: canon(a.events), b: canon(b.events), files: [...t.snapshot().keys()] };
    for (const d of [a, b, a, b]) {
      const r = await sync(t, d);
      expect(r).toMatchObject({ status: "ok", sent: { segments: 0 }, received: { segments: 0 }, quarantined: 0, manifestUpdated: false });
    }
    expect({ a: canon(a.events), b: canon(b.events), files: [...t.snapshot().keys()] }).toEqual(before);
    for (const [name, bytes] of t.snapshot()) expect(t.snapshot().get(name)).toEqual(bytes);
  });
});

describe("interruzioni", () => {
  async function scenario(fault: (c: MemoryCall) => MemoryFault | null, localFault?: (op: string) => "before" | "after" | null) {
    const { transport: t, ctl } = faulty();
    const key = await testKey();
    const a = device("a", key);
    const b = device("b", key);
    a.author([buy("a", 1), buy("a", 2)]);
    b.author([buy("b", 3)]);
    await sync(t, b);
    a.author([buy("a", 4)]);
    ctl.fault = fault;
    a.fault = localFault ?? undefined;
    const faulted = await sync(t, a, { maxEventsPerSegment: 2 });
    ctl.fault = null;
    a.fault = undefined;
    for (const d of [a, b, a, b]) expect((await sync(t, d)).status).toBe("ok");
    const expected = canon(mergeAllEvents([], [buy("a", 1), buy("a", 2), buy("b", 3), buy("a", 4)]).events);
    expect(canon(a.events)).toBe(expected);
    expect(canon(b.events)).toBe(expected);
    expectNoRemoteDuplicates(await remoteKeys(t, key));
    return faulted.status;
  }

  it("un guasto di rete prima o dopo qualunque chiamata non perde né duplica eventi", async () => {
    const statuses: string[] = [];
    for (let index = 0; index < 20; index++) {
      for (const when of ["before", "after"] as const) {
        let seen = -1;
        statuses.push(
          await scenario((c) => {
            if (seen < 0) seen = c.index;
            return c.index - seen === index ? { when } : null;
          }),
        );
      }
    }
    // Il giro guasto fallisce davvero (il manifesto è facoltativo: un suo guasto non fa fallire).
    expect(statuses.filter((s) => s === "failed").length).toBeGreaterThanOrEqual(10);
    expect(statuses.at(-1)).toBe("ok");
  });

  it("un arresto prima o dopo ogni scrittura locale non perde né duplica eventi", async () => {
    for (const op of ["commitIncoming", "commitOutgoing"]) {
      for (const phase of ["before", "after"] as const) {
        for (let nth = 0; nth < 3; nth++) {
          let count = 0;
          const status = await scenario(() => null, (o) => (o === op && count++ === nth ? phase : null));
          if (nth === 0) expect(status).toBe("failed");
        }
      }
    }
  });

  it("caricamento riuscito ma risposta persa: il segmento si ritrova e non si ricarica", async () => {
    const { transport: t, ctl } = faulty();
    const a = device("a");
    a.author([buy("a", 1)]);
    ctl.fault = (c) => (c.op === "put" && c.name?.startsWith("seg.") ? { when: "after" } : null);
    expect((await sync(t, a)).status).toBe("failed");
    ctl.fault = null;
    const r = await sync(t, a);
    expect(r.sent.segments).toBe(0);
    expect([...t.snapshot().keys()].filter((n) => n.startsWith("seg."))).toHaveLength(1);
    expect((await a.pending()).events).toEqual([]);
  });
});

describe("caricamenti concorrenti", () => {
  it("due dispositivi che caricano insieme non si sovrascrivono", async () => {
    const rnd = seededRandom(9);
    const t = new MemoryTransport({ delay: () => new Promise((r) => setTimeout(r, Math.floor(rnd() * 3))) });
    const a = device("a");
    const b = device("b");
    a.author([buy("a", 1), buy("a", 2)]);
    b.author([buy("b", 3)]);
    const [ra, rb] = await Promise.all([sync(t, a), sync(t, b)]);
    expect(ra.status).toBe("ok");
    expect(rb.status).toBe("ok");
    await Promise.all([sync(t, a), sync(t, b)]);
    expect(canon(a.events)).toBe(canon(b.events));
    expect(a.events).toHaveLength(3);
    expect([...t.snapshot().keys()].filter((n) => n.startsWith("man."))).toHaveLength(2);
  });

  it("due schede dello stesso dispositivo: segmenti distinti e manifesto completo", async () => {
    const rnd = seededRandom(4);
    const key = await testKey();
    const t = new MemoryTransport({ delay: () => new Promise((r) => setTimeout(r, Math.floor(rnd() * 3))) });
    const a = device("a", key);
    a.author([buy("a", 1)]);
    const [r1, r2] = await Promise.all([sync(t, a), sync(t, a)]);
    expect(r1.status).toBe("ok");
    expect(r2.status).toBe("ok");
    await sync(t, a);
    const segs = [...t.snapshot().keys()].filter((n) => n.startsWith("seg."));
    const manifest = parseManifest(JSON.parse(fromUtf8(t.snapshot().get(manifestName("a"))!)))!;
    expect(manifest.segments.map((s) => s.name).sort()).toEqual(segs.sort());
    const b = device("b", key);
    await sync(t, b);
    expect(canon(b.events)).toBe(canon(a.events));
  });

  it("un file esistente non viene mai riscritto senza la revisione giusta", async () => {
    const t = new MemoryTransport();
    const first = await t.put("seg.x.json", utf8("1"), { ifRevision: null });
    await expect(t.put("seg.x.json", utf8("2"), { ifRevision: null })).rejects.toMatchObject({ code: "precondition_failed" });
    await expect(t.put("seg.x.json", utf8("2"), { ifRevision: "999" })).rejects.toMatchObject({ code: "precondition_failed" });
    await t.put("seg.x.json", utf8("2"), { ifRevision: first.revision });
    expect(fromUtf8(t.snapshot().get("seg.x.json")!)).toBe("2");
  });
});

describe("segmenti guasti e quarantena", () => {
  async function setup() {
    const t = new MemoryTransport();
    const a = device("a");
    const b = device("b");
    b.author([buy("b", 1)]);
    await sync(t, b);
    b.author([buy("b", 2)]);
    await sync(t, b);
    return { t, a, b };
  }

  it("un segmento alterato è rifiutato e conservato, gli altri sono applicati", async () => {
    const { t, a } = await setup();
    const [first] = [...t.snapshot().keys()].filter((n) => n.startsWith("seg.")).sort();
    const bytes = t.snapshot().get(first)!;
    const doc = JSON.parse(fromUtf8(bytes));
    doc.payload = doc.payload.slice(0, -4) + "AAA=";
    const altered = utf8(JSON.stringify(doc));
    t.setRaw(first, altered);
    const r = await sync(t, a);
    expect(r).toMatchObject({ status: "ok", quarantined: 1, received: { segments: 1, added: 1 } });
    const [q] = await a.quarantined();
    expect(q).toMatchObject({ kind: "segment", reason: "hash_mismatch", segment: first, deviceId: "b" });
    expect(q.raw).toBe(fromUtf8(altered));
    const again = await sync(t, a);
    expect(again.quarantined).toBe(0);
    expect(await a.quarantined()).toHaveLength(1);
  });

  it("un segmento illeggibile non blocca la sincronizzazione", async () => {
    const { t, a } = await setup();
    t.setRaw("seg.b.0000000099.0123456789abcdef.json", utf8("{rotto"));
    const r = await sync(t, a);
    expect(r.status).toBe("ok");
    expect(a.events).toHaveLength(2);
    expect((await a.quarantined()).map((q) => q.reason)).toEqual(["corrupt"]);
  });

  it("eventi non validi o di tipo sconosciuto vanno in quarantena, mai applicati né persi", async () => {
    const t = new MemoryTransport();
    const a = device("a");
    const good = buy("b", 1);
    const bad = { ...buy("b", 2), quantity: { value: -5, unit: "g" } };
    const future = { ...buy("b", 3), type: "teleport", schemaVersion: 1 };
    const enc = await encodeSegment({ deviceId: "b", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [good, bad, future] });
    t.setRaw(enc.name, enc.bytes);
    const r = await sync(t, a);
    expect(r).toMatchObject({ status: "ok", quarantined: 2, received: { added: 1 } });
    expect(a.events.map((e) => e.id)).toEqual([good.id]);
    const q = await a.quarantined();
    expect(q.map((x) => [x.reason, x.index])).toEqual([
      ["invalid_event", 1],
      ["future_event", 2],
    ]);
    expect(JSON.parse(q[1].raw)).toEqual(future);
    // Ripetere non duplica la quarantena.
    await sync(t, a);
    expect(await a.quarantined()).toHaveLength(2);
    // Dopo un "aggiornamento" che conosce il tipo nuovo, l'evento esce dalla quarantena.
    const upgraded = (e: unknown) =>
      (e as { type?: string }).type === "teleport" ? [] : validateAnyEvent(e);
    const r2 = await sync(t, a, { validate: upgraded, epoch: "dopo-aggiornamento" });
    expect(r2.released).toBe(1);
    expect(a.events.map((e) => e.id).sort()).toEqual([good.id, future.id].sort());
    expect((await a.quarantined()).map((x) => x.reason)).toEqual(["invalid_event"]);
  });

  it("un segmento di versione futura resta in quarantena intatto", async () => {
    const t = new MemoryTransport();
    const a = device("a");
    const enc = await encodeSegment({ deviceId: "b", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [buy("b", 1)] });
    const doc = JSON.parse(fromUtf8(enc.bytes));
    doc.header.version = SEGMENT_VERSION + 1;
    const bytes = utf8(JSON.stringify(doc));
    t.setRaw(enc.name, bytes);
    await sync(t, a);
    expect(a.events).toEqual([]);
    expect(await a.quarantined()).toMatchObject([{ reason: "future_version", raw: fromUtf8(bytes) }]);
  });
});

describe("chiavi", () => {
  it("con la cifratura obbligatoria e senza chiave non si tocca niente", async () => {
    const t = new MemoryTransport();
    const a = device("a");
    a.author([buy("a", 1)]);
    const r = await sync(t, a, { requireEncryption: true });
    expect(r).toMatchObject({ status: "locked", error: "no_key" });
    expect(t.callCount).toBe(0);
  });

  it("segmenti di una chiave sconosciuta restano da leggere finché non arriva la frase", async () => {
    const t = new MemoryTransport();
    const key = await testKey();
    const a = device("a", key);
    a.author([buy("a", 1)]);
    await sync(t, a, { requireEncryption: true });
    expect([...t.snapshot().keys()].some((n) => n === `key.${key.keyId}.json`)).toBe(true);
    for (const [, bytes] of t.snapshot()) expect(fromUtf8(bytes)).not.toContain("farina");

    const other = await testKey();
    const b = device("b", other);
    const r = await sync(t, b, { requireEncryption: true });
    // Chiave locale diversa da quella su Drive: legge ciò che può, non scrive niente.
    expect(r).toMatchObject({ status: "locked", error: "key_mismatch", locked: 1, unknownKeys: [key.keyId], sent: { events: 0 } });
    expect(b.events).toEqual([]);
    b.keys.set(key.keyId, key.key);
    const r2 = await sync(t, b, { requireEncryption: true });
    expect(r2).toMatchObject({ locked: 0, received: { added: 1 } });
    await sync(t, a, { requireEncryption: true });
    expect(a.events).toHaveLength(1);
    expect(a.events.length + (await a.pending()).events.length).toBe(1);
  });
});

describe("orologi", () => {
  it("segnala un dispositivo avanti di due ore senza toccare i dati", async () => {
    const real = new Date("2026-05-01T10:00:00.000Z");
    const t = new MemoryTransport({ now: () => real });
    const ahead = new Date(real.getTime() + 2 * 3600_000);
    const b = device("b");
    const e = { ...buy("b", 1), recordedAt: ahead.toISOString() } as AnyEvent;
    b.author([e]);
    const rb = await sync(t, b, { now: () => ahead });
    expect(rb.clock).toEqual([{ deviceId: "b", kind: "device_clock", skewMs: 2 * 3600_000 }]);
    const a = device("a");
    const ra: SyncReport = await sync(t, a, { now: () => real });
    expect(ra.clock).toEqual([
      { deviceId: "b", kind: "device_clock", skewMs: 2 * 3600_000 },
      { deviceId: "b", kind: "future_records", skewMs: 2 * 3600_000 },
    ]);
    expect(a.events).toEqual([e]);
  });

  it("scarti piccoli non sono segnalati", async () => {
    const real = new Date("2026-05-01T10:00:00.000Z");
    const t = new MemoryTransport({ now: () => real });
    const b = device("b");
    b.author([buy("b", 1)]);
    const r = await sync(t, b, { now: () => new Date(real.getTime() + 60_000) });
    expect(r.clock).toEqual([]);
  });
});

describe("manifesti", () => {
  it("segnala i segmenti elencati nel manifesto ma assenti", async () => {
    const t = new MemoryTransport();
    const b = device("b");
    b.author([buy("b", 1)]);
    await sync(t, b);
    const manifest = parseManifest(JSON.parse(fromUtf8(t.snapshot().get(manifestName("b"))!)))!;
    const fake = { ...manifest, segments: [...manifest.segments, { name: "seg.b.0000000009.0000000000000000.json", seq: 9 }] };
    const t2 = new MemoryTransport();
    for (const [name, bytes] of t.snapshot()) t2.setRaw(name, name.startsWith("man.") ? utf8(JSON.stringify(fake)) : bytes);
    const r = await sync(t2, device("a"));
    expect(r.missing).toEqual([{ deviceId: "b", name: "seg.b.0000000009.0000000000000000.json" }]);
  });
});
