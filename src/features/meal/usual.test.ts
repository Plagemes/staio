import { describe, expect, it } from "vitest";
import { deriveDiary, mealsWithPantry, type DiaryHabit, type MealKind } from "@/core/diary";
import { purchase } from "@/core/diary/test-helpers";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type Lot } from "@/core/ledger";
import { buildMealEvents, buildMealFromHabit, type FreeItemInput } from "../meals";
import { habitsFor, lastMealOf, mealFoodsText, usualFoods, withMealAt } from "./usual";

const TODAY = "2026-11-16";
const BOUGHT = "2026-10-01T09:00:00.000Z";
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

const stock: AnyEvent[] = [
  purchase("p-pollo", BOUGHT, { lotId: "pollo", productRef: "Petto di pollo", quantity: q(2000), location: "freezer" }),
];

let n = 0;
/** Un pasto alle 20 (ora di Roma) di quel giorno: pollo dalla dispensa e voci libere. */
function addMeal(log: AnyEvent[], day: string, kind: MealKind, chicken: number | null, free: FreeItemInput[]): AnyEvent[] {
  const lot = derivePantry(log).lots.find((l) => l.lotId === "pollo") as Lot;
  const r = buildMealEvents(
    { kind, picks: chicken ? [{ lot, choice: { kind: "value", value: chicken } }] : [], freeItems: free },
    { now: `${day}T19:00:00.000Z`, deviceId: "d", idGenerator: () => `id-${++n}` },
  );
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return [...log, ...r.events];
}

function history(): AnyEvent[] {
  let log = [...stock];
  log = addMeal(log, "2026-10-10", "dinner", 300, [{ name: "Pane", quantityText: "60 g" }]); // oltre 30 giorni: non conta
  log = addMeal(log, "2026-11-10", "dinner", 120, [{ name: "Insalata", quantityText: "80 g" }]);
  log = addMeal(log, "2026-11-12", "dinner", 130, [{ name: "Pane", quantityText: "50 g" }, { name: "Insalata", quantityText: "70 g" }]);
  log = addMeal(log, "2026-11-14", "dinner", 140, [{ name: "Pane", quantityText: "60 g" }]);
  log = addMeal(log, "2026-11-15", "lunch", null, [{ name: "Pasta", quantityText: "80 g" }]);
  return log;
}

function args(log: AnyEvent[]) {
  return {
    meals: mealsWithPantry(deriveDiary(log), log),
    names: new Map(derivePantry(log).lots.map((l) => [l.lotId, l.productRef])),
    today: TODAY,
  };
}

describe("usualFoods: «Di solito a cena»", () => {
  it("i più frequenti del momento negli ultimi 30 giorni; a parità il più recente", () => {
    const foods = usualFoods({ ...args(history()), kind: "dinner", pantryNames: ["Petto di pollo"] });
    // pollo in 3 cene; pane e insalata in 2, ma il pane è più recente
    expect(foods.map((f) => f.name)).toEqual(["Petto di pollo", "Pane", "Insalata"]);
  });

  it("la quantità: la porzione ricordata vince su quella dell'ultima volta", () => {
    const memory = { "petto di pollo": { value: 150, unit: "g", at: "2026-11-14T19:00:00.000Z" } };
    const foods = usualFoods({ ...args(history()), kind: "dinner", pantryNames: [], memory });
    expect(foods.find((f) => f.name === "Petto di pollo")?.quantity).toEqual({ value: 150, unit: "g" });
    expect(foods.find((f) => f.name === "Pane")?.quantity).toEqual({ value: 60, unit: "g" });
    // senza memoria: l'ultima volta
    expect(usualFoods({ ...args(history()), kind: "dinner", pantryNames: [] })[0].quantity).toEqual({ value: 140, unit: "g" });
  });

  it("alimento in casa (stesso nome, senza maiuscole né accenti) contro alimento che non c'è", () => {
    const foods = usualFoods({ ...args(history()), kind: "dinner", pantryNames: ["petto di pollo", "Insalàta"] });
    expect(foods.map((f) => [f.name, f.inPantry])).toEqual([
      ["Petto di pollo", true],
      ["Pane", false],
      ["Insalata", true],
    ]);
  });

  it("un alimento già nel piatto non compare; il momento conta", () => {
    expect(usualFoods({ ...args(history()), kind: "dinner", pantryNames: [], exclude: ["pane"] }).map((f) => f.name)).toEqual([
      "Petto di pollo",
      "Insalata",
    ]);
    expect(usualFoods({ ...args(history()), kind: "lunch", pantryNames: [] }).map((f) => f.name)).toEqual(["Pasta"]);
  });

  it("fino a sei", () => {
    let log = [...stock];
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) log = addMeal(log, "2026-11-13", "snack", null, [{ name, quantityText: "10 g" }]);
    expect(usualFoods({ ...args(log), kind: "snack", pantryNames: [] })).toHaveLength(6);
  });

  it("niente da proporre", () => {
    expect(usualFoods({ ...args(stock), kind: "dinner", pantryNames: [] })).toEqual([]);
    expect(usualFoods({ ...args(history()), kind: "breakfast", pantryNames: [] })).toEqual([]);
  });
});

describe("pasti abituali, «Come ieri»", () => {
  const habit = (habitId: string, kind: MealKind): DiaryHabit => ({
    habitId,
    title: habitId,
    kind,
    items: [{ name: "Pane", quantity: q(50), certainty: "estimated" }],
    eventId: `e-${habitId}`,
    recordedAt: BOUGHT,
    certainty: "estimated",
  });

  it("prima quelli del momento scelto, fino a tre", () => {
    const all = [habit("a", "breakfast"), habit("b", "dinner"), habit("c", "lunch"), habit("d", "dinner")];
    expect(habitsFor(all, "dinner").shown.map((h) => h.habitId)).toEqual(["b", "d", "a"]);
    expect(habitsFor(all, "dinner").more).toBe(true);
    expect(habitsFor(all.slice(0, 3), "lunch")).toMatchObject({ more: false });
  });

  it("il pasto abituale di un giorno passato: cambia solo l'istante del pasto, i consumi restano di adesso", () => {
    const now = "2026-11-16T20:00:00.000Z";
    const lots = derivePantry(stock).lots;
    const built = buildMealFromHabit({ ...habit("h", "dinner"), items: [{ name: "Petto di pollo", quantity: q(150), certainty: "measured" }] }, lots, {
      now,
      deviceId: "d",
    });
    const moved = withMealAt(built.events, "2026-11-15T19:00:00.000Z");
    expect(moved.map((e) => [e.type, e.at])).toEqual([
      ["meal", "2026-11-15T19:00:00.000Z"],
      ["consume", now],
    ]);
    expect(withMealAt(built.events, undefined)).toEqual(built.events);
  });

  it("l'ultimo pasto di ieri in quel momento e i suoi alimenti", () => {
    const log = history();
    const { meals, names } = args(log);
    const last = lastMealOf(meals, "2026-11-14", "dinner");
    expect(last && mealFoodsText(last, names)).toBe("petto di pollo, pane");
    expect(lastMealOf(meals, "2026-11-14", "lunch")).toBeUndefined();
  });
});
