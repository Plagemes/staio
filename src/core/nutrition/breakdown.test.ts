import { describe, expect, it } from "vitest";
import type { MealItem, MealKind } from "../diary";
import { consume, declaration, drink, meal, purchase } from "../diary/test-helpers";
import { dayBreakdown, periodBreakdown } from "./breakdown";
import { computeIntake } from "./intake";
import { createResolver } from "./resolve";
import { FAKE_FOODS, FAKE_PRODUCT } from "./test-helpers";
import { NUTRIENT_KEYS, type NutrientKey } from "./types";

const resolver = createResolver({
  foods: FAKE_FOODS,
  productByRef: (ref) => (ref === FAKE_PRODUCT.barcode ? FAKE_PRODUCT : undefined),
});

const HOUR: Record<MealKind, string> = { breakfast: "08:00", lunch: "13:00", dinner: "20:00", snack: "16:30" };
const g = (name: string, grams: number, certainty: MealItem["certainty"] = "measured"): MealItem => ({ name, quantity: { value: grams, unit: "g" }, certainty });
const mealOn = (date: string, kind: MealKind, items: MealItem[]) =>
  meal(`m-${date}-${kind}`, `${date}T${HOUR[kind]}:00.000Z`, { mealId: `${date}-${kind}`, kind, items });
const outOfHome = (kcal: number): MealItem => ({ name: "Fuori casa · normale", quantity: { value: 1, unit: "pz" }, certainty: "estimated", energyKcal: kcal });
const intakeOf = (events: unknown[]) => computeIntake(events, resolver, { timeZone: "UTC" });

const lot = purchase("p1", "2026-03-01T06:00:00.000Z", { lotId: "lot-1", productRef: FAKE_PRODUCT.barcode, quantity: { value: 500, unit: "g" }, location: "dispensa" });

/** Tre giornate di esempio: completa con dispensa e bevande, con una voce non riconosciuta, con un pasto fuori casa. */
function sampleEvents() {
  return [
    lot,
    mealOn("2026-03-10", "breakfast", [g("Latte intero", 200), { name: "uova", quantity: { value: 2, unit: "pz" }, certainty: "estimated" }]),
    consume("c1", "2026-03-10T08:01:00.000Z", { lotId: "lot-1", quantity: { value: 50, unit: "g" }, mealId: "2026-03-10-breakfast" }),
    mealOn("2026-03-10", "lunch", [g("Pasta di semola secca", 80), g("Zucchine", 150, "estimated")]),
    mealOn("2026-03-10", "dinner", [g("Petto di pollo", 150), g("Mela", 120)]),
    drink("dr1", "2026-03-10T10:00:00.000Z", { name: "Espresso", ml: 30, caffeineMg: 63 }),
    drink("dr2", "2026-03-10T17:00:00.000Z", { name: "Succo", ml: 200, energyKcal: 90, sugarsG: 20 }),
    consume("c2", "2026-03-10T16:00:00.000Z", { lotId: "lot-1", quantity: { value: 20, unit: "g" } }),

    mealOn("2026-03-11", "breakfast", [g("Yogurt greco 0%", 170)]),
    mealOn("2026-03-11", "lunch", [g("pizza", 300), g("Mela", 150)]),
    mealOn("2026-03-11", "dinner", [g("Petto di pollo", 200)]),

    mealOn("2026-03-12", "breakfast", [g("Latte intero", 250)]),
    mealOn("2026-03-12", "lunch", [outOfHome(800)]),
    mealOn("2026-03-12", "dinner", [g("Prosciutto cotto", 80), g("Pesca", 200)]),
  ];
}

describe("dayBreakdown", () => {
  const intake = intakeOf(sampleEvents());

  it("la somma delle parti coincide con il totale del giorno, per ogni nutriente e ogni giornata", () => {
    expect(intake.days.length).toBeGreaterThanOrEqual(3);
    for (const day of intake.days) {
      for (const key of NUTRIENT_KEYS) {
        const b = dayBreakdown(day, key);
        expect(b.total).toBe(day.totals[key]?.value);
        if (b.total === undefined) expect(b.parts).toEqual([]);
        else expect(b.sum).toBeCloseTo(b.total, 6);
        // ogni voce sta da una parte sola
        for (const p of b.parts) expect(p.value).toBeTypeOf("number");
        for (const p of b.missing) expect(p.value).toBeUndefined();
      }
    }
  });

  it("le parti vanno dalla più grande, con il momento, la certezza e dove stanno", () => {
    const day = intake.days.find((d) => d.date === "2026-03-10")!;
    const b = dayBreakdown(day, "energyKcal");
    const values = b.parts.map((p) => p.value ?? 0);
    expect(values).toEqual([...values].sort((a, b2) => b2 - a));
    const chicken = b.parts.find((p) => p.label === "Petto di pollo");
    expect(chicken).toMatchObject({ value: 150, certainty: "estimated", mealKind: "dinner", kind: "mealItem", itemIndex: 0, eventId: "m-2026-03-10-dinner" });
    const pantry = b.parts.find((p) => p.eventId === "c1");
    expect(pantry).toMatchObject({ kind: "pantry", mealKind: "breakfast", certainty: "label" });
    const loose = b.parts.find((p) => p.eventId === "c2");
    expect(loose?.mealKind).toBeUndefined();
  });

  it("1. le bevande che dichiarano il nutriente sono righe; quelle che non lo dichiarano non mancano", () => {
    const onlyDrinks = intakeOf([drink("d1", "2026-03-20T10:00:00.000Z", { name: "Succo", ml: 200, energyKcal: 90 }), drink("d2", "2026-03-20T11:00:00.000Z", { name: "Tè", ml: 250 })]).days[0];
    const b = dayBreakdown(onlyDrinks, "energyKcal");
    expect(b.parts).toEqual([expect.objectContaining({ label: "Succo", value: 90, kind: "drink", eventId: "d1", quantity: { value: 200, unit: "ml" } })]);
    expect(b.missing).toEqual([]);
    expect(b.total).toBe(90);
    const caffeine = dayBreakdown(intake.days[0], "caffeineMg");
    expect(caffeine.parts.map((p) => p.label)).toEqual(["Espresso"]);
    expect(caffeine.missing.length).toBeGreaterThan(0);
  });

  it("2. la stima fuori casa è una riga per l'energia e un dato mancante per le proteine", () => {
    const day = intake.days.find((d) => d.date === "2026-03-12")!;
    const energy = dayBreakdown(day, "energyKcal");
    expect(energy.parts).toContainEqual(expect.objectContaining({ value: 800, outOfHome: true, certainty: "estimated", mealKind: "lunch" }));
    const protein = dayBreakdown(day, "proteinG");
    expect(protein.parts.some((p) => p.outOfHome)).toBe(false);
    expect(protein.missing).toContainEqual(expect.objectContaining({ outOfHome: true, mealKind: "lunch" }));
  });

  it("3. una voce non riconosciuta manca per ogni nutriente e il totale è parziale", () => {
    const day = intake.days.find((d) => d.date === "2026-03-11")!;
    for (const key of ["energyKcal", "proteinG", "fiberG"] as NutrientKey[]) {
      const b = dayBreakdown(day, key);
      expect(b.missing.map((p) => p.label)).toContain("pizza");
    }
    expect(day.totals.energyKcal?.partial).toBe(true);
  });

  it("4. un prodotto con i valori d'etichetta ma senza fibre: riga per l'energia, mancante per le fibre", () => {
    const day = intake.days.find((d) => d.date === "2026-03-10")!;
    expect(dayBreakdown(day, "energyKcal").parts.find((p) => p.eventId === "c1")).toMatchObject({ value: 200, certainty: "label" });
    expect(dayBreakdown(day, "fiberG").missing.find((p) => p.eventId === "c1")).toMatchObject({ value: undefined });
    expect(dayBreakdown(day, "fiberG").missing.find((p) => p.eventId === "c1")?.certainty).toBeUndefined();
  });

  it("5. la somma è arrotondata come il totale, senza residui", () => {
    const day = intakeOf([mealOn("2026-03-15", "lunch", [g("Latte intero", 0.1), g("Latte intero", 0.2)])]).days[0];
    const b = dayBreakdown(day, "energyKcal");
    expect(b.sum).toBe(day.totals.energyKcal?.value);
  });

  it("non cambia il giorno che riceve", () => {
    const day = intake.days[0];
    const before = JSON.stringify(day);
    dayBreakdown(day, "energyKcal");
    expect(JSON.stringify(day)).toBe(before);
  });
});

describe("periodBreakdown", () => {
  const intake = intakeOf([
    ...sampleEvents(),
    // il 13 manca la cena; il 14 il pranzo è dichiarato senza dettagli; il 16 c'è solo la colazione
    mealOn("2026-03-13", "breakfast", [g("Mela", 150)]),
    mealOn("2026-03-13", "lunch", [g("Petto di pollo", 100)]),
    mealOn("2026-03-14", "breakfast", [g("Mela", 150)]),
    declaration("dec1", "2026-03-14T14:00:00.000Z", { date: "2026-03-14", kind: "lunch", status: "untracked" }),
    mealOn("2026-03-14", "dinner", [g("Petto di pollo", 100)]),
    mealOn("2026-03-16", "breakfast", [g("Mela", 150)]),
  ]);
  const range = { from: "2026-03-10", to: "2026-03-16" };

  it("una riga per ogni giorno del periodo, dal più recente, anche senza niente", () => {
    const p = periodBreakdown(intake.days, range, "energyKcal");
    expect(p.days.map((d) => d.date)).toEqual(["2026-03-16", "2026-03-15", "2026-03-14", "2026-03-13", "2026-03-12", "2026-03-11", "2026-03-10"]);
    expect(p.days[1]).toEqual({ date: "2026-03-15", counted: false, why: "nothing" });
  });

  it("i motivi dei giorni non contati", () => {
    const p = periodBreakdown(intake.days, range, "energyKcal");
    const at = (date: string) => p.days.find((d) => d.date === date);
    expect(at("2026-03-13")).toEqual({ date: "2026-03-13", counted: false, why: "missing_meals", missingKinds: ["dinner"] });
    expect(at("2026-03-14")).toEqual({ date: "2026-03-14", counted: false, why: "untracked_meals" });
    expect(at("2026-03-12")).toEqual({
      date: "2026-03-12",
      counted: true,
      value: intake.days.find((d) => d.date === "2026-03-12")?.totals.energyKcal?.value,
      outOfHome: true,
      certainty: "estimated",
      partial: false,
    });
    expect(at("2026-03-10")).toMatchObject({ counted: true, outOfHome: false });
  });

  it("la media e i giorni contati sono quelli dei giorni completi con il dato", () => {
    for (const key of NUTRIENT_KEYS) {
      const p = periodBreakdown(intake.days, range, key);
      const withData = intake.days.filter((d) => d.date >= range.from && d.date <= range.to && d.complete && d.totals[key] !== undefined);
      expect(p.counted).toBe(withData.length);
      expect(p.complete).toBe(3);
      if (withData.length === 0) expect(p.average).toBeUndefined();
      else expect(p.average).toBeCloseTo(withData.reduce((s, d) => s + (d.totals[key]?.value ?? 0), 0) / withData.length, 6);
    }
  });

  it("9. oggi conta solo se è completo: a metà giornata il motivo è ciò che manca", () => {
    const p = periodBreakdown(intake.days, { from: "2026-03-14", to: "2026-03-16" }, "energyKcal");
    expect(p.days[0]).toEqual({ date: "2026-03-16", counted: false, why: "missing_meals", missingKinds: ["lunch", "dinner"] });
  });

  it("un periodo senza giorni contati non ha media", () => {
    const p = periodBreakdown(intake.days, { from: "2026-03-15", to: "2026-03-16" }, "energyKcal");
    expect(p).toMatchObject({ counted: 0, complete: 0, average: undefined });
    expect(p.days).toHaveLength(2);
  });
});
