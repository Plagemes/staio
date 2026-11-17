import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { validateAnyEvent } from "@/core/events";
import {
  MemoryLocal,
  MemoryTransport,
  decodeSegment,
  encodeSegment,
  fromUtf8,
  parseRemoteName,
  runSync,
  unlockKey,
} from "@/core/sync";
import { PASSPHRASE, TEST_ITERATIONS, TEST_UNLOCK, buy, canon } from "@/core/sync/test-helpers";
import { getDb } from "../db";
import { appendEvents, getAllEvents, setSetting, wipeAll } from "../index";
import {
  createDexieSyncPort,
  exportSyncPackage,
  forgetKeys,
  getKeyStatus,
  importSyncPackage,
  listQuarantine,
  listRemoteKeyInfos,
  readSyncPackage,
  createPassphrase,
  unlockPackageKeys,
  unlockPassphrase,
  syncWith,
} from "./index";

const opts = { create: { iterations: TEST_ITERATIONS }, unlock: TEST_UNLOCK };

beforeEach(async () => {
  await wipeAll();
});

/** Tutti i testi salvati in syncMeta e settings, chiavi CryptoKey escluse. */
async function storedText(): Promise<string> {
  const db = getDb();
  const rows = [...(await db.syncMeta.toArray()), ...(await db.settings.toArray())];
  return JSON.stringify(rows, (_, v) => (v instanceof CryptoKey ? "<key>" : v));
}

async function memoryPeer(id: string): Promise<MemoryLocal> {
  const peer = new MemoryLocal(id);
  const status = await getKeyStatus();
  if (status.ready) {
    const port = createDexieSyncPort();
    const wk = (await port.writeKey())!;
    peer.useKey({ ...wk, key: await unlockKey(PASSPHRASE, wk.keyInfo, TEST_UNLOCK) });
  }
  return peer;
}

describe("sincronizzazione con l'archivio del dispositivo", () => {
  it("riceve, invia e converge con un altro dispositivo; ripetere non cambia nulla", async () => {
    await createPassphrase(PASSPHRASE, PASSPHRASE, [], opts);
    const t = new MemoryTransport();
    const peer = await memoryPeer("peer");
    peer.author([buy("peer", 1)]);
    await runSync({ transport: t, local: peer });
    await appendEvents([buy("me", 2), buy("me", 3)]);

    const r = await syncWith(t, "drive", { requireEncryption: true });
    expect(r).toMatchObject({ status: "ok", kind: "drive", received: { added: 1 }, sent: { events: 2 } });
    await runSync({ transport: t, local: peer });
    expect(canon(await getAllEvents())).toBe(canon(peer.events));

    const files = [...t.snapshot().keys()];
    const again = await syncWith(t, "drive", { requireEncryption: true });
    expect(again).toMatchObject({ status: "ok", sent: { segments: 0 }, received: { segments: 0 } });
    expect([...t.snapshot().keys()]).toEqual(files);
    expect((await createDexieSyncPort().pending()).events).toEqual([]);
  });

  it("senza frase segreta Drive non parte e non tocca niente", async () => {
    const t = new MemoryTransport();
    await appendEvents([buy("me", 1)]);
    const r = await syncWith(t, "drive", { requireEncryption: true });
    expect(r).toMatchObject({ status: "locked", error: "no_key" });
    expect(t.callCount).toBe(0);
  });

  it("chiave AI, impostazioni AI, aspetto e identità del dispositivo non arrivano mai al remoto", async () => {
    const secret = "sk-ant-SEGRETISSIMA-123";
    await setSetting("ai.settings", { provider: "anthropic", apiKey: secret, model: "x" });
    await setSetting("appearance.theme", "ardesia-unica");
    await setSetting("nutritionProfile", { sex: "f", age: 40 });
    await appendEvents([buy("me", 1)]);
    for (const encrypted of [false, true]) {
      if (encrypted) await createPassphrase(PASSPHRASE, PASSPHRASE, [], opts);
      const t = new MemoryTransport();
      const r = await syncWith(t, "drive", { requireEncryption: encrypted });
      expect(r.status).toBe("ok");
      const port = createDexieSyncPort();
      for (const [name, bytes] of t.snapshot()) {
        const raw = fromUtf8(bytes);
        expect(raw).not.toContain(secret);
        expect(raw).not.toContain("ardesia-unica");
        expect(raw).not.toContain("nutritionProfile");
        expect(raw).not.toContain(PASSPHRASE);
        if (parseRemoteName(name).kind !== "segment") continue;
        const dec = await decodeSegment(name, bytes, (id) => port.keyFor(id));
        expect(dec.status).toBe("ok");
        if (dec.status !== "ok") continue;
        for (const e of dec.events) {
          expect(validateAnyEvent(e)).toEqual([]);
          expect(JSON.stringify(e)).not.toContain(secret);
        }
      }
    }
    // Il pacchetto su file rispetta le stesse regole.
    const pkg = await exportSyncPackage({ encrypt: false });
    expect(fromUtf8(pkg.bytes)).not.toContain(secret);
  });

  it("la frase non si salva; la chiave è conservata non estraibile; frase sbagliata non tocca niente", async () => {
    const created = await createPassphrase(PASSPHRASE, PASSPHRASE, [], opts);
    expect(await storedText()).not.toContain(PASSPHRASE);
    const wk = (await createDexieSyncPort().writeKey())!;
    expect(wk.key.extractable).toBe(false);

    const t = new MemoryTransport();
    await appendEvents([buy("me", 1)]);
    await syncWith(t, "drive", { requireEncryption: true });
    const infos = await listRemoteKeyInfos(t);
    expect(infos.map((k) => k.keyId)).toEqual([created.keyId]);

    await forgetKeys();
    expect((await getKeyStatus()).ready).toBe(false);
    const before = await storedText();
    const err = await unlockPassphrase("frase completamente sbagliata", infos, opts).catch((e) => e);
    expect(err.code).toBe("wrong_passphrase");
    expect(await storedText()).toBe(before);

    const ok = await unlockPassphrase(PASSPHRASE, infos, opts);
    expect(ok).toMatchObject({ keyId: created.keyId, unmatched: 0 });
    expect((await getKeyStatus()).ready).toBe(true);
  });

  it("quarantena conservata e visibile, senza doppioni", async () => {
    const t = new MemoryTransport();
    const bad = { ...buy("peer", 1), type: "nuovoTipo" };
    const enc = await encodeSegment({ deviceId: "peer", seq: 1, createdAt: "2026-01-01T00:00:00.000Z", events: [buy("peer", 2), bad] });
    t.setRaw(enc.name, enc.bytes);
    await syncWith(t, "file");
    await syncWith(t, "file");
    const q = await listQuarantine();
    expect(q).toHaveLength(1);
    expect(q[0]).toMatchObject({ kind: "event", reason: "future_event", deviceId: "peer" });
    expect(JSON.parse(q[0].raw)).toEqual(bad);
    expect(await getAllEvents()).toHaveLength(1);
  });

  it("una risposta persa dopo il caricamento non duplica i segmenti", async () => {
    let failNext = true;
    const t = new MemoryTransport({
      fault: (c) => {
        if (c.op === "put" && c.name?.startsWith("seg.") && failNext) {
          failNext = false;
          return { when: "after" };
        }
        return null;
      },
    });
    await appendEvents([buy("me", 1), buy("me", 2)]);
    expect((await syncWith(t, "file")).status).toBe("failed");
    expect((await syncWith(t, "file")).sent.segments).toBe(0);
    expect([...t.snapshot().keys()].filter((n) => n.startsWith("seg."))).toHaveLength(1);
  });

  it("dopo «Cancella tutti i dati» lo stato della sincronizzazione riparte da zero e i dati tornano", async () => {
    const t = new MemoryTransport();
    await appendEvents([buy("me", 1)]);
    await syncWith(t, "file");
    await wipeAll();
    expect(await getAllEvents()).toEqual([]);
    const r = await syncWith(t, "file");
    expect(r.received.added).toBe(1);
    expect(await getAllEvents()).toHaveLength(1);
  });
});

describe("sincronizzazione con file", () => {
  it("esporta e reimporta: unione senza cancellare, e i dati importati vanno poi su Drive", async () => {
    await appendEvents([buy("me", 1)]);
    const pkg = readSyncPackage((await exportSyncPackage({ encrypt: false })).bytes);
    if (!pkg.ok) throw new Error("pacchetto non leggibile");
    await wipeAll();
    await appendEvents([buy("me", 2)]);
    const r = await importSyncPackage(pkg);
    expect(r).toMatchObject({ status: "ok", kind: "file", received: { added: 1 } });
    expect(await getAllEvents()).toHaveLength(2);
    expect((await createDexieSyncPort().pending()).events).toHaveLength(2);
  });

  it("pacchetto cifrato: serve la frase giusta", async () => {
    await createPassphrase(PASSPHRASE, PASSPHRASE, [], opts);
    await appendEvents([buy("me", 1, "pane-segreto")]);
    const built = await exportSyncPackage({ encrypt: true });
    expect(fromUtf8(built.bytes)).not.toContain("pane-segreto");
    const pkg = readSyncPackage(built.bytes);
    if (!pkg.ok) throw new Error("pacchetto non leggibile");
    await wipeAll();
    const locked = await importSyncPackage(pkg);
    expect(locked.locked).toBe(1);
    await expect(unlockPackageKeys("frase completamente sbagliata", pkg.keyInfos, opts)).rejects.toMatchObject({ code: "wrong_passphrase" });
    const r = await importSyncPackage(pkg, await unlockPackageKeys(PASSPHRASE, pkg.keyInfos, opts));
    expect(r.received.added).toBe(1);
  });
});
