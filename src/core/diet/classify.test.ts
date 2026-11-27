import { describe, expect, it } from "vitest";
import type { Product } from "../catalog";
import { consume, meal, purchase } from "../diary/test-helpers";
import { derivePantry, type Lot, type LotHistoryEntry } from "../ledger";
import {
  computeIntake,
  compositionFromFood,
  compositionFromProduct,
  type CompositionResolver,
  type DayIntake,
  type DrinkIntake,
  type FoodComposition,
  type IntakeLine,
  type ResolvedLine,
  type UnresolvedLine,
} from "../nutrition";
import { FOODS } from "../nutrition/data/foods";
import { createClassifier, lotsByConsume, overrideKeyOf, rawEquivalentGrams } from "./classify";
import { composePrep } from "../prep";
import type { ClassOverrides, ClassifierSources, PrepForDiet } from "./types";
import { buildDietHistory } from "./week";

const foods: ReadonlyMap<string, FoodComposition> = new Map(FOODS.map((f) => [f.id, f]));
const food = (id: string): FoodComposition => foods.get(id)!;

function lot(p: Partial<Lot> & { lotId: string; productRef: string }): Lot {
  return {
    origin: "purchase",
    status: "active",
    unit: "g",
    initial: 1000,
    remaining: 500,
    consumed: 500,
    discarded: 0,
    gifted: 0,
    location: "dispensa",
    createdAt: "2026-11-01T10:00:00Z",
    initialCertainty: "measured",
    remainingCertainty: "estimated",
    history: [],
    ...p,
  };
}

function product(p: Partial<Product> & { barcode: string }): Product {
  return { fetchedAt: "2026-11-01T10:00:00Z", source: "openfoodfacts", ...p };
}

function tableLine(
  id: string,
  quantity: ResolvedLine["quantity"],
  opts: { selection?: "explicit" | "name"; kind?: "mealItem" | "pantry"; eventId?: string; mealId?: string; itemIndex?: number } = {},
): ResolvedLine {
  const f = food(id);
  const kcal = f.per100.energyKcal;
  return {
    kind: opts.kind ?? "mealItem",
    label: f.name,
    quantity,
    quantityCertainty: "estimated",
    eventId: opts.eventId ?? "meal-1",
    ...(opts.kind === "pantry" ? {} : { itemIndex: opts.itemIndex ?? 0 }),
    ...(opts.mealId !== undefined ? { mealId: opts.mealId } : { mealId: "m1" }),
    status: "ok",
    composition: {
      name: f.name,
      ref: f.id,
      origin: "table",
      ...(f.state !== undefined ? { state: f.state } : {}),
      selection: opts.selection ?? "name",
    },
    nutrients: quantity.unit === "g" && kcal !== undefined ? { energyKcal: (kcal * quantity.value) / 100 } : {},
    certainty: "estimated",
  };
}

function unresolved(label: string, quantity: UnresolvedLine["quantity"], kind: "mealItem" | "pantry" = "mealItem", eventId = "ev-u"): UnresolvedLine {
  return {
    kind,
    label,
    quantity,
    quantityCertainty: "estimated",
    eventId,
    ...(kind === "mealItem" ? { itemIndex: 2, mealId: "m1" } : {}),
    status: "unresolved",
    reason: "no_composition",
  };
}

function sources(p: Partial<ClassifierSources> = {}): ClassifierSources {
  return {
    foods,
    products: new Map(),
    lotOfConsume: () => undefined,
    lots: new Map(),
    preps: new Map(),
    overrides: {},
    ...p,
  };
}

describe("alimenti della tabella", () => {
  it("alimento scelto: certezza label; trovato dal nome: stima", () => {
    const c = createClassifier(sources());
    const chosen = c.line(tableLine("ceci-in-scatola", { value: 150, unit: "g" }, { selection: "explicit" }), "2026-11-20");
    expect(chosen.parts).toHaveLength(1);
    expect(chosen.parts[0]).toMatchObject({ group: "legumes", portionKey: "legumes", basis: "food", certainty: "label", grams: 150 });
    expect(chosen.parts[0]!.processing).toEqual({ level: 3, certainty: "estimated", basis: "declared" });
    const byName = c.line(tableLine("ceci-in-scatola", { value: 150, unit: "g" }), "2026-11-20");
    expect(byName.parts[0]!.certainty).toBe("estimated");
  });

  it("riporta grammi cotti all'equivalente crudo a parità di energia", () => {
    const c = createClassifier(sources());
    const pasta = c.line(tableLine("pasta-cotta", { value: 200, unit: "g" }), "2026-11-20").parts[0]!;
    expect(pasta.group).toBe("refinedGrains");
    expect(pasta.portionKey).toBe("grains");
    expect(pasta.grams).toBeCloseTo((200 * 158) / 371, 2);
    expect(pasta.gramsCertainty).toBe("estimated");
    expect(pasta.energyKcal).toBeCloseTo(316, 5);
    const lentils = c.line(tableLine("lenticchie-lessate", { value: 150, unit: "g" }), "2026-11-20").parts[0]!;
    expect(lentils.portionKey).toBe("legumesDry");
    expect(lentils.grams).toBeCloseTo((150 * 116) / 352, 2);
  });

  it("rawEquivalentGrams non converte ciò che è già crudo o senza varianti", () => {
    expect(rawEquivalentGrams(food("pasta-secca"), 80, foods)).toEqual({ grams: 80, certainty: "measured" });
    expect(rawEquivalentGrams(food("ceci-in-scatola"), 100, foods)).toEqual({ grams: 100, certainty: "measured" });
    expect(rawEquivalentGrams(food("riso-integrale-lessato"), 100, foods).certainty).toBe("estimated");
  });

  it("i pezzi diventano grammi solo con il peso di un pezzo: altrimenti restano assenti", () => {
    const c = createClassifier(sources());
    const egg = c.line(tableLine("uovo-intero-crudo", { value: 2, unit: "pz" }), "2026-11-20").parts[0]!;
    expect(egg).toMatchObject({ group: "eggs", grams: 100 });
    const noWeight = FOODS.find((f) => f.unitWeightG === undefined && f.group === "verdura")!;
    const veg = c.line(tableLine(noWeight.id, { value: 1, unit: "pz" }), "2026-11-20").parts[0]!;
    expect(veg.group).toBe("vegetables");
    expect(veg.grams).toBeUndefined();
    expect(veg.gramsCertainty).toBeUndefined();
  });

  it("ml: con la densità della tabella, altrimenti 1 g per ml come stima", () => {
    const c = createClassifier(sources());
    const withDensity = FOODS.find((f) => f.densityGPerMl !== undefined)!;
    const l = tableLine(withDensity.id, { value: 200, unit: "ml" });
    l.quantityCertainty = "measured";
    const p = c.line(l, "2026-11-20").parts[0]!;
    expect(p.grams).toBeCloseTo(200 * withDensity.densityGPerMl!, 3);
    expect(p.gramsCertainty).toBe("measured");
    const noDensity = FOODS.find((f) => f.densityGPerMl === undefined && f.variantOf === undefined && f.group === "bevande")!;
    const l2 = tableLine(noDensity.id, { value: 200, unit: "ml" });
    l2.quantityCertainty = "measured";
    expect(c.line(l2, "2026-11-20").parts[0]).toMatchObject({ grams: 200, gramsCertainty: "estimated" });
  });
});

describe("chiavi della riga", () => {
  it("voce libera: evento#indice, occasione = pasto; dispensa fuori pasto: occasione = riga", () => {
    const c = createClassifier(sources());
    const item = c.line(tableLine("mela-cruda", { value: 150, unit: "g" }, { eventId: "meal-9", itemIndex: 3, mealId: "m9" }), "2026-11-20");
    expect(item).toMatchObject({ lineKey: "meal-9#3", occasionKey: "m9", date: "2026-11-20" });
    const pantry = tableLine("mela-cruda", { value: 150, unit: "g" }, { kind: "pantry", eventId: "cons-1" });
    delete (pantry as { mealId?: string }).mealId;
    expect(c.line(pantry, "2026-11-20")).toMatchObject({ lineKey: "cons-1", occasionKey: "cons-1" });
  });
});

describe("fuori casa", () => {
  it("una parte outOfHome con la sola energia", () => {
    const c = createClassifier(sources());
    const line: ResolvedLine = {
      kind: "mealItem",
      label: "Pranzo al ristorante",
      quantity: { value: 1, unit: "pz" },
      quantityCertainty: "estimated",
      eventId: "meal-2",
      itemIndex: 0,
      mealId: "m2",
      status: "ok",
      composition: { name: "Pranzo al ristorante", origin: "derived" },
      nutrients: { energyKcal: 800 },
      certainty: "estimated",
      outOfHome: true,
    };
    const lc = c.line(line, "2026-11-20");
    expect(lc.parts).toEqual([{ group: "outOfHome", basis: "outOfHome", certainty: "estimated", energyKcal: 800, label: "Pranzo al ristorante" }]);
    expect(lc.overrideKey).toBeUndefined();
  });
});

describe("prodotti con codice", () => {
  const tuna = product({ barcode: "8001234567890", name: "Tonno all'olio", categories: ["fishes", "canned-fishes"], nova: 3 });
  const plain = product({ barcode: "8000000000001", name: "Petto di pollo a fette" });
  const crackers = product({
    barcode: "8000000000002",
    name: "Cracker",
    categories: ["crackers"],
    ingredientsText: "Farina integrale di frumento, olio di girasole, sale",
    nova: 4,
  });
  const cheese = product({
    barcode: "8000000000003",
    categories: ["cheeses"],
    nutrients: { per: "100g", certainty: "label", energyKcal: 250 },
  });
  const products = new Map([tuna, plain, crackers, cheese].map((p) => [p.barcode, p]));

  const productLine = (p: Product, eventId: string): ResolvedLine => ({
    kind: "pantry",
    label: p.barcode,
    quantity: { value: 80, unit: "g" },
    quantityCertainty: "label",
    eventId,
    status: "ok",
    composition: { name: p.name ?? p.barcode, ref: p.barcode, origin: "label", selection: "product" },
    nutrients: { energyKcal: 150, saltG: 0.8 },
    certainty: "label",
  });

  it("categorie di Open Food Facts e lavorazione dalla scheda: label", () => {
    const c = createClassifier(sources({ products }));
    const lc = c.line(productLine(tuna, "c1"), "2026-11-20");
    expect(lc.parts[0]).toMatchObject({
      group: "fish",
      portionKey: "fishPreserved",
      basis: "product",
      certainty: "label",
      processing: { level: 3, certainty: "label", basis: "product" },
      grams: 80,
      gramsCertainty: "label",
      energyKcal: 150,
      saltG: 0.8,
    });
    expect(lc.overrideKey).toBe(`b:${tuna.barcode}`);
  });

  it("senza categorie: categoria del lotto, poi nome; senza nova nessuna lavorazione", () => {
    const pollo = lot({ lotId: "L1", productRef: plain.barcode, barcode: plain.barcode, category: "poultry" });
    const c = createClassifier(sources({ products, lotOfConsume: (id) => (id === "c2" ? pollo : undefined) }));
    const byCategory = c.line(productLine(plain, "c2"), "2026-11-20").parts[0]!;
    expect(byCategory).toMatchObject({ group: "whiteMeat", basis: "category", certainty: "estimated" });
    expect(byCategory.processing).toBeUndefined();
    const byName = createClassifier(sources({ products })).line(productLine(plain, "c3"), "2026-11-20").parts[0]!;
    expect(byName).toMatchObject({ group: "whiteMeat", basis: "name", certainty: "estimated" });
  });

  it("integrale solo dal primo ingrediente; formaggio per energia", () => {
    const c = createClassifier(sources({ products }));
    expect(c.line(productLine(crackers, "c4"), "2026-11-20").parts[0]).toMatchObject({
      group: "wholeGrains",
      portionKey: "breadSubstitutes",
      certainty: "label",
    });
    const white = product({ ...crackers, barcode: "8000000000004", ingredientsText: "Farina di grano tenero tipo 0, farina integrale" });
    const c2 = createClassifier(sources({ products: new Map([[white.barcode, white]]) }));
    expect(c2.line(productLine(white, "c5"), "2026-11-20").parts[0]!.group).toBe("refinedGrains");
    expect(c.line(productLine(cheese, "c6"), "2026-11-20").parts[0]).toMatchObject({ group: "cheese", portionKey: "cheeseFresh" });
  });

  it("un prodotto senza valori (riga non risolta) si classifica comunque dalla scheda", () => {
    const tunaLot = lot({ lotId: "L9", productRef: "Tonno", barcode: tuna.barcode });
    const c = createClassifier(sources({ products, lotOfConsume: () => tunaLot }));
    const lc = c.line(unresolved("Tonno", { value: 80, unit: "g" }, "pantry", "c7"), "2026-11-20");
    expect(lc.parts[0]).toMatchObject({ group: "fish", portionKey: "fishPreserved", certainty: "label", grams: 80 });
    expect(lc.parts[0]!.energyKcal).toBeUndefined();
    expect(lc.overrideKey).toBe(`b:${tuna.barcode}`);
  });
});

describe("correzioni dell'utente", () => {
  it("la correzione vince: gruppo e lavorazione con certezza label e base user", () => {
    const overrides: ClassOverrides = { "n:cracker integral": { group: "refinedGrains", processing: 4 } };
    const c = createClassifier(sources({ overrides }));
    const lc = c.line(unresolved("Cracker integrali", { value: 30, unit: "g" }), "2026-11-20");
    expect(lc.overrideKey).toBe("n:cracker integral");
    expect(lc.parts[0]).toMatchObject({
      group: "refinedGrains",
      portionKey: "breadSubstitutes",
      basis: "user",
      certainty: "label",
      processing: { level: 4, certainty: "label", basis: "user" },
    });
  });

  it("solo la lavorazione: il gruppo resta la stima", () => {
    const c = createClassifier(sources({ overrides: { "n:lenticch": { processing: 1 } } }));
    const p = c.line(unresolved("Lenticchie", { value: 100, unit: "g" }), "2026-11-20").parts[0]!;
    expect(p).toMatchObject({ group: "legumes", basis: "name", certainty: "estimated" });
    expect(p.processing).toEqual({ level: 1, certainty: "label", basis: "user" });
  });

  it("un gruppo diverso prende la porzione predefinita del gruppo", () => {
    const c = createClassifier(sources({ overrides: { "n:xyz": { group: "fish" } } }));
    expect(c.line(unresolved("xyz", { value: 100, unit: "g" }), "2026-11-20").parts[0]).toMatchObject({
      group: "fish",
      portionKey: "fish",
      basis: "user",
    });
  });

  it("vale anche per i nomi di ricette e piano", () => {
    const c = createClassifier(sources({ overrides: { "n:xyz": { group: "fish" } } }));
    expect(c.name("Xyz").group).toBe("fish");
  });
});

describe("righe non risolte", () => {
  it("categoria del lotto, poi nome, poi unknown; grammi solo in g o ml", () => {
    const veg = lot({ lotId: "L2", productRef: "Roba verde", category: "leafy_vegetables" });
    const c = createClassifier(sources({ lotOfConsume: (id) => (id === "c-veg" ? veg : undefined) }));
    expect(c.line(unresolved("Roba verde", { value: 80, unit: "g" }, "pantry", "c-veg"), "2026-11-20").parts[0]).toMatchObject({
      group: "vegetables",
      portionKey: "leafySalad",
      basis: "category",
      processing: { level: 1, certainty: "estimated", basis: "category" },
      grams: 80,
    });
    expect(c.line(unresolved("Fagioli borlotti", { value: 2, unit: "pz" }), "2026-11-20").parts[0]).toMatchObject({
      group: "legumes",
      basis: "name",
    });
    expect(c.line(unresolved("Fagioli borlotti", { value: 2, unit: "pz" }), "2026-11-20").parts[0]!.grams).toBeUndefined();
    const unknown = c.line(unresolved("Qwerty", { value: 50, unit: "g" }), "2026-11-20").parts[0]!;
    expect(unknown).toMatchObject({ group: "unknown", basis: "none", grams: 50 });
    expect(unknown.portionKey).toBeUndefined();
  });
});

describe("preparazioni", () => {
  const pasta = lot({ lotId: "ing-pasta", productRef: "Pasta" });
  const passata = lot({ lotId: "ing-passata", productRef: "8000000000010", barcode: "8000000000010" });
  const mystery = lot({ lotId: "ing-x", productRef: "Ingrediente misterioso" });
  const batch = lot({ lotId: "batch-1", productRef: "Pasta al pomodoro", unit: "pz", initial: 4 });
  const prep: PrepForDiet = {
    prepId: "prep-1",
    batchLotId: "batch-1",
    portions: 4,
    ingredients: [
      { lotId: "ing-pasta", productRef: "Pasta", quantity: { value: 320, unit: "g" } },
      { lotId: "ing-passata", productRef: "8000000000010", quantity: { value: 400, unit: "g" } },
      { lotId: "ing-x", productRef: "Ingrediente misterioso", quantity: { value: 2, unit: "pz" } },
    ],
  };
  const passataProduct = product({
    barcode: "8000000000010",
    name: "Passata di pomodoro",
    categories: ["tomato-purees"],
    nova: 1,
    nutrients: { per: "100g", certainty: "label", energyKcal: 30 },
  });
  const resolve: CompositionResolver = (s) => {
    if (s.kind !== "pantry") return undefined;
    if (s.lotId === "ing-pasta") return compositionFromFood(food("pasta-secca"));
    if (s.lotId === "ing-passata") return compositionFromProduct(passataProduct);
    return undefined;
  };
  const consumeLine = (q: ResolvedLine["quantity"]): ResolvedLine => ({
    kind: "pantry",
    label: "Pasta al pomodoro",
    quantity: q,
    quantityCertainty: "measured",
    eventId: "c-prep",
    mealId: "m3",
    status: "ok",
    composition: { name: "Pasta al pomodoro", ref: "prep:prep-1", origin: "derived" },
    nutrients: { energyKcal: 330 },
    certainty: "estimated",
  });
  const base = () =>
    sources({
      products: new Map([[passataProduct.barcode, passataProduct]]),
      lots: new Map([pasta, passata, mystery, batch].map((l) => [l.lotId, l])),
      preps: new Map([["batch-1", prep]]),
      lotOfConsume: (id) => (id === "c-prep" ? batch : undefined),
      resolve,
    });

  it("una porzione al 50% si scompone negli ingredienti, scalati", () => {
    const c = createClassifier(base());
    const lc = c.line(consumeLine({ value: 2, unit: "pz" }), "2026-11-20");
    expect(lc.parts).toHaveLength(3);
    const [p, t, x] = lc.parts;
    expect(p).toMatchObject({ group: "refinedGrains", portionKey: "grains", basis: "prep", prepId: "prep-1", grams: 160 });
    expect(p!.energyKcal).toBeCloseTo((371 * 320) / 100 / 2, 3);
    expect(t).toMatchObject({ group: "vegetables", basis: "prep", certainty: "label", grams: 200, energyKcal: 60 });
    expect(t!.processing).toEqual({ level: 1, certainty: "label", basis: "product" });
    expect(x).toMatchObject({ group: "unknown", basis: "prep" });
    expect(x!.grams).toBeUndefined();
  });

  it("si riconosce anche dal lotto del consumo, senza il ref prep:", () => {
    const c = createClassifier(base());
    const line = consumeLine({ value: 1, unit: "pz" });
    line.composition = { name: "Pasta al pomodoro", origin: "table" };
    expect(c.line(line, "2026-11-20").parts).toHaveLength(3);
  });

  it("frazione ignota: un solo piatto misto stimato", () => {
    const c = createClassifier(base());
    const lc = c.line(consumeLine({ value: 300, unit: "g" }), "2026-11-20");
    expect(lc.parts).toEqual([
      { group: "mixedDish", basis: "prep", certainty: "estimated", energyKcal: 330, prepId: "prep-1", label: "Pasta al pomodoro" },
    ]);
  });

  it("un giro chiuso tra preparazioni non si ripete all'infinito", () => {
    const loop: PrepForDiet = {
      prepId: "prep-loop",
      batchLotId: "batch-loop",
      portions: 2,
      ingredients: [{ lotId: "batch-loop", productRef: "Se stessa", quantity: { value: 1, unit: "pz" } }],
    };
    const c = createClassifier(sources({ preps: new Map([["batch-loop", loop]]) }));
    const line = consumeLine({ value: 1, unit: "pz" });
    line.composition = { name: "Se stessa", ref: "prep:prep-loop", origin: "derived" };
    const parts = c.line(line, "2026-11-20").parts;
    expect(parts.length).toBeGreaterThan(0);
  });
});

describe("bevande", () => {
  const drink = (name: string, extra: Partial<DrinkIntake> = {}): DrinkIntake => ({
    eventId: `d-${name}`,
    at: "2026-11-20T10:00:00Z",
    name,
    ml: 250,
    certainty: "estimated",
    ...extra,
  });
  it("acqua, caffè e tè sono altre bevande; i succhi bevande zuccherate; zuccheri ed energia se dichiarati", () => {
    const c = createClassifier(sources());
    expect(c.drink(drink("Acqua"), "2026-11-20").parts[0]).toMatchObject({ group: "otherDrinks", grams: 250 });
    expect(c.drink(drink("Caffè"), "2026-11-20").parts[0]!.group).toBe("otherDrinks");
    expect(c.drink(drink("Tè"), "2026-11-20").parts[0]!.group).toBe("otherDrinks");
    const juice = c.drink(drink("Succo d'arancia", { sugarsG: 22, energyKcal: 110 }), "2026-11-20");
    expect(juice.parts[0]).toMatchObject({ group: "sugaryDrinks", portionKey: "sugaryDrinks", sugarsG: 22, energyKcal: 110 });
    expect(juice).toMatchObject({ lineKey: "d-Succo d'arancia", occasionKey: "d-Succo d'arancia" });
    const cola = c.drink(drink("Bibita gassata alla cola"), "2026-11-20").parts[0]!;
    expect(cola).toMatchObject({ group: "sugaryDrinks", basis: "food" });
    expect(cola.processing?.level).toBe(4);
    expect(cola.energyKcal).toBeUndefined();
  });
  it("un nome ignoto è non riconosciuto", () => {
    const c = createClassifier(sources());
    expect(c.drink(drink("Pozione magica"), "2026-11-20").parts[0]!.group).toBe("unknown");
  });
});

describe("giornata, nomi e utilità", () => {
  it("day classifica pasti, consumi fuori pasto e bevande", () => {
    const c = createClassifier(sources());
    const standalone = tableLine("mela-cruda", { value: 150, unit: "g" }, { kind: "pantry", eventId: "c-free" });
    delete (standalone as { mealId?: string }).mealId;
    const day = {
      date: "2026-11-20",
      complete: true,
      reasons: [],
      coverage: {},
      meals: [{ mealId: "m1", lines: [tableLine("pasta-cotta", { value: 200, unit: "g" }, { eventId: "e1" })] }],
      standalone: [standalone],
      drinks: [{ eventId: "d1", at: "2026-11-20T10:00:00Z", name: "Acqua", ml: 500, certainty: "estimated" }],
      totals: {},
      unresolved: [],
    } as unknown as DayIntake;
    const lines = c.day(day);
    expect(lines.map((l) => [l.lineKey, l.occasionKey])).toEqual([
      ["e1#0", "m1"],
      ["c-free", "c-free"],
      ["d1", "d1"],
    ]);
    expect(lines.every((l) => l.date === "2026-11-20")).toBe(true);
  });

  it("name: id della tabella (label), nome (stima), ignoto", () => {
    const c = createClassifier(sources());
    expect(c.name("Ceci", "ceci-secchi")).toMatchObject({ group: "legumes", portionKey: "legumesDry", certainty: "label", basis: "food" });
    expect(c.name("Salmone")).toMatchObject({ group: "fish", certainty: "estimated", basis: "name" });
    expect(c.name("Qwerty")).toMatchObject({ group: "unknown", basis: "none", label: "Qwerty" });
    expect(c.name("Salmone")).toBe(c.name("Salmone"));
  });

  it("lotsByConsume legge i consumi dalla storia del lotto", () => {
    const h = (eventId: string, type: LotHistoryEntry["type"]): LotHistoryEntry => ({ eventId, type, at: "2026-11-01T10:00:00Z", certainty: "estimated" });
    const a = lot({ lotId: "A", productRef: "a", history: [h("p1", "purchase"), h("c1", "consume"), h("c2", "consume")] });
    const b = lot({ lotId: "B", productRef: "b", history: [h("c3", "consume"), h("d1", "discard")] });
    const map = lotsByConsume([a, b]);
    expect(map.get("c1")).toBe(a);
    expect(map.get("c3")).toBe(b);
    expect(map.has("p1")).toBe(false);
    expect(map.has("d1")).toBe(false);
  });

  it("overrideKeyOf: codice, poi nome normalizzato", () => {
    const l: IntakeLine = unresolved("Cracker Integrali", { value: 30, unit: "g" });
    expect(overrideKeyOf(l)).toBe("n:cracker integral");
    const p = unresolved("x", { value: 30, unit: "g" }, "pantry");
    expect(overrideKeyOf(p, lot({ lotId: "L", productRef: "Pane", barcode: "8001112223334" }))).toBe("b:8001112223334");
    expect(overrideKeyOf(p, lot({ lotId: "L", productRef: "Pane" }))).toBe("n:pan");
    expect(overrideKeyOf(unresolved("", { value: 1, unit: "g" }))).toBeUndefined();
  });

  it("risultati stabili: la memoria non cambia la risposta", () => {
    const c = createClassifier(sources());
    const a = c.line(tableLine("pasta-cotta", { value: 200, unit: "g" }), "2026-11-20");
    const b = c.line(tableLine("pasta-cotta", { value: 100, unit: "g" }), "2026-11-20");
    expect(b.parts[0]!.grams).toBeCloseTo(a.parts[0]!.grams! / 2, 2);
    expect(b.parts[0]!.group).toBe(a.parts[0]!.group);
  });
});

describe("preparazioni dal registro: niente doppio conteggio", () => {
  it("400 g di pollo in 4 porzioni, una mangiata: 1 porzione e 100 g di carne bianca, non 5 e 500 g", () => {
    const pollo = food("pollo-petto-crudo");
    const bought = purchase("p-pollo", "2026-03-01T08:00:00.000Z", {
      lotId: "pollo",
      productRef: pollo.name,
      quantity: { value: 600, unit: "g" },
      location: "frigo",
    });
    let n = 0;
    const composed = composePrep(
      {
        prepId: "pp",
        title: "Pollo al forno",
        portions: 4,
        location: "frigo",
        ingredients: [{ lot: derivePantry([bought]).lots[0]!, quantity: { value: 400, unit: "g" } }],
      },
      { deviceId: "d", now: () => "2026-03-09T17:00:00.000Z", idGenerator: () => `prep-${++n}` },
    );
    if (!composed.ok) throw new Error("preparazione non valida");
    const prepEvent = composed.events.find((e) => e.type === "prep") as unknown as { batchLotId: string };
    const batch = prepEvent.batchLotId;
    const events = [
      bought,
      ...composed.events,
      meal("m", "2026-03-10T12:30:00.000Z", { mealId: "lunch", kind: "lunch" }),
      consume("c-porzione", "2026-03-10T12:30:00.000Z", { lotId: batch, quantity: { value: 1, unit: "pz" }, mealId: "lunch" }),
    ];
    const resolve: CompositionResolver = (s) => {
      if (s.kind !== "pantry") return undefined;
      if (s.lotId === "pollo") return compositionFromFood(pollo);
      if (s.lotId === batch) {
        return { ...compositionFromFood(pollo), name: "Pollo al forno", ref: "prep:pp", origin: "derived", unitWeightG: 100 };
      }
      return undefined;
    };
    const intake = computeIntake(events, resolve);
    const lots = derivePantry(events).lots;
    const byConsume = lotsByConsume(lots);
    const classifier = createClassifier(
      sources({
        lots: new Map(lots.map((l) => [l.lotId, l])),
        lotOfConsume: (id) => byConsume.get(id),
        preps: new Map([
          [batch, { prepId: "pp", batchLotId: batch, portions: 4, ingredients: [{ lotId: "pollo", productRef: pollo.name, quantity: { value: 400, unit: "g" } }] }],
        ]),
        resolve,
      }),
    );
    const history = buildDietHistory({ days: intake.days, today: "2026-03-11", classifier, level: 2000, foods });
    const week = history.weeks[history.weeks.length - 1]!;
    expect(week.tallies.whiteMeat).toMatchObject({ occasions: 1, servings: 1, grams: 100, days: 1 });
  });
});
