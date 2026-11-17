import { describe, expect, it } from "vitest";
import { derivePlan } from "@/core/plan";
import { weekEv } from "@/core/plan/test-helpers";
import type { PrepRecord, PrepState } from "@/core/prep";
import { expandRef } from "../plan/expand";
import { coveredText, planNeedsFor } from "./planNeeds";

const today = "2026-11-16";
const plan = derivePlan([
  weekEv("w1", "2026-11-15T10:00:00.000Z", "2026-11-16", [
    { date: "2026-11-17", meal: "dinner", item: { kind: "prep", prepId: "p1", servings: 3 } },
  ]),
]);

function prep(remaining: number): PrepRecord {
  return {
    prepId: "p1",
    title: "Risotto",
    eventId: "e",
    cookedAt: "2026-11-15T18:00:00.000Z",
    batchLotId: "LB",
    batchEventId: "b",
    portions: 4,
    remaining,
    eaten: 4 - remaining,
    discarded: 0,
    gifted: 0,
    status: remaining > 0 ? "active" : "finished",
    location: "frigo",
    expiry: { date: "2026-11-20", kind: "estimated" },
    ingredients: [{ lotId: "L1", productRef: "Riso", quantity: { value: 200, unit: "g" }, consumeEventId: "c" }],
    cost: { partial: false, unknownLotIds: [] },
    batchEventIds: [],
  };
}

const stateOf = (p: PrepRecord): PrepState => ({ preps: [p], voidedPrepIds: [], anomalies: [], voidedEventIds: [] });

function run(p: PrepRecord) {
  const preps = stateOf(p);
  const expand = (ref: { kind: "recipe" | "prep"; id: string }, s: number) => expandRef({ recipes: [], preps: preps.preps }, ref, s)?.ingredients;
  return planNeedsFor({ today, plan, expand, preps });
}

describe("fabbisogni con le porzioni già pronte", () => {
  it("con porzioni pronte che bastano non chiede ingredienti, e lo dice", () => {
    const r = run(prep(3));
    expect(r.needs).toEqual([]);
    expect(r.covered).toEqual([{ prepId: "p1", title: "Risotto", covered: 3, needed: 3, toCook: 0 }]);
    expect(coveredText(r.covered[0])).toBe("Risotto: 3 porzioni già pronte: bastano, nessun ingrediente in lista.");
  });

  it("con porzioni pronte in parte chiede gli ingredienti solo per quelle che mancano", () => {
    const r = run(prep(1));
    expect(r.needs.map((n) => [n.product, n.quantity.value, n.quantity.unit])).toEqual([["Riso", 100, "g"]]);
    expect(r.covered[0]).toMatchObject({ covered: 1, toCook: 2 });
    expect(coveredText(r.covered[0])).toBe("Risotto: 1 porzione già pronta, ne cucini 2 porzioni: gli ingredienti in lista sono solo per queste.");
  });

  it("senza porzioni pronte chiede gli ingredienti per tutte le porzioni del piano", () => {
    const r = run(prep(0));
    expect(r.needs.map((n) => n.quantity.value)).toEqual([150]);
    expect(r.covered).toEqual([]);
  });
});

describe("porzioni pronte e date", () => {
  const fridge = (remaining: number, over: Partial<PrepRecord> = {}): PrepRecord => ({ ...prep(remaining), expiry: { date: "2026-11-30", kind: "estimated" }, ...over });
  const withPlan = (p: PrepRecord, today: string, entries: Array<[string, number]>, weekStart = "2026-11-16", isLogged?: (d: string, m: "breakfast" | "lunch" | "dinner" | "snack") => boolean) => {
    const pl = derivePlan([
      weekEv("w", "2026-11-14T10:00:00.000Z", weekStart, entries.map(([date, servings]) => ({ date, meal: "dinner" as const, item: { kind: "prep" as const, prepId: "p1", servings } }))),
    ]);
    const preps = stateOf(p);
    const expand = (ref: { kind: "recipe" | "prep"; id: string }, s: number) => expandRef({ recipes: [], preps: preps.preps }, ref, s)?.ingredients;
    return planNeedsFor({ today, plan: pl, expand, preps, ...(isLogged ? { isLogged } : {}) });
  };

  it("gli usi già passati non consumano le porzioni pronte", () => {
    // oggi mercoledì 18: lunedì 1 porzione già mangiata, giovedì 2 porzioni; in frigo ne restano 2
    const r = withPlan(fridge(2), "2026-11-18", [["2026-11-16", 1], ["2026-11-19", 2]]);
    expect(r.needs).toEqual([]);
    expect(r.covered[0]).toMatchObject({ covered: 2, needed: 2, toCook: 0 });
  });

  it("oggi conta solo per i pasti non ancora registrati", () => {
    const entries: Array<[string, number]> = [["2026-11-18", 1], ["2026-11-19", 2]];
    // senza sapere dal diario, oggi conta: 3 porzioni richieste, 2 pronte, ne cucini 1 (50 g di riso)
    expect(withPlan(fridge(2), "2026-11-18", entries).needs.map((n) => n.quantity.value)).toEqual([50]);
    // la cena di oggi è già registrata: restano le 2 di giovedì, bastano
    expect(withPlan(fridge(2), "2026-11-18", entries, "2026-11-16", (d, m) => d === "2026-11-18" && m === "dinner").needs).toEqual([]);
  });

  it("le porzioni avanzate passano alla settimana successiva, senza contarle due volte", () => {
    // oggi sabato 21, 4 porzioni in freezer, lunedì 23 ne servono 2: bastano
    const freezer = fridge(4, { location: "freezer", expiry: { date: "2027-01-01", kind: "estimated" } });
    const r = withPlan(freezer, "2026-11-21", [["2026-11-23", 2]], "2026-11-23");
    expect(r.needs).toEqual([]);
    expect(r.covered[0]).toMatchObject({ covered: 2, toCook: 0 });

    // con 1 porzione domenica 22 (settimana in corso) e 4 lunedì 23: ne restano 3, una da cucinare (50 g)
    const pl = derivePlan([
      weekEv("a", "2026-11-14T10:00:00.000Z", "2026-11-16", [{ date: "2026-11-22", meal: "dinner", item: { kind: "prep", prepId: "p1", servings: 1 } }]),
      weekEv("b", "2026-11-14T10:01:00.000Z", "2026-11-23", [{ date: "2026-11-23", meal: "dinner", item: { kind: "prep", prepId: "p1", servings: 4 } }]),
    ]);
    const preps = stateOf(freezer);
    const expand = (ref: { kind: "recipe" | "prep"; id: string }, s: number) => expandRef({ recipes: [], preps: preps.preps }, ref, s)?.ingredients;
    const both = planNeedsFor({ today: "2026-11-21", plan: pl, expand, preps });
    expect(both.needs.map((n) => [n.date, n.quantity.value])).toEqual([["2026-11-23", 50]]);
    expect(both.covered[0]).toMatchObject({ covered: 4, needed: 5, toCook: 1 });
  });

  it("le porzioni che non sono più buone alla data d'uso non coprono la settimana successiva", () => {
    const short = fridge(4, { expiry: { date: "2026-11-22", kind: "estimated" } });
    const r = withPlan(short, "2026-11-21", [["2026-11-23", 2]], "2026-11-23");
    expect(r.needs.map((n) => n.quantity.value)).toEqual([100]);
  });
});
