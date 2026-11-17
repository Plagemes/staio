// Regressioni dalla seconda revisione (punti 2 e 3; il punto 1 è in src/data/sync).
import { describe, expect, it } from "vitest";
import { createKey } from "./crypto";
import { currentKeyId, runSync, type SyncOptions, type WriteKey } from "./engine";
import { keyFileName } from "./format";
import { MemoryLocal } from "./memoryLocal";
import { MemoryTransport } from "./memoryTransport";
import { encodeSegment } from "./segment";
import { utf8 } from "./bytes";
import { PASSPHRASE, TEST_ITERATIONS, buy } from "./test-helpers";

const drive = (transport: MemoryTransport, local: MemoryLocal, extra: Partial<SyncOptions> = {}) =>
  runSync({ transport, local, requireEncryption: true, ...extra });

async function keyAt(iso: string, passphrase = PASSPHRASE): Promise<WriteKey> {
  const { keyInfo, key } = await createKey(passphrase, { iterations: TEST_ITERATIONS, now: new Date(iso) });
  return { keyId: keyInfo.keyId, key, keyInfo };
}

function putKeyFile(t: MemoryTransport, k: WriteKey) {
  t.setRaw(keyFileName(k.keyId), utf8(JSON.stringify(k.keyInfo)));
}

const files = (t: MemoryTransport, prefix: string) => [...t.snapshot().keys()].filter((n) => n.startsWith(prefix)).sort();

describe("2. chiave locale diversa da quella su Drive", () => {
  it("non carica né segmenti né chiavi e restituisce key_mismatch", async () => {
    const t = new MemoryTransport();
    const remote = await keyAt("2026-01-01T00:00:00.000Z");
    putKeyFile(t, remote);
    const a = new MemoryLocal("a");
    const local = await keyAt("2026-02-01T00:00:00.000Z");
    a.useKey(local);
    a.author([buy("a", 1)]);
    const r = await drive(t, a);
    expect(r).toMatchObject({ status: "locked", error: "key_mismatch", sent: { events: 0 } });
    expect(files(t, "key.")).toEqual([keyFileName(remote.keyId)]);
    expect(files(t, "seg.")).toEqual([]);
    expect(files(t, "man.")).toEqual([]);
  });

  it("dopo lo sblocco con la chiave remota si carica di nuovo", async () => {
    const t = new MemoryTransport();
    const remote = await keyAt("2026-01-01T00:00:00.000Z");
    putKeyFile(t, remote);
    const a = new MemoryLocal("a");
    a.useKey(await keyAt("2026-02-01T00:00:00.000Z"));
    a.author([buy("a", 1)]);
    await drive(t, a);
    a.useKey(remote);
    const r = await drive(t, a);
    expect(r).toMatchObject({ status: "ok", sent: { events: 1 } });
    expect(files(t, "key.")).toEqual([keyFileName(remote.keyId)]);
  });

  it("cambiare frase pubblica la chiave nuova, che diventa quella corrente per tutti", async () => {
    const t = new MemoryTransport();
    const old = await keyAt("2026-01-01T00:00:00.000Z");
    const a = new MemoryLocal("a");
    a.useKey(old);
    a.author([buy("a", 1)]);
    await drive(t, a);
    const b = new MemoryLocal("b");
    b.useKey(old);
    await drive(t, b);

    const next = await keyAt("2026-03-01T00:00:00.000Z", "una frase nuova e lunga");
    a.useKey(next); // a conserva anche la vecchia: è un cambio voluto
    a.author([buy("a", 2)]);
    // Con la chiave nuova si ripubblica anche ciò che era stato caricato con la vecchia.
    expect(await drive(t, a)).toMatchObject({ status: "ok", sent: { events: 2 } });
    expect(files(t, "key.")).toEqual([keyFileName(old.keyId), keyFileName(next.keyId)].sort());

    // b ha ancora la vecchia: non scrive finché non inserisce la frase nuova.
    b.author([buy("b", 3)]);
    expect(await drive(t, b)).toMatchObject({ status: "locked", error: "key_mismatch", sent: { events: 0 } });
    b.useKey(next);
    const r = await drive(t, b);
    expect(r).toMatchObject({ status: "ok", sent: { events: 1 } });
    expect(b.events.map((e) => e.id)).toContain(buy("a", 2).id);
  });

  it("gara tra due dispositivi nuovi: chi ha la chiave perdente se ne accorge al giro dopo e non scrive", async () => {
    const t = new MemoryTransport();
    const ka = await keyAt("2026-01-01T00:00:00.000Z");
    const kb = await keyAt("2026-01-01T00:00:01.000Z");
    const a = new MemoryLocal("a");
    a.useKey(ka);
    a.author([buy("a", 1)]);
    await drive(t, a);
    // b ha fatto il suo primo giro nello stesso momento, senza vedere la chiave di a.
    const t2 = new MemoryTransport();
    const b = new MemoryLocal("b");
    b.useKey(kb);
    b.author([buy("b", 2)]);
    await drive(t2, b);
    for (const [name, bytes] of t2.snapshot()) t.setRaw(name, bytes);
    expect(files(t, "key.")).toHaveLength(2);

    expect(currentKeyId([ka.keyInfo, kb.keyInfo])).toBe(kb.keyId);
    a.author([buy("a", 3)]);
    const ra = await drive(t, a);
    expect(ra).toMatchObject({ status: "locked", error: "key_mismatch", sent: { events: 0 } });
    const rb = await drive(t, b);
    expect(rb.status).toBe("ok");
    expect(rb.error).toBeUndefined();
  });

  it("chiave corrente: la più recente, a parità la più alta; ignora istanti non validi", async () => {
    const x = await keyAt("2026-01-01T00:00:00.000Z");
    const y = await keyAt("2026-01-01T00:00:00.000Z");
    expect(currentKeyId([])).toBeUndefined();
    expect(currentKeyId([x.keyInfo, y.keyInfo])).toBe([x.keyId, y.keyId].sort()[1]);
  });
});

async function plain(deviceId: string, seq: number, events: unknown[]) {
  return encodeSegment({ deviceId, seq, createdAt: "2026-01-01T00:00:00.000Z", events });
}

describe("3. quarantena piena", () => {
  it("gli eventi validi di un segmento si applicano comunque e il segmento si segna come visto", async () => {
    const t = new MemoryTransport();
    // Il dispositivo "0" viene prima di "b": la quarantena è già piena quando arriva il segmento misto.
    for (let i = 1; i <= 3; i++) t.setRaw(`seg.0.000000000${i}.0123456789abcde${i}.json`, utf8("{rotto"));
    const good = buy("b", 1);
    const mixed = await plain("b", 1, [good, { ...buy("b", 2), quantity: "molta" }]);
    t.setRaw(mixed.name, mixed.bytes);
    const a = new MemoryLocal("a");
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 5, 1) + tick++ * 1000);
    const r = await runSync({ transport: t, local: a, maxQuarantine: 2, now });
    expect(a.events.map((e) => e.id)).toEqual([good.id]);
    expect(a.seen.has(mixed.name)).toBe(true);
    expect(a.quarantine.size).toBe(2);
    expect(r.overflow).toBeGreaterThan(0);
  });

  it("piena di voci che possono ancora diventare valide: l'evento non valido si conta, quelli validi passano", async () => {
    const t = new MemoryTransport();
    const a = new MemoryLocal("a");
    const unknown = (n: number) => ({ ...buy("z", n), type: "teleport" });
    const first = await plain("z", 1, [unknown(1), unknown(2)]);
    t.setRaw(first.name, first.bytes);
    await runSync({ transport: t, local: a, maxQuarantine: 2 });
    expect(a.quarantine.size).toBe(2);
    const good = buy("b", 5);
    const mixed = await plain("b", 1, [good, { ...buy("b", 6), quantity: "molta" }]);
    t.setRaw(mixed.name, mixed.bytes);
    const r = await runSync({ transport: t, local: a, maxQuarantine: 2 });
    expect(r.overflow).toBe(1);
    expect(a.events.map((e) => e.id)).toEqual([good.id]);
    // L'evento rimasto fuori si riprova al giro dopo (terza revisione, punto 1).
    expect(a.seen.has(mixed.name)).toBe(false);
    expect([...a.quarantine.values()].every((q) => q.reason === "future_event")).toBe(true);
  });

  it("si scartano per prime le voci più vecchie che non possono più diventare valide", async () => {
    const t = new MemoryTransport();
    const a = new MemoryLocal("a");
    let tick = 0;
    const now = () => new Date(Date.UTC(2026, 5, 1) + tick++ * 60_000);
    const names = [1, 2, 3].map((i) => `seg.x.000000000${i}.0123456789abcde${i}.json`);
    t.setRaw(names[0], utf8("{rotto"));
    await runSync({ transport: t, local: a, maxQuarantine: 2, now });
    t.setRaw(names[1], utf8("{rotto"));
    await runSync({ transport: t, local: a, maxQuarantine: 2, now });
    t.setRaw(names[2], utf8("{rotto"));
    const r = await runSync({ transport: t, local: a, maxQuarantine: 2, now });
    expect([...a.quarantine.keys()].sort()).toEqual([`seg:${names[1]}`, `seg:${names[2]}`]);
    expect(r.overflow).toBe(1);
  });
});
