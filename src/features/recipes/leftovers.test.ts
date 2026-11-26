import { describe, expect, it } from "vitest";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type Lot } from "@/core/ledger";
import { derivePreps } from "@/core/prep";
import { NOW, lotsOf } from "../prep/test-helpers";
import { NEEDS_PANTRY_ITEM, leftoverEvents, leftoverMessage, leftoverSummary, shortageText, splitQuantity, type LeftoverInput } from "./leftovers";

const CTX = { now: NOW, deviceId: "dev-a" };

function setup() {
  const { events, lots } = lotsOf([
    { id: "pasta", name: "Pasta", value: 400 },
    { id: "ragu", name: "Ragù", value: 100 },
    { id: "uova", name: "Uova", value: 6, unit: "pz" },
  ]);
  const byId = Object.fromEntries(lots.map((l) => [l.lotId, l])) as Record<string, Lot>;
  const input = (over: Partial<LeftoverInput> = {}): LeftoverInput => ({
    kind: "lunch",
    recipeId: "r-pasta",
    title: "Pasta al forno",
    servings: 4,
    eaten: 1,
    place: "frigo",
    picks: [
      { lot: byId.pasta, quantityText: "400 g" },
      { lot: byId.ragu, quantityText: "100 g" },
    ],
    freeItems: [],
    vote: { rating: "great" },
    ...over,
  });
  return { events, byId, input };
}

function run(input: LeftoverInput) {
  const r = leftoverEvents(input, CTX);
  if (!r.ok) throw new Error(`atteso ok: ${JSON.stringify(r.errors)}`);
  return r;
}

/** Quanto consumano gli eventi, per lotto, separando quelli del pasto da quelli della preparazione. */
function consumed(events: readonly AnyEvent[]) {
  const meal = new Map<string, number>();
  const prep = new Map<string, number>();
  for (const e of events) {
    if (e.type !== "consume") continue;
    const target = e.mealId ? meal : prep;
    target.set(e.lotId, (target.get(e.lotId) ?? 0) + e.quantity.value);
  }
  return { meal, prep };
}

describe("splitQuantity", () => {
  it("divide 100 g tra 3 porzioni: 33 g al pasto e 67 g alle altre", () => {
    expect(splitQuantity(100, "g", 1, 3)).toEqual({ meal: 33, rest: 67 });
  });
  it("arrotonda i pezzi al mezzo pezzo", () => {
    expect(splitQuantity(2, "pz", 1, 4)).toEqual({ meal: 0.5, rest: 1.5 });
    expect(splitQuantity(1, "pz", 1, 4)).toEqual({ meal: 0.5, rest: 0.5 });
  });
  it("la somma è sempre il totale e nessuna parte lo supera", () => {
    for (const total of [1, 7, 33.5, 100, 250, 1000]) {
      for (const n of [2, 3, 5, 7, 12]) {
        for (let k = 1; k < n; k++) {
          const { meal, rest } = splitQuantity(total, "g", k, n);
          expect(meal + rest).toBeCloseTo(total, 6);
          expect(meal).toBeLessThanOrEqual(total);
          expect(rest).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });
});

describe("leftoverEvents", () => {
  it("4 porzioni, 1 mangiata: un pasto, una preparazione con 3 porzioni, il voto, e ogni lotto consumato una volta", () => {
    const { input } = setup();
    const r = run(input());
    const types = r.events.map((e) => e.type);
    expect(types.filter((t) => t === "meal")).toHaveLength(1);
    expect(types.filter((t) => t === "prep")).toHaveLength(1);
    expect(types.filter((t) => t === "dishRating")).toHaveLength(1);
    const declare = r.events.find((e) => e.type === "declare");
    expect(declare && "quantity" in declare ? declare.quantity : null).toEqual({ value: 3, unit: "pz" });
    const { meal, prep } = consumed(r.events);
    expect(meal.get("pasta")).toBe(100);
    expect(prep.get("pasta")).toBe(300);
    expect(meal.get("ragu")).toBe(25);
    expect(prep.get("ragu")).toBe(75);
    for (const lot of ["pasta", "ragu"]) expect((meal.get(lot) ?? 0) + (prep.get(lot) ?? 0)).toBe(lot === "pasta" ? 400 : 100);
    expect(r.message).toMatch(/^Registrato: pranzo con Pasta al forno\. 3 porzioni in frigo, fino al \d+ \w+\.$/);
  });

  it("un solo mealId, collegato al pasto e al voto", () => {
    const { input } = setup();
    const r = run(input());
    const mealIds = new Set(r.events.flatMap((e) => ("mealId" in e && typeof e.mealId === "string" ? [e.mealId] : [])));
    expect([...mealIds]).toEqual([r.mealId]);
    const rating = r.events.find((e) => e.type === "dishRating");
    expect(rating && "recipeId" in rating ? rating.recipeId : null).toBe("r-pasta");
    // i consumi della preparazione non hanno mealId
    expect(r.events.filter((e) => e.type === "consume" && !e.mealId).length).toBe(2);
  });

  it("3 porzioni e 100 g: 33 g al pasto e 67 g alle porzioni (somma 100)", () => {
    const { input, byId } = setup();
    const r = run(input({ servings: 3, picks: [{ lot: byId.ragu, quantityText: "100 g" }] }));
    const { meal, prep } = consumed(r.events);
    expect(meal.get("ragu")).toBe(33);
    expect(prep.get("ragu")).toBe(67);
  });

  it("unità a pezzi: 2 pz su 4 porzioni, mezzo pezzo al pasto", () => {
    const { input, byId } = setup();
    const r = run(input({ picks: [{ lot: byId.uova, quantityText: "2" }] }));
    const { meal, prep } = consumed(r.events);
    expect(meal.get("uova")).toBe(0.5);
    expect(prep.get("uova")).toBe(1.5);
  });

  it("non supera il rimasto del lotto, nemmeno sommando pasto e porzioni", () => {
    const { input, byId, events } = setup();
    const r = run(input({ picks: [{ lot: byId.pasta, quantityText: "400 g" }] }));
    const state = derivePantry([...events, ...r.events]);
    const lot = state.lots.find((l) => l.lotId === "pasta");
    expect(lot?.remaining).toBe(0);
    const { meal, prep } = consumed(r.events);
    expect((meal.get("pasta") ?? 0) + (prep.get("pasta") ?? 0)).toBeLessThanOrEqual(400);
  });

  it("la preparazione risulta fra le preparazioni, con la ricetta e le porzioni che restano", () => {
    const { input, events } = setup();
    const r = run(input({ eaten: 2, place: "freezer" }));
    const preps = derivePreps([...events, ...r.events]).preps;
    expect(preps).toHaveLength(1);
    expect(preps[0]).toMatchObject({ title: "Pasta al forno", recipeId: "r-pasta", portions: 2 });
    expect(preps[0]?.location).toBe("freezer");
  });

  it("le voci a mano vanno al pasto scalate a K/N", () => {
    const { input } = setup();
    const r = run(input({ freeItems: [{ name: "Basilico", quantityText: "20 g" }] }));
    const meal = r.events.find((e) => e.type === "meal");
    const items = meal && "items" in meal ? meal.items : undefined;
    expect(items?.[0]).toMatchObject({ name: "Basilico", quantity: { value: 5, unit: "g" } });
  });

  it("senza ingredienti dalla dispensa non si possono mettere da parte le porzioni", () => {
    const { input } = setup();
    const r = leftoverEvents(input({ picks: [], freeItems: [{ name: "Basilico", quantityText: "20 g" }] }), CTX);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.general).toBe(NEEDS_PANTRY_ITEM);
  });

  it("un lotto che non ha più il rimasto dà l'errore sulla riga e non scrive niente", () => {
    const { input, byId } = setup();
    const r = leftoverEvents(input({ picks: [{ lot: { ...byId.pasta, remaining: 200 }, quantityText: "400 g" }] }), CTX);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.errors.picks.pasta).toBe("Ne restano solo 200 g: correggi la quantità.");
  });

  it("rifiuta porzioni mangiate fuori da 1…N-1", () => {
    const { input } = setup();
    expect(leftoverEvents(input({ eaten: 0 }), CTX).ok).toBe(false);
    expect(leftoverEvents(input({ eaten: 4 }), CTX).ok).toBe(false);
    expect(leftoverEvents(input({ servings: 4.5 }), CTX).ok).toBe(false);
  });
});

describe("testi", () => {
  it("shortageText riscrive solo l'errore sul rimasto", () => {
    expect(shortageText("Ne restano solo 200 g.")).toBe("Ne restano solo 200 g: correggi la quantità.");
    expect(shortageText("Non capisco la quantità.")).toBe("Non capisco la quantità.");
  });
  it("messaggio e riassunto", () => {
    expect(leftoverMessage("lunch", "Pasta al forno", 1, "freezer", "2026-11-20")).toBe("Registrato: pranzo con Pasta al forno. 1 porzione in freezer, fino al 20 nov.");
    expect(leftoverSummary(false, 3, "frigo")).toBe("No");
    expect(leftoverSummary(true, 3, "frigo")).toBe("Sì, 3 porzioni in frigo");
  });
});
