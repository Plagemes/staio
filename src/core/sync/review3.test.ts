// Regressioni dalla terza revisione (punti 1, 2a e 4).
import { describe, expect, it } from "vitest";
import { validateAnyEvent } from "../events";
import { utf8 } from "./bytes";
import { createKey } from "./crypto";
import { runSync, type SyncOptions, type WriteKey } from "./engine";
import { keyFileName } from "./format";
import { MemoryLocal } from "./memoryLocal";
import { MemoryTransport } from "./memoryTransport";
import { encodeSegment } from "./segment";
import { PASSPHRASE, TEST_ITERATIONS, buy } from "./test-helpers";

const drive = (transport: MemoryTransport, local: MemoryLocal, extra: Partial<SyncOptions> = {}) =>
  runSync({ transport, local, requireEncryption: true, ...extra });

async function keyAt(iso: string, passphrase = PASSPHRASE): Promise<WriteKey> {
  const { keyInfo, key } = await createKey(passphrase, { iterations: TEST_ITERATIONS, now: new Date(iso) });
  return { keyId: keyInfo.keyId, key, keyInfo };
}

describe("1. quarantena piena di voci riprovabili", () => {
  it("il segmento con eventi rimasti fuori non si segna come visto: dopo l'aggiornamento arrivano tutti", async () => {
    const t = new MemoryTransport();
    const future = [1, 2, 3].map((n) => ({ ...buy("z", n), type: "teleport" }));
    const good = buy("z", 4);
    const seg = await encodeSegment({ deviceId: "z", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [...future, good] });
    t.setRaw(seg.name, seg.bytes);
    const a = new MemoryLocal("a");
    const r = await runSync({ transport: t, local: a, maxQuarantine: 2, epoch: "v1" });
    expect(r.overflow).toBe(1);
    expect(a.events.map((e) => e.id)).toEqual([good.id]);
    expect(a.seen.has(seg.name)).toBe(false);
    const upgraded = (e: unknown) => ((e as { type?: string }).type === "teleport" ? [] : validateAnyEvent(e));
    await runSync({ transport: t, local: a, maxQuarantine: 2, epoch: "v2", validate: upgraded });
    expect(a.events.map((e) => e.id).sort()).toEqual([...future.map((e) => e.id), good.id].sort());
    expect(a.seen.has(seg.name)).toBe(true);
  });

  it("i file ostili o corrotti non bloccano gli altri", async () => {
    const t = new MemoryTransport();
    const a = new MemoryLocal("a");
    const fut = await encodeSegment({ deviceId: "0", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [1, 2].map((n) => ({ ...buy("q", n), type: "teleport" })) });
    t.setRaw(fut.name, fut.bytes);
    await runSync({ transport: t, local: a, maxQuarantine: 2 });
    for (let i = 1; i <= 3; i++) t.setRaw(`seg.1.000000000${i}.0123456789abcde${i}.json`, utf8("{rotto"));
    const good = buy("b", 1);
    const ok = await encodeSegment({ deviceId: "b", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [good] });
    t.setRaw(ok.name, ok.bytes);
    const r = await runSync({ transport: t, local: a, maxQuarantine: 2 });
    expect(r.status).toBe("ok");
    expect(a.events.map((e) => e.id)).toEqual([good.id]);
    for (let i = 1; i <= 3; i++) expect(a.seen.has(`seg.1.000000000${i}.0123456789abcde${i}.json`)).toBe(true);
  });
});

describe("2a. passando alla chiave corrente si ripubblicano i propri eventi", () => {
  it("dopo la gara il vincitore legge i dati scritti dal perdente con la chiave perdente", async () => {
    const t = new MemoryTransport();
    const ka = await keyAt("2026-01-01T00:00:00.000Z");
    const kb = await keyAt("2026-01-01T00:00:01.000Z");
    const a = new MemoryLocal("a");
    a.useKey(ka);
    a.author([buy("a", 1)]);
    await drive(t, a);
    const t2 = new MemoryTransport();
    const b = new MemoryLocal("b");
    b.useKey(kb);
    await drive(t2, b);
    for (const [name, bytes] of t2.snapshot()) t.setRaw(name, bytes);
    a.author([buy("a", 2)]);
    expect((await drive(t, a)).error).toBe("key_mismatch");
    a.useKey(kb); // frase giusta inserita su a
    const r = await drive(t, a);
    expect(r).toMatchObject({ status: "ok", sent: { events: 2 } });
    const rb = await drive(t, b);
    expect(b.events.map((e) => e.id).sort()).toEqual([buy("a", 1).id, buy("a", 2).id].sort());
    expect(rb.received.added).toBe(2);
    // Un altro giro non ricarica niente.
    expect((await drive(t, a)).sent.events).toBe(0);
  });

  it("dopo un cambio di frase un dispositivo nuovo con la sola frase nuova legge anche i dati di prima", async () => {
    const t = new MemoryTransport();
    const old = await keyAt("2026-01-01T00:00:00.000Z");
    const a = new MemoryLocal("a");
    a.useKey(old);
    a.author([buy("a", 1)]);
    await drive(t, a);
    const next = await keyAt("2026-03-01T00:00:00.000Z", "una frase nuova e lunga");
    a.useKey(next);
    await drive(t, a);
    const c = new MemoryLocal("c");
    c.useKey(next);
    await drive(t, c);
    expect(c.events.map((e) => e.id)).toEqual([buy("a", 1).id]);
  });
});

describe("4. file di chiave illeggibile", () => {
  it("caricamento sospeso con esito esplicito", async () => {
    const t = new MemoryTransport();
    const k = await keyAt("2026-01-01T00:00:00.000Z");
    t.setRaw(keyFileName(k.keyId), utf8(JSON.stringify(k.keyInfo)));
    t.setRaw(keyFileName("f".repeat(32)), utf8("x".repeat(200 * 1024)));
    const a = new MemoryLocal("a");
    a.useKey(k);
    a.author([buy("a", 1)]);
    const r = await drive(t, a);
    expect(r).toMatchObject({ status: "locked", error: "key_unreadable", sent: { events: 0 } });
  });
});
