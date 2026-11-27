import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/catalog";
import { buildDietHistory, createClassifier, lotsByConsume, type ClassOverrides, type EnergyLevel } from "@/core/diet";
import { meal, water } from "@/core/diary/test-helpers";
import type { AnyEvent } from "@/core/events";
import { derivePantry, sortEvents } from "@/core/ledger";
import { consume, purchase, q, seededRandom, updateLot } from "@/core/ledger/test-helpers";
import { FAKE_FOODS } from "@/core/nutrition/test-helpers";
import { composePrep } from "@/core/prep";
import { derivedOf, freezeShared } from "@/data";
import { barcodesOfLots, buildResolverWithInfo, type FoodOverrides } from "../nutrition/resolver";
import { intakeFor } from "../nutrition/useNutrition";
import { prepsForDiet } from "./inputs";
import type { ConfirmationMap, ConfirmationRecord } from "@/core/allergens";
import { adviceFor, classifierBuildCount, dietFor, type AdviceInputs, type DietInputs } from "./useDiet";

vi.mock("@/core/diet", async (original) => {
  const actual = await original<typeof import("@/core/diet")>();
  return { ...actual, buildDietHistory: vi.fn(actual.buildDietHistory), createClassifier: vi.fn(actual.createClassifier) };
});

const SNACK: Product = {
  barcode: "8001234567890",
  name: "Patatine della casa",
  categories: ["en:snacks", "en:crisps"],
  nova: 4,
  nutrients: { per: "100g", certainty: "label", energyKcal: 540, proteins: 6, carbohydrates: 50, fat: 34 },
  fetchedAt: "2026-11-01T00:00:00.000Z",
  source: "openfoodfacts",
};

const DAY = "2026-03-10";
const TODAY = "2026-03-11";
const PRODUCTS: ReadonlyMap<string, Product> = new Map([[SNACK.barcode, SNACK]]);

/** Dispensa con un prodotto molto lavorato, un lotto riconosciuto solo dalla categoria, una preparazione e due pasti. */
function sampleLog(): AnyEvent[] {
  const base = [
    purchase("p-pollo", "2026-03-01T08:00:00.000Z", { lotId: "pollo", productRef: "Petto di pollo crudo", quantity: q(600), location: "frigo" }),
    purchase("p-pasta", "2026-03-01T08:00:00.000Z", { lotId: "pasta", productRef: "Pasta di semola secca", quantity: q(500), location: "dispensa" }),
    purchase("p-sacco", "2026-03-01T08:00:00.000Z", { lotId: "sacco", productRef: "Sacchetto del mercato", category: "legumes_dry", quantity: q(500), location: "dispensa" }),
    purchase("p-snack", "2026-03-01T08:00:00.000Z", { lotId: "snack", productRef: "Patatine", barcode: SNACK.barcode, quantity: q(300), location: "dispensa" }),
  ];
  const lots = Object.fromEntries(derivePantry(base).lots.map((l) => [l.lotId, l]));
  const composed = composePrep(
    { prepId: "pasta-pollo", title: "Pasta al pollo", portions: 4, location: "frigo", ingredients: [{ lot: lots.pollo, quantity: q(400) }, { lot: lots.pasta, quantity: q(320) }] },
    { deviceId: "dev-a", now: () => "2026-03-09T17:00:00.000Z", idGenerator: (() => { let n = 0; return () => `prep-${++n}`; })() },
  );
  if (!composed.ok) throw new Error(JSON.stringify(composed.errors));
  const events: AnyEvent[] = [...base, ...(composed.events as AnyEvent[])];
  const batchLotId = derivedOf(events).preps.preps[0].batchLotId;
  return sortEvents([
    ...events,
    meal("m-lunch", `${DAY}T12:30:00.000Z`, { mealId: "lunch", kind: "lunch", items: [{ name: "Mela", quantity: q(150), certainty: "estimated" }] }),
    consume("c-prep", `${DAY}T12:30:00.000Z`, { lotId: batchLotId, quantity: q(1, "pz"), mealId: "lunch" }),
    meal("m-dinner", `${DAY}T19:30:00.000Z`, { mealId: "dinner", kind: "dinner" }),
    consume("c-snack", `${DAY}T19:30:00.000Z`, { lotId: "snack", quantity: q(50), mealId: "dinner" }),
    consume("c-sacco", `${DAY}T19:30:00.000Z`, { lotId: "sacco", quantity: q(80), mealId: "dinner" }),
    water("w1", `${DAY}T08:00:00.000Z`, { ml: 250 }),
  ]);
}

function inputsOf(events: readonly AnyEvent[], over: Partial<DietInputs> = {}): DietInputs {
  const products = over.products ?? PRODUCTS;
  const foods = over.foods ?? FAKE_FOODS;
  const foodOverrides = over.foodOverrides ?? {};
  const { intake } = intakeFor({ events, foods, products, overrides: foodOverrides, preps: derivedOf(events).preps });
  return { intake, events, foods, products, foodOverrides, classOverrides: {}, level: 2000, today: TODAY, ...over };
}

/** Lo stesso calcolo da capo: un classificatore nuovo, senza nessuna memoria. */
function fresh(inputs: DietInputs) {
  const derived = derivedOf(inputs.events);
  const lots = new Map(derived.pantry.lots.map((l) => [l.lotId, l]));
  const byConsume = lotsByConsume(derived.pantry.lots);
  const classifier = createClassifier({
    foods: new Map(inputs.foods.map((f) => [f.id, f])),
    products: inputs.products,
    overrides: inputs.classOverrides,
    lotOfConsume: (id) => byConsume.get(id),
    lots,
    preps: prepsForDiet(derived.preps.preps),
    resolve: buildResolverWithInfo({
      foods: inputs.foods,
      products: inputs.products,
      barcodes: barcodesOfLots(derived.pantry.lots),
      overrides: inputs.foodOverrides,
      preps: new Map(derived.preps.preps.map((p) => [p.batchLotId, p])),
    }).resolve,
  });
  return buildDietHistory({ days: inputs.intake.days, today: inputs.today, classifier, level: inputs.level, foods: new Map(inputs.foods.map((f) => [f.id, f])) });
}

describe("dietFor: la memoria dei quadri", () => {
  beforeEach(() => {
    vi.mocked(buildDietHistory).mockClear();
  });

  it("più schermate con gli stessi ingressi: un calcolo solo, lo stesso risultato", () => {
    const inputs = inputsOf(sampleLog());
    const first = dietFor(inputs);
    expect(dietFor({ ...inputs })).toBe(first);
    expect(dietFor({ ...inputs, classOverrides: {} })).toBe(first);
    expect(buildDietHistory).toHaveBeenCalledTimes(1);
    expect(first.history.weeks.length).toBe(9);
  });

  it("un ingresso cambiato ricalcola, una volta", () => {
    const inputs = inputsOf(sampleLog());
    let last = dietFor(inputs);
    let calls = 1;
    const changed: DietInputs[] = [
      inputsOf([...inputs.events]),
      { ...inputs, foods: [...inputs.foods] },
      { ...inputs, products: new Map(inputs.products) },
      { ...inputs, classOverrides: { "n:mela": { group: "sweets" } } },
      { ...inputs, level: 2500 as EnergyLevel },
      { ...inputs, today: "2026-03-12" },
      { ...inputs, foodOverrides: { mela: "pesca" } },
    ];
    for (const next of changed) {
      const out = dietFor(next);
      expect(out).not.toBe(last);
      expect(dietFor({ ...next })).toBe(out);
      expect(buildDietHistory).toHaveBeenCalledTimes(++calls);
      last = out;
    }
  });

  it("le correzioni contano per il contenuto", () => {
    const over: ClassOverrides = { "n:mela": { group: "sweets" } };
    const inputs = inputsOf(sampleLog(), { classOverrides: over });
    const first = dietFor(inputs);
    expect(dietFor({ ...inputs, classOverrides: { "n:mela": { group: "sweets" } } })).toBe(first);
    expect(buildDietHistory).toHaveBeenCalledTimes(1);
  });

  it("il calcolo esteso per l'analisi non scaccia quello delle schermate", () => {
    const inputs = inputsOf(sampleLog());
    const base = dietFor(inputs);
    const extended = dietFor({ ...inputs, dailyFrom: "2025-12-15" });
    expect(extended).not.toBe(base);
    expect(dietFor({ ...inputs })).toBe(base);
    expect(dietFor({ ...inputs, dailyFrom: "2025-12-15" })).toBe(extended);
    expect(buildDietHistory).toHaveBeenCalledTimes(2);
  });
});

describe("dietFor: un solo classificatore finché tabella, prodotti, correzioni e preparazioni restano gli stessi", () => {
  it("dopo una scrittura nel diario il classificatore è lo stesso; cambia con prodotti, correzioni, tabella o una preparazione nuova", () => {
    const log = sampleLog();
    dietFor(inputsOf(log));
    const builds = classifierBuildCount();
    const withMeal = sortEvents([...log, meal("m-next", `${TODAY}T12:30:00.000Z`, { mealId: "next", kind: "lunch", items: [{ name: "Pesca", quantity: q(120), certainty: "estimated" }] })]);
    dietFor(inputsOf(withMeal));
    const withWater = sortEvents([...withMeal, water("w2", `${TODAY}T09:00:00.000Z`, { ml: 200 })]);
    dietFor(inputsOf(withWater));
    expect(classifierBuildCount()).toBe(builds);

    dietFor(inputsOf(withWater, { products: new Map(PRODUCTS) }));
    expect(classifierBuildCount()).toBe(builds + 1);
    dietFor(inputsOf(withWater, { products: new Map(PRODUCTS), classOverrides: { "n:pesca": { processing: 1 } } }));
    expect(classifierBuildCount()).toBe(builds + 2);
    // un lotto di un ingrediente cambia nome: ciò che il classificatore ricorda delle preparazioni non vale più
    const renamed = sortEvents([...withWater, updateLot("u-pasta", `${TODAY}T10:00:00.000Z`, { lotId: "pasta", patch: { productRef: "Pasta integrale" } })]);
    dietFor(inputsOf(renamed, { products: new Map(PRODUCTS), classOverrides: { "n:pesca": { processing: 1 } } }));
    expect(classifierBuildCount()).toBe(builds + 3);
  });

  it("a ogni scrittura il risultato è identico a un calcolo da capo", () => {
    const rand = seededRandom(7);
    let log = sampleLog();
    let classOverrides: ClassOverrides = {};
    const products = new Map(PRODUCTS);
    const names = ["Mela", "Pesca", "Latte intero", "Yogurt greco 5%", "uova", "Ignoto x", "Patatine"];
    for (let i = 0; i < 40; i++) {
      const at = `2026-03-${String(10 + Math.floor(i / 10)).padStart(2, "0")}T${String(8 + (i % 10)).padStart(2, "0")}:00:00.000Z`;
      const r = rand();
      if (r < 0.4) log = [...log, meal(`m${i}`, at, { mealId: `meal${i}`, kind: "lunch", items: [{ name: names[i % names.length], quantity: q(100), certainty: "estimated" }] })];
      else if (r < 0.6) log = [...log, consume(`c${i}`, at, { lotId: ["snack", "sacco", "pollo"][i % 3], quantity: q(10) })];
      else if (r < 0.7) log = [...log, purchase(`p${i}`, at, { lotId: `lot${i}`, productRef: names[i % names.length], quantity: q(300), location: "frigo", ...(i % 2 ? { category: "legumes_dry" } : {}) })];
      else if (r < 0.8) log = [...log, updateLot(`u${i}`, at, { lotId: "sacco", patch: { productRef: i % 2 ? "Lenticchie" : "Sacchetto" } })];
      else if (r < 0.9) classOverrides = rand() < 0.5 ? { "n:mela": { group: "sweets", processing: 4 } } : {};
      else log = [...log, water(`w${i}`, at, { ml: 200 })];
      const events = freezeShared(sortEvents(log));
      const inputs = inputsOf(events, { classOverrides, products, today: "2026-03-14" });
      expect(dietFor(inputs).history).toStrictEqual(fresh(inputs));
    }
  });
});

describe("righe di Oggi: classi e segni dal lotto di ogni consumo", () => {
  it("il consumo prende il lotto da Lot.history: categoria del lotto e prodotto molto lavorato", () => {
    const inputs = inputsOf(sampleLog());
    const out = dietFor(inputs);
    const marks = out.dayMarks(DAY);
    expect(out.dayMarks(DAY)).toBe(marks);
    expect(marks.classOf.get("c-sacco")?.parts[0]).toMatchObject({ group: "legumes", basis: "category" });
    expect(marks.markOf.get("c-snack")).toMatchObject({ level: 4, fromPrep: false });
    expect(marks.markOf.has("c-sacco")).toBe(false);
    expect(marks.classOf.get("c-prep")?.parts.every((p) => p.prepId === "pasta-pollo")).toBe(true);
    expect(marks.classOf.get("m-lunch#0")).toBeDefined();
    expect(out.dayMarks("2020-01-01").classOf.size).toBe(0);
  });

  it("una correzione per codice cambia la classe della riga", () => {
    const inputs = inputsOf(sampleLog(), { classOverrides: { [`b:${SNACK.barcode}`]: { processing: 3 } } });
    const marks = dietFor(inputs).dayMarks(DAY);
    expect(marks.markOf.has("c-snack")).toBe(false);
    expect(marks.classOf.get("c-snack")?.parts[0].processing?.basis).toBe("user");
  });

  it("le correzioni manuali degli alimenti arrivano al classificatore", () => {
    const foodOverrides: FoodOverrides = {};
    const out = dietFor(inputsOf(sampleLog(), { foodOverrides }));
    expect(out.history.weeks.at(-1)?.daysWithData).toBeGreaterThan(0);
  });
});

describe("adviceFor: la memoria dei consigli", () => {
  const record = (key: string, eventId: string): ConfirmationRecord => ({
    key,
    ingredient: key,
    allergens: ["latte"],
    excludedFoods: [],
    confirmedAt: "2026-03-01T10:00:00.000Z",
    eventId,
    eventIds: [eventId],
    deviceId: "dev-a",
  });
  const mapOf = (...records: ConfirmationRecord[]): ConfirmationMap => new Map(records.map((r) => [r.key, r]));

  function adviceInputs(over: Partial<AdviceInputs> = {}): AdviceInputs {
    const inputs = inputsOf(sampleLog());
    return {
      diet: dietFor(inputs),
      intake: inputs.intake,
      events: inputs.events,
      products: inputs.products,
      level: 2000,
      today: TODAY,
      now: `${TODAY}T10:00:00.000Z`,
      declared: { allergens: ["latte"], excludedFoods: [] },
      declaredComplete: true,
      manual: [],
      dismissed: [],
      ...over,
    };
  }

  it("mappe di conferme nuove con lo stesso contenuto (un gancio per consumatore): un calcolo solo", () => {
    const base = adviceInputs({ confirmations: mapOf(record("a", "e1"), record("b", "e2")) });
    const first = adviceFor(base);
    expect(adviceFor({ ...base, confirmations: mapOf(record("b", "e2"), record("a", "e1")) })).toBe(first);
    expect(adviceFor({ ...base, confirmations: mapOf(record("a", "e1"), record("b", "e2")) })).toBe(first);
  });

  it("una conferma data o ritirata ricalcola", () => {
    const base = adviceInputs({ confirmations: mapOf(record("a", "e1")) });
    const first = adviceFor(base);
    const more = adviceFor({ ...base, confirmations: mapOf(record("a", "e1"), record("b", "e2")) });
    expect(more).not.toBe(first);
    expect(adviceFor({ ...base, confirmations: mapOf(record("a", "e3")) })).not.toBe(more);
    expect(adviceFor({ ...base, confirmations: undefined })).not.toBe(first);
  });

  it("dichiarazioni non lette per intero ricalcolano", () => {
    const base = adviceInputs();
    const first = adviceFor(base);
    expect(adviceFor({ ...base, declaredComplete: false })).not.toBe(first);
  });
});
