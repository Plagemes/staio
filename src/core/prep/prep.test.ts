import { describe, expect, it } from "vitest";
import { derivePantry, type IdGenerator, type Lot } from "../ledger";
import { consume, discard, purchase, q, voidOf } from "../ledger/test-helpers";
import { seededRandom, shuffled } from "../plan/test-helpers";
import {
  composePrep,
  derivePreps,
  getPrep,
  isPrepEvent,
  portionLifeDays,
  portionsExpiry,
  prepCost,
  prepLotRefs,
  prepNutrients,
  validatePrepEvent,
  voidPrep,
  type ComposePrepInput,
  type ComposedPrep,
  type IngredientNutrients,
  type PrepEvent,
} from "./index";

const T0 = "2026-03-01T08:00:00.000Z";
const COOK = "2026-03-10T17:00:00.000Z";

function ids(prefix = "id"): IdGenerator {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(3, "0")}`;
}

const options = (overrides: object = {}) => ({
  deviceId: "dev-a",
  now: () => COOK,
  idGenerator: ids(),
  ...overrides,
});

/** Riso 500 g a 2,50 €, latte 1000 ml a 1,99 €, spezie senza prezzo (dichiarate). */
function pantryEvents() {
  return [
    purchase("p1", T0, { lotId: "rice", productRef: "Riso", quantity: q(500, "g"), location: "dispensa", priceCents: 250 }),
    purchase("p2", T0, { lotId: "milk", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo", priceCents: 199 }),
    purchase("p3", T0, { lotId: "spice", productRef: "Spezie", quantity: q(100, "g"), location: "dispensa" }),
  ];
}

const lotsOf = (events: unknown[]): Record<string, Lot> =>
  Object.fromEntries(derivePantry(events).lots.map((l) => [l.lotId, l]));

function compose(
  events: unknown[],
  input: Partial<ComposePrepInput> & Pick<ComposePrepInput, "ingredients">,
  opts: object = {},
): ComposedPrep {
  const r = composePrep({ title: "Riso al latte", portions: 4, location: "frigo", ...input }, options(opts));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  void events;
  return r;
}

describe("prepCost", () => {
  const lot = (lotId: string, initial: number, priceCents?: number, priceCertainty?: "measured" | "label" | "estimated") =>
    ({ lotId, initial, initialCertainty: "measured" as const, ...(priceCents !== undefined ? { priceCents } : {}), ...(priceCertainty ? { priceCertainty } : {}) });

  it("prezzo del lotto in proporzione alla quantità usata, arrotondato al centesimo", () => {
    const c = prepCost(
      [
        { lot: lot("a", 500, 250), quantity: q(200, "g") },
        { lot: lot("b", 1000, 199), quantity: q(250, "ml") },
      ],
      4,
    );
    expect(c.ingredients).toEqual([
      { lotId: "a", costCents: 100 },
      { lotId: "b", costCents: 50 },
    ]);
    expect(c).toMatchObject({ totalCents: 150, perPortionCents: 38, partial: false, unknownLotIds: [], missingShare: 0 });
  });

  it("ingrediente a costo sconosciuto: costo parziale dichiarato, mai zero", () => {
    const c = prepCost(
      [
        { lot: lot("a", 500, 250, "label"), quantity: q(500, "g") },
        { lot: lot("s", 100), quantity: q(10, "g") },
        { lot: lot("s", 100), quantity: q(5, "g") },
      ],
      2,
    );
    expect(c.ingredients[1]).toEqual({ lotId: "s" });
    expect(c).toMatchObject({
      totalCents: 250,
      perPortionCents: 125,
      partial: true,
      unknownLotIds: ["s"],
      certainty: "estimated",
    });
    expect(c.missingShare).toBeCloseTo(2 / 3, 6);
  });

  it("nessun costo noto: nessun totale né costo per porzione", () => {
    const c = prepCost([{ lot: lot("s", 100), quantity: q(10, "g") }], 2);
    expect(c.totalCents).toBeUndefined();
    expect(c.perPortionCents).toBeUndefined();
    expect(c).toMatchObject({ partial: true, missingShare: 1 });
  });

  it("un prezzo zero è un costo noto; la certezza è la peggiore dei prezzi", () => {
    const c = prepCost(
      [
        { lot: lot("a", 10, 0, "measured"), quantity: q(5, "g") },
        { lot: lot("b", 10, 100, "label"), quantity: q(10, "g") },
      ],
      1,
    );
    expect(c).toMatchObject({ totalCents: 100, partial: false, certainty: "label" });
  });

  it("porzioni non valide: niente costo per porzione; dati corrotti: costo sconosciuto", () => {
    expect(prepCost([{ lot: lot("a", 10, 100), quantity: q(10, "g") }], 0).perPortionCents).toBeUndefined();
    expect(prepCost([{ lot: lot("a", 0, 100), quantity: q(1, "g") }], 1).partial).toBe(true);
    expect(prepCost([{ lot: lot("a", 10, -5), quantity: q(1, "g") }], 1).partial).toBe(true);
    expect(prepCost([], 2)).toMatchObject({ partial: false, missingShare: 0 });
    // Oltre la quantità iniziale il prezzo non cresce.
    expect(prepCost([{ lot: lot("a", 10, 100), quantity: q(20, "g") }], 1).totalCents).toBe(100);
  });
});

describe("prepNutrients", () => {
  const ing = (lotId: string, value: number) => ({ lotId, productRef: lotId, quantity: q(value, "g") });
  const table: Record<string, IngredientNutrients> = {
    rice: { ok: true, nutrients: { energyKcal: 700, proteinG: 14, waterG: 60 }, certainty: "estimated" },
    milk: { ok: true, nutrients: { energyKcal: 300, proteinG: 16, waterG: 840 }, certainty: "label", weight: 1000 },
    spice: { ok: true, nutrients: { energyKcal: 10 }, certainty: "estimated" },
    ghost: { ok: false },
  };
  const of = (i: { lotId: string }) => table[i.lotId];

  it("somma e divide per porzione", () => {
    const r = prepNutrients([ing("rice", 200), ing("milk", 500)], 4, of);
    expect(r.total.energyKcal?.value).toBe(1000);
    expect(r.perPortion.energyKcal).toMatchObject({ value: 250, partial: false, missingShare: 0 });
    expect(r.perPortion.proteinG?.value).toBe(7.5);
    expect(r.certainty).toBe("estimated");
    expect(r.notComputable).toEqual([]);
    expect(r.portionWeightG).toBeUndefined();
    expect(r.waterAdjusted).toBe(false);
  });

  it("dato mancante in un ingrediente: nutriente parziale con la quota dichiarata", () => {
    const r = prepNutrients([ing("rice", 200), ing("spice", 5), ing("ghost", 100)], 2, of);
    expect(r.perPortion.energyKcal).toMatchObject({ value: 355, partial: true, missingCount: 1 });
    expect(r.perPortion.energyKcal?.missingShare).toBeGreaterThan(0);
    expect(r.perPortion.proteinG).toMatchObject({ partial: true });
    expect(r.notComputable).toEqual(["ghost"]);
  });

  it("un nutriente di cui nessuno ha il dato non compare", () => {
    const r = prepNutrients([ing("spice", 5)], 1, of);
    expect(Object.keys(r.perPortion)).toEqual(["energyKcal"]);
    expect(prepNutrients([], 1, of).perPortion).toEqual({});
  });

  it("con la resa: peso della porzione, valori per 100 g e acqua corretta", () => {
    // 200 g di riso + 1000 ml di latte (peso 1000 g) = 1200 g crudi; resa 1,5 = 1800 g cotti.
    const r = prepNutrients([ing("rice", 200), ing("milk", 1000)], 4, of, { cookedPerRaw: 1.5 });
    expect(r.portionWeightG).toBe(450);
    expect(r.waterAdjusted).toBe(true);
    expect(r.total.waterG?.value).toBe(900 + 600);
    expect(r.per100g?.energyKcal).toBeCloseTo((1000 / 1800) * 100, 4);
    // I nutrienti diversi dall'acqua per porzione non cambiano con la resa.
    expect(r.perPortion.energyKcal?.value).toBe(
      prepNutrients([ing("rice", 200), ing("milk", 1000)], 4, of).perPortion.energyKcal?.value,
    );
  });

  it("senza tutti i pesi o con acqua parziale la resa non inventa nulla", () => {
    const noWeight = prepNutrients(
      [{ lotId: "rice", productRef: "r", quantity: { value: 2, unit: "pz" } }],
      1,
      of,
      { cookedPerRaw: 2 },
    );
    expect(noWeight.portionWeightG).toBeUndefined();
    expect(noWeight.per100g).toBeUndefined();
    const partialWater = prepNutrients([ing("rice", 100), ing("spice", 100)], 2, of, { cookedPerRaw: 2 });
    expect(partialWater.waterAdjusted).toBe(false);
    expect(partialWater.per100g?.waterG).toBeUndefined();
    expect(prepNutrients([ing("rice", 100)], 2, of, { cookedPerRaw: -1 }).portionWeightG).toBeUndefined();
    expect(prepNutrients([ing("rice", 100)], 0, of).perPortion).toEqual({});
  });
});

describe("scadenza delle porzioni", () => {
  it("avanzi cucinati in frigo, in dispensa e in freezer", () => {
    expect(portionsExpiry({ location: "frigo", cookedOn: "2026-03-10" })).toEqual({
      date: "2026-03-13",
      kind: "estimated",
    });
    expect(portionsExpiry({ location: "dispensa", cookedOn: "2026-03-10" }).date).toBe("2026-03-10");
    expect(portionsExpiry({ location: "freezer", cookedOn: "2026-03-10" }).date).toBe("2026-06-10");
  });

  it("piatti pronti: durata propria della categoria", () => {
    expect(portionsExpiry({ category: "ready_meals", location: "frigo", cookedOn: "2026-03-10" }).date).toBe(
      "2026-03-13",
    );
    expect(portionLifeDays({ category: "ready_meals", location: "frigo", cookedOn: "2026-03-10" })).toBe(3);
  });

  it("a cavallo di mese, di anno e di febbraio bisestile", () => {
    expect(portionsExpiry({ location: "frigo", cookedOn: "2025-12-30" }).date).toBe("2026-01-02");
    expect(portionsExpiry({ location: "frigo", cookedOn: "2024-02-27" }).date).toBe("2024-03-01");
    expect(portionLifeDays({ location: "freezer", cookedOn: "2025-11-30" })).toBe(90); // 3 mesi: 28 febbraio
  });

  it("la durata scelta dall'utente prevale; valori non validi lanciano", () => {
    expect(portionsExpiry({ location: "frigo", cookedOn: "2026-03-10", shelfDays: 5 }).date).toBe("2026-03-15");
    expect(portionLifeDays({ location: "frigo", cookedOn: "2026-03-10", shelfDays: 0 })).toBe(0);
    expect(() => portionsExpiry({ location: "frigo", cookedOn: "2026-03-10", shelfDays: -1 })).toThrow(RangeError);
    expect(() => portionsExpiry({ location: "frigo", cookedOn: "2026-02-30" })).toThrow();
  });
});

describe("composePrep", () => {
  it("compone consumi, lotto di porzioni, costo e legame", () => {
    const events = pantryEvents();
    const lots = lotsOf(events);
    const r = compose(events, {
      title: "  Riso al latte ",
      recipeId: "riso-latte",
      ingredients: [
        { lot: lots.rice, quantity: q(200, "g") },
        { lot: lots.milk, quantity: q(250, "ml") },
        { lot: lots.spice, quantity: q(5, "g") },
      ],
    });
    expect(r.events.map((e) => e.type)).toEqual(["consume", "consume", "consume", "declare", "updateLot", "prep"]);
    expect(r.cost).toMatchObject({ totalCents: 150, perPortionCents: 38, partial: true, unknownLotIds: ["spice"] });
    expect(r.expiry).toEqual({ date: "2026-03-13", kind: "estimated" });

    const prep = r.events[5] as PrepEvent;
    expect(prep).toMatchObject({
      prepId: r.prepId,
      title: "Riso al latte",
      recipeId: "riso-latte",
      portions: 4,
      batchLotId: r.batchLotId,
      costCents: 150,
      costPartial: true,
      location: "frigo",
    });
    expect(prep.ingredients.map((i) => [i.lotId, i.costCents, i.consumeEventId])).toEqual([
      ["rice", 100, r.events[0].id],
      ["milk", 50, r.events[1].id],
      ["spice", undefined, r.events[2].id],
    ]);
    expect(prep.batchEventId).toBe(r.events[3].id);
    expect(prep.priceEventId).toBe(r.events[4].id);
    expect(validatePrepEvent(prep)).toEqual([]);
    // I consumi non sono pasti: nessun mealId.
    expect(r.events.slice(0, 3).every((e) => !("mealId" in e))).toBe(true);
    expect(r.events.every((e) => e.at === COOK && e.deviceId === "dev-a")).toBe(true);
  });

  it("applicata al registro: ingredienti scalati e lotto di porzioni con scadenza e costo", () => {
    const events = pantryEvents();
    const lots = lotsOf(events);
    const r = compose(events, {
      ingredients: [
        { lot: lots.rice, quantity: q(200, "g") },
        { lot: lots.milk, quantity: q(250, "ml") },
      ],
    });
    const pantry = derivePantry([...events, ...r.events]);
    expect(pantry.anomalies).toEqual([]);
    const byId = Object.fromEntries(pantry.lots.map((l) => [l.lotId, l]));
    expect(byId.rice.remaining).toBe(300);
    expect(byId.milk.remaining).toBe(750);
    expect(byId[r.batchLotId]).toMatchObject({
      productRef: "Riso al latte",
      category: "leftovers_cooked",
      unit: "pz",
      initial: 4,
      remaining: 4,
      location: "frigo",
      origin: "declare",
      priceCents: 150,
      expiry: { date: "2026-03-13", kind: "estimated" },
    });
  });

  it("senza prezzi noti non scrive il costo; sceglie categoria, luogo e durata", () => {
    const events = pantryEvents();
    const lots = lotsOf(events);
    const r = compose(events, {
      ingredients: [{ lot: lots.spice, quantity: q(5, "g") }],
      category: "ready_meals",
      location: "freezer",
      shelfDays: 60,
      portions: 1,
    });
    expect(r.events.map((e) => e.type)).toEqual(["consume", "declare", "prep"]);
    expect(r.cost.totalCents).toBeUndefined();
    expect((r.events[2] as PrepEvent).costCents).toBeUndefined();
    expect(r.expiry.date).toBe("2026-05-09");
    const declare = r.events[1] as { category: string; location: string };
    expect(declare).toMatchObject({ category: "ready_meals", location: "freezer" });
  });

  it("il giorno di cottura segue il fuso orario", () => {
    const events = pantryEvents();
    const lots = lotsOf(events);
    // 23:30 UTC del 10 marzo sono le 00:30 dell'11 a Roma.
    const r = compose(events, { ingredients: [{ lot: lots.rice, quantity: q(10, "g") }] }, { at: "2026-03-10T23:30:00.000Z" });
    expect(r.expiry.date).toBe("2026-03-14");
    const utc = compose(events, { ingredients: [{ lot: lots.rice, quantity: q(10, "g") }] }, {
      at: "2026-03-10T23:30:00.000Z",
      timeZone: "UTC",
    });
    expect(utc.expiry.date).toBe("2026-03-13");
  });

  it("restituisce gli errori senza lanciare", () => {
    const events = pantryEvents();
    const lots = lotsOf(events);
    const base = { title: "x", portions: 2, location: "frigo" as const };
    const err = (input: Partial<ComposePrepInput>, opts: object = {}) => {
      const r = composePrep({ ...base, ingredients: [{ lot: lots.rice, quantity: q(10, "g") }], ...input }, options(opts));
      return r.ok ? [] : r.errors.map((e) => e.code);
    };
    expect(err({ ingredients: [] })).toEqual(["no_ingredients"]);
    expect(err({ portions: 0 })).toEqual(["invalid_portions"]);
    expect(err({ portions: 1.5 })).toEqual(["invalid_portions"]);
    expect(err({ title: "  " })).toEqual(["invalid_title"]);
    expect(err({ prepId: " " })).toEqual(["invalid_prep_id"]);
    expect(err({ shelfDays: -2 })).toEqual(["invalid_shelf_days"]);
    expect(err({ cookedPerRaw: 0 })).toEqual(["invalid_yield"]);
    expect(err({}, { at: "ieri" })).toEqual(["invalid_instant"]);
    expect(err({ ingredients: [{ lot: lots.rice, quantity: q(0, "g") }] })).toEqual(["invalid_quantity"]);
    expect(err({ ingredients: [{ lot: lots.rice, quantity: q(1, "ml") }] })).toEqual(["unit_mismatch"]);
    expect(err({ ingredients: [{ lot: lots.rice, quantity: q(501, "g") }] })).toEqual(["insufficient_quantity"]);
    // Lo stesso lotto due volte: conta la somma.
    expect(
      err({
        ingredients: [
          { lot: lots.rice, quantity: q(300, "g") },
          { lot: lots.rice, quantity: q(300, "g") },
        ],
      }),
    ).toEqual(["insufficient_quantity"]);
    const finished = { ...lots.rice, status: "finished" as const, remaining: 0 };
    expect(err({ ingredients: [{ lot: finished, quantity: q(1, "g") }] })).toEqual(["lot_finished"]);
  });

  it("calcola i nutrienti per porzione se la funzione è passata", () => {
    const events = pantryEvents();
    const lots = lotsOf(events);
    const r = compose(events, {
      ingredients: [{ lot: lots.rice, quantity: q(200, "g") }],
      portions: 2,
      cookedPerRaw: 2,
      nutrientsOf: () => ({ ok: true, nutrients: { energyKcal: 700 }, certainty: "estimated" }),
    });
    expect(r.nutrients?.perPortion.energyKcal?.value).toBe(350);
    expect(r.nutrients?.portionWeightG).toBe(200);
    expect((r.events[r.events.length - 1] as PrepEvent).cookedPerRaw).toBe(2);
  });
});

describe("validatePrepEvent", () => {
  const events = pantryEvents();
  const lots = lotsOf(events);
  const good = compose(events, { ingredients: [{ lot: lots.rice, quantity: q(10, "g") }] }).events.at(-1) as PrepEvent;
  const codes = (e: unknown) => validatePrepEvent(e).map((x) => `${x.path}:${x.code}`);

  it("accetta un evento composto e riconosce il tipo", () => {
    expect(validatePrepEvent(good)).toEqual([]);
    expect(isPrepEvent(good)).toBe(true);
    expect(isPrepEvent({ type: "purchase" })).toBe(false);
  });

  it("segnala i campi non validi", () => {
    expect(codes(null)).toEqual([":not_an_object"]);
    expect(codes({ ...good, portions: 2.5 })).toContain("portions:invalid_value");
    expect(codes({ ...good, portions: 0 })).toContain("portions:not_positive");
    expect(codes({ ...good, ingredients: [] })).toContain("ingredients:required");
    expect(codes({ ...good, ingredients: [{ lotId: "a" }] })).toContain("ingredients[0].quantity:required");
    expect(codes({ ...good, location: "balcone" })).toContain("location:invalid_value");
    expect(codes({ ...good, costCents: 1.5 })).toContain("costCents:invalid_value");
    expect(codes({ ...good, costPartial: "si" })).toContain("costPartial:invalid_type");
    expect(codes({ ...good, cookedPerRaw: 0 })).toContain("cookedPerRaw:not_positive");
    expect(codes({ ...good, batchLotId: "" })).toContain("batchLotId:invalid_type");
    expect(codes({ ...good, type: "altro" })).toContain("type:invalid_value");
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    expect(() => validatePrepEvent(cyc)).not.toThrow();
  });
});

describe("derivePreps", () => {
  function scenario() {
    const base = pantryEvents();
    const lots = lotsOf(base);
    const r = compose(base, {
      prepId: "zuppa",
      ingredients: [
        { lot: lots.rice, quantity: q(200, "g") },
        { lot: lots.spice, quantity: q(5, "g") },
      ],
    });
    return { base, r, all: [...base, ...r.events] };
  }

  it("stato iniziale: porzioni, costo parziale dichiarato, scadenza e legami", () => {
    const { r, all } = scenario();
    const state = derivePreps(all);
    expect(state.anomalies).toEqual([]);
    expect(state.preps).toHaveLength(1);
    const p = state.preps[0];
    expect(p).toMatchObject({
      prepId: "zuppa",
      title: "Riso al latte",
      cookedAt: COOK,
      batchLotId: r.batchLotId,
      portions: 4,
      remaining: 4,
      eaten: 0,
      discarded: 0,
      gifted: 0,
      status: "active",
      location: "frigo",
      expiry: { date: "2026-03-13", kind: "estimated" },
      cost: { totalCents: 100, perPortionCents: 25, partial: true, unknownLotIds: ["spice"] },
      batchEventIds: [],
    });
    expect(getPrep(state, "zuppa")).toBe(p);
    expect(getPrep(state, "nope")).toBeUndefined();
    expect(prepLotRefs(state).get(r.batchLotId)).toEqual({ productRef: "Riso al latte", prepId: "zuppa" });
  });

  it("porzioni mangiate, buttate e rimaste; preparazione finita", () => {
    const { r, all } = scenario();
    const more = [
      consume("e1", "2026-03-11T11:30:00.000Z", { lotId: r.batchLotId, quantity: q(1, "pz"), mealId: "m1" }),
      consume("e2", "2026-03-11T18:30:00.000Z", { lotId: r.batchLotId, quantity: q(1, "pz"), mealId: "m2" }),
      discard("e3", "2026-03-14T08:00:00.000Z", { lotId: r.batchLotId, quantity: q(1, "pz"), reason: "expired" }),
    ];
    const mid = derivePreps([...all, ...more]).preps[0];
    expect(mid).toMatchObject({ remaining: 1, eaten: 2, discarded: 1, status: "active" });
    expect(mid.batchEventIds).toEqual(["e1", "e2", "e3"]);
    const done = derivePreps([
      ...all,
      ...more,
      consume("e4", "2026-03-12T11:30:00.000Z", { lotId: r.batchLotId, quantity: q(1, "pz") }),
    ]).preps[0];
    expect(done).toMatchObject({ remaining: 0, eaten: 3, status: "finished" });
  });

  it("il costo per porzione è quello congelato alla cottura, anche se il prezzo del lotto cambia dopo", () => {
    const { r, all } = scenario();
    const patched = [
      ...all,
      { id: "u1", type: "updateLot", at: "2026-03-12T08:00:00.000Z", recordedAt: "2026-03-12T08:00:00.000Z", deviceId: "dev-a", schemaVersion: 1, certainty: "measured", source: "manual", lotId: r.batchLotId, patch: { priceCents: 999 } },
    ];
    expect(derivePreps(patched).preps[0].cost.totalCents).toBe(100);
  });

  it("senza costi noti il costo resta assente", () => {
    const base = pantryEvents();
    const lots = lotsOf(base);
    const r = compose(base, { prepId: "p", ingredients: [{ lot: lots.spice, quantity: q(5, "g") }] });
    const p = derivePreps([...base, ...r.events]).preps[0];
    expect(p.cost).toEqual({ partial: true, unknownLotIds: ["spice"] });
  });

  it("lotto di porzioni mancante: anomalia e stato dedicato", () => {
    const { r, all } = scenario();
    const decl = r.events.find((e) => e.type === "declare")!;
    const state = derivePreps([...all, voidOf("v", "2026-03-11T08:00:00.000Z", decl.id)]);
    expect(state.preps[0]).toMatchObject({ status: "batch_missing", remaining: 0, eaten: 0 });
    expect(state.anomalies.map((a) => a.code)).toEqual(["batch_lot_missing"]);
  });

  it("due preparazioni con lo stesso prepId: conta la prima, l'altra è un'anomalia", () => {
    const base = pantryEvents();
    const lots = lotsOf(base);
    const a = compose(base, { prepId: "dup", ingredients: [{ lot: lots.rice, quantity: q(10, "g") }] }, { idGenerator: ids("a") });
    const b = compose(base, { prepId: "dup", ingredients: [{ lot: lots.rice, quantity: q(20, "g") }] }, { idGenerator: ids("b"), at: "2026-03-11T17:00:00.000Z" });
    const state = derivePreps([...base, ...a.events, ...b.events]);
    expect(state.preps).toHaveLength(1);
    expect(state.preps[0].eventId).toBe((a.events.at(-1) as PrepEvent).id);
    expect(state.anomalies.map((x) => x.code)).toEqual(["duplicate_prep"]);
  });

  it("segnala eventi non validi e conflitti senza perdere gli altri", () => {
    const { all } = scenario();
    const broken = { ...(all.at(-1) as PrepEvent), id: "broken", prepId: "" };
    const state = derivePreps([...all, broken, { type: "prep" }]);
    expect(state.preps).toHaveLength(1);
    expect(state.anomalies.map((a) => a.code)).toEqual(["invalid_event", "invalid_event"]);
  });

  it("indipendente dall'ordine degli eventi e dai duplicati", () => {
    const { r, all } = scenario();
    const events = [
      ...all,
      consume("e1", "2026-03-11T11:30:00.000Z", { lotId: r.batchLotId, quantity: q(1, "pz"), mealId: "m1" }),
      discard("e3", "2026-03-14T08:00:00.000Z", { lotId: r.batchLotId, quantity: q(1, "pz"), reason: "expired" }),
    ];
    const expected = derivePreps(events);
    for (let seed = 1; seed <= 15; seed++) {
      expect(derivePreps(shuffled([...events, ...events.slice(0, 4)], seededRandom(seed)))).toEqual(expected);
    }
  });

  it("l'evento prep non disturba la dispensa", () => {
    const { all } = scenario();
    expect(derivePantry(all).anomalies).toEqual([]);
  });

  it("accetta una dispensa già calcolata", () => {
    const { all } = scenario();
    expect(derivePreps(all, { pantry: derivePantry(all) })).toEqual(derivePreps(all));
  });
});

describe("voidPrep", () => {
  function scenario() {
    const base = pantryEvents();
    const lots = lotsOf(base);
    const r = compose(base, {
      prepId: "zuppa",
      ingredients: [
        { lot: lots.rice, quantity: q(200, "g") },
        { lot: lots.milk, quantity: q(250, "ml") },
      ],
    });
    return { base, r, all: [...base, ...r.events] };
  }
  const voidOptions = () => ({ now: () => "2026-03-11T09:00:00.000Z", idGenerator: ids("void") });

  it("annulla l'intera preparazione e ripristina gli ingredienti", () => {
    const { base, r, all } = scenario();
    const res = voidPrep("zuppa", all, voidOptions());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.every((e) => e.type === "void")).toBe(true);
    expect(res.events.map((e) => e.targetEventId).sort()).toEqual(r.events.map((e) => e.id).sort());
    expect(new Set(res.events.map((e) => e.at)).size).toBe(1);

    const after = [...all, ...res.events];
    const pantry = derivePantry(after);
    expect(pantry.anomalies).toEqual([]);
    const byId = Object.fromEntries(pantry.lots.map((l) => [l.lotId, l]));
    expect(byId.rice.remaining).toBe(500);
    expect(byId.milk.remaining).toBe(1000);
    expect(byId[r.batchLotId]).toBeUndefined();
    // Come se non fosse mai successo.
    expect(derivePantry(base).lots).toEqual(pantry.lots);

    const state = derivePreps(after);
    expect(state.preps).toEqual([]);
    expect(state.voidedPrepIds).toEqual(["zuppa"]);
    expect(state.anomalies).toEqual([]);
  });

  it("annullare i void ripristina la preparazione", () => {
    const { all } = scenario();
    const res = voidPrep("zuppa", all, voidOptions());
    if (!res.ok) throw new Error("atteso ok");
    const undo = res.events.map((v, i) => voidOf(`undo-${i}`, "2026-03-12T09:00:00.000Z", v.id));
    const state = derivePreps([...all, ...res.events, ...undo]);
    expect(state.preps).toHaveLength(1);
    expect(derivePantry([...all, ...res.events, ...undo]).lots.find((l) => l.lotId === "rice")?.remaining).toBe(300);
  });

  it("già annullata o sconosciuta", () => {
    const { all } = scenario();
    const res = voidPrep("zuppa", all, voidOptions());
    if (!res.ok) throw new Error("atteso ok");
    expect(voidPrep("zuppa", [...all, ...res.events])).toEqual({ ok: false, reason: "already_voided", blocking: [] });
    expect(voidPrep("boh", all)).toEqual({ ok: false, reason: "not_found", blocking: [] });
    expect(voidPrep("zuppa", [])).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("rifiuta se le porzioni sono già state usate, a meno di force", () => {
    const { r, all } = scenario();
    const used = [
      ...all,
      consume("e1", "2026-03-11T11:30:00.000Z", { lotId: r.batchLotId, quantity: q(1, "pz"), mealId: "m1" }),
      discard("e2", "2026-03-12T11:30:00.000Z", { lotId: r.batchLotId, quantity: q(1, "pz"), reason: "leftover" }),
    ];
    expect(voidPrep("zuppa", used, voidOptions())).toEqual({
      ok: false,
      reason: "portions_used",
      blocking: ["e1", "e2"],
    });
    const forced = voidPrep("zuppa", used, { ...voidOptions(), force: true });
    expect(forced.ok).toBe(true);
    if (!forced.ok) return;
    expect(forced.events.map((e) => e.targetEventId)).toEqual(expect.arrayContaining(["e1", "e2"]));
    const pantry = derivePantry([...used, ...forced.events]);
    expect(pantry.anomalies).toEqual([]);
    expect(pantry.lots.find((l) => l.lotId === "rice")?.remaining).toBe(500);
  });

  it("non annulla due volte gli eventi già annullati a mano", () => {
    const { r, all } = scenario();
    const manual = voidOf("manual", "2026-03-10T18:00:00.000Z", r.events[0].id);
    const res = voidPrep("zuppa", [...all, manual], voidOptions());
    if (!res.ok) throw new Error("atteso ok");
    expect(res.events.map((e) => e.targetEventId)).not.toContain(r.events[0].id);
    expect(res.events).toHaveLength(r.events.length - 1);
  });

  it("usa il dispositivo degli eventi bersaglio, o quello indicato se manca", () => {
    const { all } = scenario();
    const res = voidPrep("zuppa", all, voidOptions());
    if (!res.ok) throw new Error("atteso ok");
    expect(new Set(res.events.map((e) => e.deviceId))).toEqual(new Set(["dev-a"]));
  });
});
