import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { derivePantry, type LedgerEvent } from "@/core/ledger";
import { consume, purchase, q } from "@/core/ledger/test-helpers";
import { DB_NAME, SCHEMA_V1, closeDb } from "./db";
import {
  appendEvents,
  exportBackup,
  getAllEvents,
  getDeviceId,
  getEventsAfter,
  getPantry,
  importBackup,
  importEvents,
  wipeAll,
} from "./index";

const buy = (id: string, at: string, lotId = "lot-" + id, value = 500) =>
  purchase(id, at, {
    lotId,
    productRef: "farina",
    quantity: q(value),
    location: "dispensa",
  });

beforeEach(async () => {
  await wipeAll();
});

describe("appendEvents", () => {
  it("è idempotente sugli id", async () => {
    const e = buy("a", "2026-01-01T10:00:00.000Z");
    expect((await appendEvents([e])).added).toBe(1);
    const again = await appendEvents([e, e]);
    expect(again.added).toBe(0);
    expect(again.duplicates).toBe(2);
    expect(await getAllEvents()).toHaveLength(1);
  });

  it("non sovrascrive un id già presente con contenuto diverso", async () => {
    await appendEvents([buy("a", "2026-01-01T10:00:00.000Z", "l", 500)]);
    await appendEvents([buy("a", "2026-01-01T10:00:00.000Z", "l", 900)]);
    const [stored] = await getAllEvents();
    expect((stored as { quantity: { value: number } }).quantity.value).toBe(500);
  });

  it("rifiuta gli eventi non validi restituendo gli errori", async () => {
    const bad = { ...buy("b", "2026-01-01T10:00:00.000Z"), quantity: q(-1) };
    const good = buy("c", "2026-01-01T11:00:00.000Z");
    const res = await appendEvents([bad as LedgerEvent, good]);
    expect(res.added).toBe(1);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0].index).toBe(0);
    expect(res.rejected[0].errors.length).toBeGreaterThan(0);
    expect((await getAllEvents()).map((e) => e.id)).toEqual(["c"]);
  });
});

describe("getEventsAfter", () => {
  it("segue l'arrivo locale, anche con recordedAt vecchio", async () => {
    await appendEvents([buy("a", "2026-03-01T10:00:00.000Z")]);
    const first = await getEventsAfter(0);
    expect(first.events.map((e) => e.id)).toEqual(["a"]);
    await importEvents([buy("old", "2020-01-01T10:00:00.000Z")]);
    const next = await getEventsAfter(first.seq);
    expect(next.events.map((e) => e.id)).toEqual(["old"]);
    expect(next.seq).toBeGreaterThan(first.seq);
    expect((await getEventsAfter(next.seq)).events).toEqual([]);
    expect((await getEventsAfter(next.seq)).seq).toBe(next.seq);
  });

  it("la sostituzione di versione riceve una nuova sequenza", async () => {
    const old = buy("a", "2026-01-01T10:00:00.000Z", "l", 500);
    await appendEvents([old]);
    const { seq } = await getEventsAfter(0);
    const newer = { ...old, recordedAt: "2026-01-05T10:00:00.000Z", quantity: q(900) };
    await importEvents([newer as LedgerEvent]);
    const after = await getEventsAfter(seq);
    expect(after.events).toEqual([newer]);
  });

  it("il numero di arrivo non compare in letture ed esportazione", async () => {
    await appendEvents([buy("a", "2026-01-01T10:00:00.000Z")]);
    expect(Object.keys((await getAllEvents())[0])).not.toContain("seq");
    expect(Object.keys((await getEventsAfter(0)).events[0])).not.toContain("seq");
    expect(JSON.stringify(await exportBackup())).not.toContain("\"seq\"");
  });
});

describe("importEvents", () => {
  it("unisce e conta i nuovi", async () => {
    const a = buy("a", "2026-01-01T10:00:00.000Z");
    const b = buy("b", "2026-01-02T10:00:00.000Z");
    await appendEvents([a]);
    const res = await importEvents([a, b]);
    expect(res.added).toBe(1);
    expect(res.conflicts).toEqual([]);
    expect(await getAllEvents()).toHaveLength(2);
  });

  it("riporta i conflitti e converge sulla versione scelta dal libro mastro", async () => {
    const old = buy("a", "2026-01-01T10:00:00.000Z", "l", 500);
    const newer = { ...old, recordedAt: "2026-01-05T10:00:00.000Z", quantity: q(900) };
    await appendEvents([old]);
    const res = await importEvents([newer as LedgerEvent]);
    expect(res.added).toBe(0);
    expect(res.conflicts).toHaveLength(1);
    expect(res.conflicts[0].id).toBe("a");
    const all = await getAllEvents();
    expect(all).toHaveLength(1);
    expect((all[0] as { quantity: { value: number } }).quantity.value).toBe(900);
  });

  it("scarta gli eventi non validi", async () => {
    const res = await importEvents([{ nope: true } as unknown as LedgerEvent]);
    expect(res.added).toBe(0);
    expect(res.rejected).toHaveLength(1);
  });
});

describe("backup", () => {
  it("esporta e reimporta ricostruendo lo stesso stato derivato", async () => {
    await appendEvents([
      buy("a", "2026-01-01T10:00:00.000Z", "l1"),
      consume("b", "2026-01-02T10:00:00.000Z", { lotId: "l1", quantity: q(200) }),
    ]);
    const before = await getPantry();
    const backup = await exportBackup();
    const text = JSON.stringify(backup);
    expect(backup.format).toBe("ledger-backup");
    expect(backup.version).toBe(1);

    await wipeAll();
    expect(await getAllEvents()).toEqual([]);
    const res = await importBackup(text);
    expect(res).toMatchObject({ ok: true, added: 2 });
    expect(await getPantry()).toEqual(before);
    expect(derivePantry(backup.events)).toEqual(before);
  });

  it("rifiuta formati sconosciuti", async () => {
    expect(await importBackup("{")).toEqual({ ok: false, error: "invalid_json" });
    expect(await importBackup({ format: "x" })).toEqual({ ok: false, error: "wrong_format" });
    expect(
      await importBackup({ format: "ledger-backup", version: 99, events: [] }),
    ).toEqual({ ok: false, error: "unsupported_version" });
  });
});

describe("wipeAll", () => {
  it("cancella eventi e identità del dispositivo", async () => {
    await appendEvents([buy("a", "2026-01-01T10:00:00.000Z")]);
    const id = await getDeviceId();
    await wipeAll();
    expect(await getAllEvents()).toEqual([]);
    expect(await getDeviceId()).not.toBe(id);
  });
});

describe("getDeviceId", () => {
  it("è stabile tra chiamate, anche concorrenti", async () => {
    const ids = await Promise.all([getDeviceId(), getDeviceId(), getDeviceId()]);
    expect(new Set(ids).size).toBe(1);
    expect(await getDeviceId()).toBe(ids[0]);
  });
});

describe("migrazioni", () => {
  it("un database creato con lo schema v1 si riapre senza perdere eventi", async () => {
    closeDb();
    await Dexie.delete(DB_NAME);
    const legacy = new Dexie(DB_NAME);
    legacy.version(1).stores(SCHEMA_V1);
    const e = buy("old", "2025-06-01T10:00:00.000Z");
    await legacy.table("events").add(e);

    const e2 = buy("old2", "2025-05-01T10:00:00.000Z");
    await legacy.table("events").add(e2);
    legacy.close();

    expect(await getAllEvents()).toEqual([e2, e]);
    const after = await getEventsAfter(0);
    expect(after.events.map((x) => x.id)).toEqual(["old2", "old"]);
    expect(after.seq).toBe(2);
  });
});
