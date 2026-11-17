// Seconda revisione: punto 1 (sbloccare un pacchetto non cambia la chiave di scrittura), la scelta
// della chiave corrente allo sblocco (punto 2) e lo svuotamento della quarantena (punto 3).
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { MemoryTransport, buildPackage, createKey, utf8 } from "@/core/sync";
import { PASSPHRASE, TEST_ITERATIONS, TEST_UNLOCK, buy } from "@/core/sync/test-helpers";
import { wipeAll } from "../index";
import {
  clearQuarantine,
  createDexieSyncPort,
  createPassphrase,
  getKeyStatus,
  importSyncPackage,
  listQuarantine,
  readSyncPackage,
  syncWith,
  unlockPackageKeys,
  unlockPassphrase,
} from "./index";

const opts = { create: { iterations: TEST_ITERATIONS }, unlock: TEST_UNLOCK };
const OTHER = "frase del pacchetto di un altro";

beforeEach(async () => {
  await wipeAll();
});

async function keyAt(iso: string, passphrase = PASSPHRASE) {
  const { keyInfo, key } = await createKey(passphrase, { iterations: TEST_ITERATIONS, now: new Date(iso) });
  return { keyId: keyInfo.keyId, key, keyInfo };
}

describe("1. sbloccare un pacchetto", () => {
  it("aggiunge solo chiavi di lettura per quell'importazione: la chiave di scrittura resta e su Drive non va", async () => {
    const { keyId: mine } = await createPassphrase(PASSPHRASE, PASSPHRASE, [], opts);
    const theirs = await keyAt("2026-05-01T00:00:00.000Z", OTHER);
    const built = await buildPackage({ deviceId: "other", events: [buy("other", 1)], key: theirs });
    const pkg = readSyncPackage(built.bytes);
    if (!pkg.ok) throw new Error("pacchetto non leggibile");
    expect((await importSyncPackage(pkg)).locked).toBe(1);

    await expect(unlockPackageKeys("frase completamente sbagliata", pkg.keyInfos, opts)).rejects.toMatchObject({ code: "wrong_passphrase" });
    const readKeys = await unlockPackageKeys(OTHER, pkg.keyInfos, opts);
    expect((await importSyncPackage(pkg, readKeys)).received.added).toBe(1);

    expect(await getKeyStatus()).toEqual({ ready: true, keyIds: [mine] });
    expect((await createDexieSyncPort().writeKey())?.keyId).toBe(mine);
    const t = new MemoryTransport();
    expect((await syncWith(t, "drive", { requireEncryption: true })).status).toBe("ok");
    expect([...t.snapshot().keys()].filter((n) => n.startsWith("key."))).toEqual([`key.${mine}.json`]);
  });
});

describe("2. lo sblocco sceglie la chiave corrente del remoto", () => {
  it("con più chiavi aperte dalla frase, scrive con la più recente anche se prima ne usava un'altra", async () => {
    const old = await keyAt("2026-01-01T00:00:00.000Z");
    const next = await keyAt("2026-03-01T00:00:00.000Z");
    await unlockPassphrase(PASSPHRASE, [old.keyInfo], opts);
    expect((await createDexieSyncPort().writeKey())?.keyId).toBe(old.keyId);
    const r = await unlockPassphrase(PASSPHRASE, [old.keyInfo, next.keyInfo], opts);
    expect(r.keyId).toBe(next.keyId);
    expect((await createDexieSyncPort().writeKey())?.keyId).toBe(next.keyId);
  });
});

describe("3. svuotare la quarantena", () => {
  it("toglie tutte le voci e dice quante erano", async () => {
    const t = new MemoryTransport();
    t.setRaw("seg.x.0000000001.0123456789abcdef.json", utf8("{rotto"));
    t.setRaw("seg.x.0000000002.0123456789abcde0.json", utf8("{rotto"));
    await syncWith(t, "file");
    expect(await listQuarantine()).toHaveLength(2);
    expect(await clearQuarantine()).toBe(2);
    expect(await listQuarantine()).toEqual([]);
  });
});

describe("terza revisione, 3: una frase vecchia aggiunge solo lettura", () => {
  it("se si scrive già con la chiave corrente di Drive, sbloccarne un'altra non sposta la scrittura", async () => {
    const OLD = "la frase di prima del cambio";
    const old = await keyAt("2026-01-01T00:00:00.000Z", OLD);
    const next = await keyAt("2026-03-01T00:00:00.000Z");
    const remote = [old.keyInfo, next.keyInfo];
    expect((await unlockPassphrase(PASSPHRASE, remote, opts)).keyId).toBe(next.keyId);
    expect((await unlockPassphrase(OLD, remote, opts)).keyId).toBe(next.keyId);
    expect((await createDexieSyncPort().writeKey())?.keyId).toBe(next.keyId);
    expect((await getKeyStatus()).keyIds).toEqual([old.keyId, next.keyId].sort());
  });
});
