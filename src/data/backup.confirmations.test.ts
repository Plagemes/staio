import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { confirmIngredient, revokeConfirmation, type AllergenConfirmationEvent } from "@/core/allergens";
import { DB_NAME, closeDb } from "./db";
import { exportBackup, getAllEvents, appendEvents, importBackup, wipeAll } from "./index";

beforeEach(async () => {
  closeDb();
  await Dexie.delete(DB_NAME);
});

const confirm = (name: string, id: string): AllergenConfirmationEvent => {
  const r = confirmIngredient({ name }, { allergens: ["glutine"], excludedFoods: [] }, { deviceId: "altro", now: () => "2026-11-01T08:00:00.000Z", idGenerator: () => id });
  if (!r.ok) throw new Error(r.reason);
  return r.event;
};

describe("ripristino di una copia con conferme di allergeni", () => {
  it("l'esito conta le conferme contenute; nessuna è scartata in silenzio", async () => {
    const c1 = confirm("Prosciutto cotto", "c1");
    const c2 = confirm("Tonno in scatola", "c2");
    const rv = revokeConfirmation(JSON.parse(JSON.stringify(c1)).key, "Prosciutto cotto", { deviceId: "altro", now: () => "2026-11-02T08:00:00.000Z", idGenerator: () => "r1" }, ["c1"]);
    await appendEvents([c1, c2, ...(rv ? [rv] : [])]);
    const backup = JSON.stringify(await exportBackup());
    await wipeAll();
    const res = await importBackup(backup);
    expect(res).toMatchObject({ ok: true, added: 3, allergenConfirmations: 2 });
    expect((await getAllEvents()).filter((e) => e.type === "allergenConfirmation")).toHaveLength(3);
  });

  it("senza conferme nella copia il campo non compare", async () => {
    await wipeAll();
    const res = await importBackup({ format: "ledger-backup", version: 1, events: [] });
    expect(res).toMatchObject({ ok: true });
    expect(res).not.toHaveProperty("allergenConfirmations");
  });

  it("una conferma non valida nella copia è contata tra gli scartati e non tra le conferme", async () => {
    const bad = { ...confirm("Prosciutto cotto", "c9"), allergens: [] } as unknown as AllergenConfirmationEvent;
    const res = await importBackup({ format: "ledger-backup", version: 1, events: [bad] });
    expect(res).toMatchObject({ ok: true, added: 0 });
    expect((res as { rejected: unknown[] }).rejected).toHaveLength(1);
    expect(res).not.toHaveProperty("allergenConfirmations");
  });
});
