import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { DB_NAME, closeDb } from "@/data/db";
import { getSetting, setSetting } from "@/data";
import { forgetMemories, readMemories, restoreMemories } from "./memoriesStore";

beforeEach(async () => {
  closeDb();
  await Dexie.delete(DB_NAME);
});

const PORTIONS = { latte: { value: 200, unit: "ml", at: "2026-11-01T08:00:00.000Z" }, pane: { value: 50, unit: "g", at: "2026-11-02T08:00:00.000Z" } };

/** Dati dell'utente e chiavi segrete che nessun «Dimentica» deve toccare. */
async function seedUserData() {
  await setSetting("recipes.prefs", { allergens: ["latte"], excludedFoods: ["funghi"], ownedEquipment: [], limitToEquipment: false });
  await setSetting("diet.mergedNoticeSeen", true);
  await setSetting("nutritionProfile", { sex: "female", age: 42 });
  await setSetting("shopping.manual", [{ id: "a", product: "latte" }]);
  await setSetting("shopping.stock", { minimums: [{ id: "a" }] });
  await setSetting("ai.settings", { apiKey: "chiave" });
  await setSetting("video.service", { url: "https://v.example.test", token: "token" });
  await setSetting("recipes.cookSession", { step: 2 });
  await setSetting("receipt.draft", { lines: [1] });
}

const USER_KEYS = ["recipes.prefs", "diet.mergedNoticeSeen", "nutritionProfile", "shopping.manual", "shopping.stock", "ai.settings", "video.service", "recipes.cookSession", "receipt.draft"];

describe("Memorie nell'archivio", () => {
  it("si leggono solo le memorie, con le voci", async () => {
    await seedUserData();
    await setSetting("portions.v1", PORTIONS);
    expect((await readMemories()).map((m) => [m.id, m.count])).toEqual([["portions", 2]]);
  });

  it("dimentico le porzioni, poi Annulla: tornano identiche", async () => {
    await seedUserData();
    await setSetting("portions.v1", PORTIONS);
    const rows = await forgetMemories(["portions"]);
    expect(await getSetting("portions.v1")).toBeUndefined();
    expect(await readMemories()).toEqual([]);
    await restoreMemories(rows);
    expect(await getSetting("portions.v1")).toEqual(PORTIONS);
  });

  it("200 chiavi dei codici a barre: tutte via, e Annulla le rimette tutte", async () => {
    for (let i = 0; i < 200; i++) await setSetting(`barcode.choice.${i}`, { category: "pasta", location: "pantry" });
    await setSetting("barcode.category.en:milk", "dairy");
    await setSetting("portions.v1", PORTIONS);
    const rows = await forgetMemories(["barcodes"]);
    expect(rows).toHaveLength(201);
    expect((await readMemories()).map((m) => m.id)).toEqual(["portions"]);
    await restoreMemories(rows);
    const back = await readMemories();
    expect(back.find((m) => m.id === "barcodes")?.count).toBe(201);
    expect(await getSetting("barcode.choice.199")).toEqual({ category: "pasta", location: "pantry" });
  });

  it("«Dimentica tutto» non tocca dichiarazioni, profilo, liste a mano, chiavi segrete, cucina e bozza", async () => {
    await seedUserData();
    await setSetting("portions.v1", PORTIONS);
    await setSetting("itemDefaults.v1", { latte: {} });
    await setSetting("ai.zones", { "frigo:latte": {} });
    await setSetting("receipt.memory.coop", { entries: {} });
    const before = new Map<string, unknown>();
    for (const key of USER_KEYS) before.set(key, await getSetting(key));
    const rows = await forgetMemories("all");
    expect(rows.map((r) => r.key).sort()).toEqual(["ai.zones", "itemDefaults.v1", "portions.v1", "receipt.memory.coop"]);
    for (const key of USER_KEYS) expect(await getSetting(key), key).toEqual(before.get(key));
    await restoreMemories(rows);
    expect(await getSetting("ai.zones")).toEqual({ "frigo:latte": {} });
  });

  it("Annulla dopo che si è imparato di nuovo: non perde la scelta nuova", async () => {
    await setSetting("portions.v1", PORTIONS);
    const rows = await forgetMemories(["portions"]);
    await setSetting("portions.v1", { uova: { value: 2, unit: "pz", at: "2026-11-16T08:00:00.000Z" } });
    await restoreMemories(rows);
    expect(Object.keys((await getSetting<Record<string, unknown>>("portions.v1")) ?? {}).sort()).toEqual(["latte", "pane", "uova"]);
  });

  it("niente da dimenticare: nessuna riga tolta", async () => {
    await seedUserData();
    expect(await forgetMemories(["portions"])).toEqual([]);
    expect(await forgetMemories("all")).toEqual([]);
  });
});
