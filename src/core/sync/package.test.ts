import { describe, expect, it } from "vitest";
import { EVENT_FAMILIES } from "../events";
import { fromUtf8, utf8 } from "./bytes";
import { CLOCK_TOLERANCE_MS, clockSkewMs, collectClockWarnings, futureRecordsMs } from "./clock";
import { unlockKey } from "./crypto";
import { buildPackage, importPackage, readPackage } from "./filePackage";
import { MemoryLocal } from "./memoryLocal";
import { SYNC_SCOPE, isNeverSyncedSetting, isSyncableEvent } from "./scope";
import { PASSPHRASE, TEST_UNLOCK, buy, canon, testKey } from "./test-helpers";

describe("pacchetto su file", () => {
  it("due telefoni si scambiano i dati con un file in ciascun verso", async () => {
    const a = new MemoryLocal("a");
    const b = new MemoryLocal("b");
    a.author([buy("a", 1), buy("a", 2)]);
    b.author([buy("b", 3)]);
    const fromA = await buildPackage({ deviceId: "a", events: a.events });
    const readA = readPackage(fromA.bytes);
    expect(readA.ok).toBe(true);
    if (!readA.ok) return;
    const rb = await importPackage(readA, b);
    expect(rb).toMatchObject({ status: "ok", received: { added: 2 }, sent: { segments: 0 } });
    const fromB = await buildPackage({ deviceId: "b", events: b.events });
    const readB = readPackage(fromB.bytes);
    if (!readB.ok) throw new Error("pacchetto non leggibile");
    await importPackage(readB, a);
    expect(canon(a.events)).toBe(canon(b.events));
    // Reimportare non cambia niente.
    const again = await importPackage(readPackage(fromB.bytes) as Extract<ReturnType<typeof readPackage>, { ok: true }>, a);
    expect(again.received.added).toBe(0);
  });

  it("importare un file non tocca lo stato della sincronizzazione remota", async () => {
    const a = new MemoryLocal("a");
    const b = new MemoryLocal("b");
    b.author([buy("b", 1)]);
    const pkg = readPackage((await buildPackage({ deviceId: "b", events: b.events })).bytes);
    if (!pkg.ok) throw new Error("pacchetto non leggibile");
    await importPackage(pkg, a);
    expect(a.seen.size).toBe(0);
    expect(a.remote.size).toBe(0);
    expect((await a.pending()).events).toHaveLength(1);
  });

  it("cifrato: serve la frase, poi si legge; il file non contiene dati in chiaro", async () => {
    const key = await testKey();
    const a = new MemoryLocal("a");
    a.useKey(key);
    a.author([buy("a", 1, "pane-segreto")]);
    const built = await buildPackage({ deviceId: "a", events: a.events, key });
    expect(built.encrypted).toBe(true);
    expect(fromUtf8(built.bytes)).not.toContain("pane-segreto");
    const pkg = readPackage(built.bytes);
    if (!pkg.ok) throw new Error("pacchetto non leggibile");
    expect(pkg.keyInfos.map((k) => k.keyId)).toEqual([key.keyId]);
    const b = new MemoryLocal("b");
    const locked = await importPackage(pkg, b);
    expect(locked.locked).toBe(1);
    expect(b.events).toEqual([]);
    b.keys.set(key.keyId, await unlockKey(PASSPHRASE, pkg.keyInfos[0], TEST_UNLOCK));
    const r = await importPackage(pkg, b);
    expect(r.received.added).toBe(1);
  });

  it("riconosce file che non sono pacchetti", () => {
    expect(readPackage(utf8("non json"))).toEqual({ ok: false, error: "invalid_json" });
    expect(readPackage(JSON.stringify({ format: "ledger-backup", version: 1 }))).toEqual({ ok: false, error: "wrong_format" });
    expect(
      readPackage(JSON.stringify({ format: "ledger-sync-package", version: 99, deviceId: "a", createdAt: "2026-01-01T00:00:00.000Z", files: [] })),
    ).toEqual({ ok: false, error: "unsupported_version" });
  });

  it("pacchetto vuoto: valido e senza effetti", async () => {
    const pkg = readPackage((await buildPackage({ deviceId: "a", events: [] })).bytes);
    if (!pkg.ok) throw new Error("pacchetto non leggibile");
    const b = new MemoryLocal("b");
    expect(await importPackage(pkg, b)).toMatchObject({ status: "ok", received: { added: 0 }, quarantined: 0 });
  });
});

describe("orologi", () => {
  it("misura lo scarto e ignora istanti non validi", () => {
    expect(clockSkewMs("2026-01-01T01:00:00.000Z", "2026-01-01T00:00:00.000Z")).toBe(3600_000);
    expect(clockSkewMs("ieri", "2026-01-01T00:00:00.000Z")).toBeUndefined();
    expect(clockSkewMs("2026-01-01T00:00:00.000Z", undefined)).toBeUndefined();
  });

  it("eventi registrati nel futuro", () => {
    const ref = Date.parse("2026-01-01T00:00:00.000Z");
    expect(futureRecordsMs([{ recordedAt: "2026-01-01T03:00:00.000Z" }, { recordedAt: "x" }, null], ref)).toBe(3 * 3600_000);
    expect(futureRecordsMs([{ recordedAt: "2025-12-31T00:00:00.000Z" }], ref)).toBe(0);
  });

  it("tiene lo scarto più grande per dispositivo, sopra la soglia", () => {
    const w = collectClockWarnings([
      { deviceId: "b", kind: "device_clock", skewMs: CLOCK_TOLERANCE_MS },
      { deviceId: "b", kind: "device_clock", skewMs: -2 * CLOCK_TOLERANCE_MS },
      { deviceId: "a", kind: "device_clock", skewMs: 3 * CLOCK_TOLERANCE_MS },
      { deviceId: "a", kind: "device_clock", skewMs: Number.NaN },
    ]);
    expect(w).toEqual([
      { deviceId: "a", kind: "device_clock", skewMs: 3 * CLOCK_TOLERANCE_MS },
      { deviceId: "b", kind: "device_clock", skewMs: -2 * CLOCK_TOLERANCE_MS },
    ]);
  });
});

describe("cosa si sincronizza", () => {
  it("chiave e impostazioni dell'AI, aspetto, token e stato della sincronizzazione non si sincronizzano mai", () => {
    for (const key of ["ai.settings", "ai.key", "appearance.theme", "appearance.mode", "sync.token", "deviceId"]) {
      expect(isNeverSyncedSetting(key)).toBe(true);
    }
    expect(isNeverSyncedSetting("nutritionProfile")).toBe(false);
    const never = SYNC_SCOPE.filter((s) => !s.synced).map((s) => s.id);
    expect(never).toEqual(expect.arrayContaining(["ai", "token", "appearance", "passphrase"]));
    expect(SYNC_SCOPE.filter((s) => s.synced).map((s) => s.id)).toEqual(["events"]);
  });

  it("si sincronizzano solo eventi validi, di qualunque famiglia nota", () => {
    expect(EVENT_FAMILIES.length).toBeGreaterThan(0);
    expect(isSyncableEvent(buy("a", 1))).toBe(true);
    expect(isSyncableEvent({ key: "ai.settings", value: { apiKey: "sk-123" } })).toBe(false);
    expect(isSyncableEvent({ id: "x", type: "aiKey", apiKey: "sk-123" })).toBe(false);
  });
});
