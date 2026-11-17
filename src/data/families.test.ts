import "fake-indexeddb/auto";
import Dexie from "dexie";
import { beforeEach, describe, expect, it } from "vitest";
import { derivePantry } from "@/core/ledger";
import { deriveDiary } from "@/core/diary";
import { derivePlan } from "@/core/plan";
import { deriveRecipes } from "@/core/recipes";
import { derivePreps, composePrep } from "@/core/prep";
import type { AnyEvent } from "@/core/events";
import { purchase, q } from "@/core/ledger/test-helpers";
import { water } from "@/core/diary/test-helpers";
import { food, structureEv, weekEv } from "@/core/plan/test-helpers";
import { recipeEvent } from "@/core/recipes/test-helpers";
import { DB_NAME, SCHEMA_V1, SCHEMA_V2, SCHEMA_V3, SCHEMA_V4, closeDb } from "./db";
import {
  SECRET_PREFIX,
  appendEvents,
  exportBackup,
  exportSettings,
  getAllEvents,
  getDiary,
  getEventsAfter,
  getPantry,
  getPlan,
  getPreps,
  getRecipes,
  getSetting,
  importBackup,
  importEvents,
  importSettings,
  removeSetting,
  setSetting,
  wipeAll,
} from "./index";

const T0 = "2026-03-01T08:00:00.000Z";

function allFamilies(): AnyEvent[] {
  const rice = purchase("p1", T0, {
    lotId: "rice",
    productRef: "Riso",
    quantity: q(500, "g"),
    location: "dispensa",
    priceCents: 250,
  });
  const lot = derivePantry([rice]).lots[0];
  const composed = composePrep(
    {
      prepId: "prep1",
      title: "Riso lesso",
      portions: 2,
      location: "frigo",
      ingredients: [{ lot, quantity: q(200, "g") }],
    },
    { deviceId: "dev-a", now: () => "2026-03-10T17:00:00.000Z" },
  );
  if (!composed.ok) throw new Error(JSON.stringify(composed.errors));
  return [
    rice,
    water("w1", "2026-03-10T09:00:00.000Z", { ml: 250 }),
    structureEv("s1", T0, {}),
    weekEv("wk1", T0, "2026-03-09", [food("2026-03-09", "lunch", "Riso", 80)]),
    recipeEvent("rc1", T0),
    ...(composed.events as AnyEvent[]),
  ];
}

beforeEach(async () => {
  await wipeAll();
});

describe("tutte le famiglie di eventi", () => {
  it("si scrivono, si derivano e sopravvivono al backup", async () => {
    const events = allFamilies();
    const res = await appendEvents(events);
    expect(res.rejected).toEqual([]);
    expect(res.added).toBe(events.length);

    const expected = {
      pantry: derivePantry(events),
      diary: deriveDiary(events),
      plan: derivePlan(events),
      recipes: deriveRecipes(events),
      preps: derivePreps(events),
    };
    expect(await getPantry()).toEqual(expected.pantry);
    expect(await getDiary()).toEqual(expected.diary);
    expect(await getPlan()).toEqual(expected.plan);
    expect(await getRecipes()).toEqual(expected.recipes);
    expect(await getPreps()).toEqual(expected.preps);
    expect((await getPreps()).preps).toHaveLength(1);
    expect((await getRecipes()).recipes).toHaveLength(1);
    expect((await getPlan()).weeks).toHaveLength(1);

    const text = JSON.stringify(await exportBackup());
    await wipeAll();
    expect(await importBackup(text)).toMatchObject({ ok: true, added: events.length });
    expect(await getPreps()).toEqual(expected.preps);
    expect(await getPlan()).toEqual(expected.plan);
  });

  it("importa con unione e conflitto su un evento del ricettario", async () => {
    const a = recipeEvent("rc1", T0);
    const b = { ...a, recordedAt: "2026-04-01T08:00:00.000Z", title: "Altro titolo" };
    await appendEvents([a]);
    const res = await importEvents([b as AnyEvent]);
    expect(res.conflicts).toHaveLength(1);
    expect(await getAllEvents()).toEqual([b]);
    expect((await getEventsAfter(0)).events).toEqual([b]);
  });

  it("la migrazione dalla v4 alla v5 conserva eventi e sequenze", async () => {
    closeDb();
    await Dexie.delete(DB_NAME);
    const old = new Dexie(DB_NAME);
    old.version(1).stores(SCHEMA_V1);
    old.version(2).stores(SCHEMA_V2);
    old.version(3).stores(SCHEMA_V3);
    old.version(4).stores(SCHEMA_V4);
    const r = recipeEvent("rc9", T0);
    await old.table("events").add({ ...r, seq: 3 });
    old.close();
    const after = await getEventsAfter(0);
    expect(after.events).toEqual([r]);
    expect(after.seq).toBe(3);
  });
});

describe("impostazioni", () => {
  it("legge, scrive e rimuove", async () => {
    expect(await getSetting("theme")).toBeUndefined();
    await setSetting("theme", { mode: "dark" });
    expect(await getSetting("theme")).toEqual({ mode: "dark" });
    await removeSetting("theme");
    expect(await getSetting("theme")).toBeUndefined();
  });

  it("non espone né modifica l'identità del dispositivo", async () => {
    await expect(setSetting("deviceId", "x")).rejects.toThrow();
    expect(await getSetting("deviceId")).toBeUndefined();
  });

  it("l'esportazione esclude ai.* e sta fuori dalla copia degli eventi", async () => {
    await setSetting("theme", "dark");
    await setSetting(`${SECRET_PREFIX}apiKey`, "segreto");
    await setSetting("ai.provider", "x");
    const exported = await exportSettings();
    expect(exported.settings).toEqual({ theme: "dark" });
    expect(JSON.stringify(exported)).not.toContain("segreto");
    expect(JSON.stringify(await exportBackup())).not.toContain("theme");
  });

  it("l'importazione ignora le chiavi segrete", async () => {
    const res = await importSettings({
      format: "ledger-settings",
      version: 1,
      settings: { theme: "light", "ai.apiKey": "k", deviceId: "evil" },
    });
    expect(res).toEqual({ ok: true, imported: 1, skipped: 2 });
    expect(await getSetting("theme")).toBe("light");
    expect(await getSetting("ai.apiKey")).toBeUndefined();
    expect(await importSettings("{")).toEqual({ ok: false, error: "invalid_json" });
  });

  it("wipeAll cancella le impostazioni", async () => {
    await setSetting("theme", "dark");
    await wipeAll();
    expect(await getSetting("theme")).toBeUndefined();
  });
});
