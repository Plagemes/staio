import { describe, expect, it } from "vitest";
import { derivePlan, type PlannedEntry } from "@/core/plan";
import {
  buildClearDayType,
  buildDayType,
  buildStructure,
  buildTargets,
  buildWeek,
  copyDay,
  copyWeek,
  withAmount,
  withEntry,
  withoutEntry,
} from "./edit";

const ctx = { now: "2026-11-16T08:00:00.000Z", deviceId: "dev-a" };
const food = (date: string, meal: PlannedEntry["meal"], name: string, value = 100): PlannedEntry => ({
  date,
  meal,
  item: { kind: "food", name, quantity: { value, unit: "g" } },
});
const foodName = (e: PlannedEntry) => (e.item.kind === "food" ? e.item.name : "");
const foodValue = (e: PlannedEntry) => (e.item.kind === "food" ? e.item.quantity.value : -1);

describe("modifica del piano", () => {
  const base = [food("2026-11-16", "lunch", "Pasta", 80), food("2026-11-17", "dinner", "Riso", 70)];

  it("aggiunge, toglie e cambia quantità senza toccare l'originale", () => {
    const added = withEntry(base, food("2026-11-16", "dinner", "Pollo"));
    expect(added).toHaveLength(3);
    expect(base).toHaveLength(2);
    expect(withoutEntry(added, 0).map(foodName)).toEqual(["Riso", "Pollo"]);
    expect(foodValue(withAmount(base, 0, 120)[0])).toBe(120);
    expect(foodValue(base[0])).toBe(80);
  });

  it("cambia le porzioni di una ricetta", () => {
    const entries: PlannedEntry[] = [{ date: "2026-11-16", meal: "lunch", item: { kind: "recipe", recipeId: "r1", servings: 2 } }];
    const item = withAmount(entries, 0, 4)[0].item;
    expect(item.kind === "recipe" && item.servings).toBe(4);
  });

  it("copia un giorno sostituendo quello di arrivo", () => {
    const target = [...base, food("2026-11-18", "lunch", "Zuppa")];
    const out = copyDay(base, target, "2026-11-16", "2026-11-18");
    const on18 = out.filter((e) => e.date === "2026-11-18");
    expect(on18.map(foodName)).toEqual(["Pasta"]);
    expect(out.filter((e) => e.date === "2026-11-16")).toHaveLength(1);
  });

  it("copia la settimana spostando le date di sette giorni", () => {
    expect(copyWeek(base, "2026-11-16", "2026-11-23").map((e) => e.date)).toEqual(["2026-11-23", "2026-11-24"]);
  });

  it("scrive la settimana come un evento riconosciuto, e l'annullamento fa tornare la precedente", () => {
    const first = buildWeek("2026-11-16", base, ctx, "ok");
    const second = buildWeek("2026-11-16", withEntry(base, food("2026-11-18", "lunch", "Zuppa")), { ...ctx, now: "2026-11-16T09:00:00.000Z" }, "ok");
    if (!first.ok || !second.ok) throw new Error("atteso ok");
    expect(derivePlan([...first.events, ...second.events]).weeks[0].entries).toHaveLength(3);
    const undo = buildClearDayType(second.events[0].id, "2026-11-16", { ...ctx, now: "2026-11-16T10:00:00.000Z" });
    if (!undo.ok) throw new Error("atteso ok");
    expect(derivePlan([...first.events, ...second.events, ...undo.events]).weeks[0].entries).toHaveLength(2);
  });

  it("rifiuta settimane che non iniziano di lunedì e voci fuori settimana", () => {
    expect(buildWeek("2026-11-17", base, ctx, "x").ok).toBe(false);
    expect(buildWeek("2026-11-16", [food("2026-11-30", "lunch", "X")], ctx, "x").ok).toBe(false);
  });

  it("scrive tipo di giornata, obiettivi e struttura", () => {
    const d = buildDayType("2026-11-16", "  allenamento ", ctx);
    expect(d.ok && derivePlan(d.events).dayTypes[0].dayType).toBe("allenamento");
    expect(buildDayType("2026-11-16", " ", ctx).ok).toBe(false);
    expect(buildTargets("riposo", {}, ctx).ok).toBe(false);
    const t = buildTargets("riposo", { proteinG: { min: 90 } }, ctx);
    expect(t.ok && derivePlan(t.events).targets[0].targets).toEqual({ proteinG: { min: 90 } });
    const s = buildStructure({ meals: [{ kind: "lunch", time: "13:00" }], excludedFoods: [" olive ", "olive", ""], allergens: ["glutine"] }, ctx);
    expect(s.ok && derivePlan(s.events).structure?.excludedFoods).toEqual(["olive"]);
    expect(buildStructure({ meals: [{ kind: "lunch", time: "25:00" }], excludedFoods: [], allergens: [] }, ctx).ok).toBe(false);
    expect(buildStructure({ meals: [], excludedFoods: [], allergens: [] }, ctx).ok).toBe(false);
    expect(buildStructure({ meals: [{ kind: "lunch" }], eatingFrom: "08:00", excludedFoods: [], allergens: [] }, ctx).ok).toBe(false);
  });
});
