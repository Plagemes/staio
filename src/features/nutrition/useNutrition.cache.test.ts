import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/catalog";
import { drink, meal, untracked, water } from "@/core/diary/test-helpers";
import type { AnyEvent } from "@/core/events";
import { derivePantry, sortEvents } from "@/core/ledger";
import { consume, discard, purchase, q, seededRandom, shuffled, updateLot, voidOf } from "@/core/ledger/test-helpers";
import { computeIntake } from "@/core/nutrition";
import { FAKE_FOODS } from "@/core/nutrition/test-helpers";
import { composePrep, derivePreps, type PrepState } from "@/core/prep";
import { derivedOf, freezeShared } from "@/data";
import { markPrepPartials } from "./prepare";
import { barcodesOfLots, buildResolverWithInfo, type FoodOverrides } from "./resolver";
import { intakeFor, type IntakeInputs } from "./useNutrition";

/** Quante volte è stato interrogato il risolutore vero (quello di `resolver.ts`). */
const asked = vi.hoisted(() => ({ count: 0 }));

vi.mock("./resolver", async (original) => {
  const actual = await original<typeof import("./resolver")>();
  return {
    ...actual,
    buildResolverWithInfo: (inputs: Parameters<typeof actual.buildResolverWithInfo>[0]) => {
      const built = actual.buildResolverWithInfo(inputs);
      const resolve: typeof built.resolve = (subject) => {
        asked.count++;
        return built.resolve(subject);
      };
      return { ...built, resolve };
    },
  };
});

vi.mock("@/core/nutrition", async (original) => {
  const actual = await original<typeof import("@/core/nutrition")>();
  return { ...actual, computeIntake: vi.fn(actual.computeIntake) };
});

const PRODUCT: Product = {
  barcode: "8001234567890",
  name: "Yogurt della casa",
  nutrients: { per: "100g", certainty: "label", energyKcal: 80, proteins: 5, carbohydrates: 10, fat: 2 },
  fetchedAt: "2026-11-01T00:00:00.000Z",
  source: "openfoodfacts",
};

const DAY = "2026-03-10";

/** Dispensa con un prodotto letto dal codice, una preparazione (con un ingrediente che la tabella non conosce) e due pasti. */
function sampleLog(): AnyEvent[] {
  const base = [
    purchase("p-pollo", "2026-03-01T08:00:00.000Z", { lotId: "pollo", productRef: "Petto di pollo crudo", quantity: q(600), location: "frigo" }),
    purchase("p-pasta", "2026-03-01T08:00:00.000Z", { lotId: "pasta", productRef: "Pasta di semola secca", quantity: q(500), location: "dispensa" }),
    purchase("p-boh", "2026-03-01T08:00:00.000Z", { lotId: "boh", productRef: "Ingrediente ignoto", quantity: q(100), location: "dispensa" }),
    purchase("p-yogurt", "2026-03-01T08:00:00.000Z", { lotId: "yogurt", productRef: "Yogurt", barcode: PRODUCT.barcode, quantity: q(500), location: "frigo" }),
  ];
  const lots = Object.fromEntries(derivePantry(base).lots.map((l) => [l.lotId, l]));
  let n = 0;
  const composed = composePrep(
    {
      prepId: "pasta-pollo",
      title: "Pasta al pollo",
      portions: 4,
      location: "frigo",
      ingredients: [
        { lot: lots.pollo, quantity: q(400) },
        { lot: lots.pasta, quantity: q(320) },
        { lot: lots.boh, quantity: q(50) },
      ],
    },
    { deviceId: "dev-a", now: () => "2026-03-09T17:00:00.000Z", idGenerator: () => `prep-${String(++n).padStart(3, "0")}` },
  );
  if (!composed.ok) throw new Error(JSON.stringify(composed.errors));
  const events: AnyEvent[] = [...base, ...(composed.events as AnyEvent[])];
  const batchLotId = derivePreps(events).preps[0].batchLotId;
  return [
    ...events,
    meal("m-lunch", `${DAY}T12:30:00.000Z`, { mealId: "lunch", kind: "lunch", items: [{ name: "Mela", quantity: q(1, "pz"), certainty: "estimated" }] }),
    consume("c-prep", `${DAY}T12:30:00.000Z`, { lotId: batchLotId, quantity: q(1, "pz"), mealId: "lunch" }),
    meal("m-dinner", `${DAY}T19:30:00.000Z`, { mealId: "dinner", kind: "dinner" }),
    consume("c-yogurt", `${DAY}T19:30:00.000Z`, { lotId: "yogurt", quantity: q(125), mealId: "dinner" }),
    consume("c-pollo", `${DAY}T19:30:00.000Z`, { lotId: "pollo", quantity: q(150), mealId: "dinner" }),
    water("w1", `${DAY}T08:00:00.000Z`, { ml: 250 }),
  ];
}

/** Il calcolo com'era dentro `useIntake` prima della memoria condivisa. */
function intakeAsBefore(events: readonly AnyEvent[], foods: IntakeInputs["foods"], products: IntakeInputs["products"], overrides: FoodOverrides, prepsState: PrepState | undefined) {
  const preps = new Map((prepsState?.preps ?? []).map((p) => [p.batchLotId, p]));
  const { resolve, prepInfo } = buildResolverWithInfo({ foods, products, barcodes: barcodesOfLots(derivePantry(events).lots), overrides, preps });
  const raw = computeIntake(events, resolve);
  return { intake: { ...raw, days: markPrepPartials(raw.days, prepInfo) }, prepInfo };
}

function inputsOf(events: AnyEvent[]): IntakeInputs {
  return { events, foods: FAKE_FOODS, products: new Map([[PRODUCT.barcode, PRODUCT]]), overrides: {}, preps: derivePreps(events) };
}

describe("intakeFor", () => {
  beforeEach(() => {
    vi.mocked(computeIntake).mockClear();
  });

  it("tre richieste con gli stessi ingressi (i tre di Oggi): un calcolo solo, lo stesso risultato", () => {
    const inputs = inputsOf(sortEvents(sampleLog()));
    const first = intakeFor(inputs);
    // ogni schermata costruisce il suo oggetto di ingressi: conta ciò che c'è dentro
    expect(intakeFor({ ...inputs })).toBe(first);
    expect(intakeFor({ ...inputs, overrides: {} })).toBe(first);
    expect(computeIntake).toHaveBeenCalledTimes(1);
    expect(first.intake.days.length).toBeGreaterThan(0);
  });

  it("un ingresso cambiato ricalcola, una volta", () => {
    const inputs = inputsOf(sortEvents(sampleLog()));
    let last = intakeFor(inputs);
    let calls = 1;
    const changed: IntakeInputs[] = [
      { ...inputs, events: [...inputs.events] },
      { ...inputs, foods: [...inputs.foods] },
      { ...inputs, products: new Map(inputs.products) },
      { ...inputs, preps: derivePreps(inputs.events) },
      { ...inputs, preps: undefined },
      { ...inputs, overrides: { mela: "pesca" } },
    ];
    for (const next of changed) {
      const out = intakeFor(next);
      expect(out).not.toBe(last);
      expect(intakeFor({ ...next })).toBe(out);
      expect(computeIntake).toHaveBeenCalledTimes(++calls);
      last = out;
    }
  });

  it("le scelte manuali contano per il contenuto: un oggetto nuovo con le stesse scelte non ricalcola", () => {
    const inputs = { ...inputsOf(sortEvents(sampleLog())), overrides: { mela: "pesca" } };
    const first = intakeFor(inputs);
    expect(intakeFor({ ...inputs, overrides: { mela: "pesca" } })).toBe(first);
    expect(computeIntake).toHaveBeenCalledTimes(1);
    // cambiata una scelta: di nuovo, una volta
    const changed = intakeFor({ ...inputs, overrides: { mela: "mela" } });
    expect(intakeFor({ ...inputs, overrides: { mela: "mela" } })).toBe(changed);
    expect(computeIntake).toHaveBeenCalledTimes(2);
    expect(changed).not.toBe(first);
  });

  it("il risultato è uguale a quello del calcolo di prima sugli stessi dati", () => {
    const log = sampleLog();
    for (const events of [sortEvents(log), log, [] as AnyEvent[]]) {
      for (const overrides of [{}, { mela: "pesca" }] as FoodOverrides[]) {
        for (const preps of [derivePreps(events), undefined]) {
          const inputs: IntakeInputs = { events, foods: FAKE_FOODS, products: new Map([[PRODUCT.barcode, PRODUCT]]), overrides, preps };
          const expected = intakeAsBefore(events, inputs.foods, inputs.products, overrides, preps);
          const actual = intakeFor(inputs);
          expect(actual.intake).toEqual(expected.intake);
          expect([...actual.prepInfo]).toEqual([...expected.prepInfo]);
        }
      }
    }
    // con gli ingressi congelati, come arrivano dai ganci in sviluppo: il calcolo non li tocca
    const frozen = freezeShared(sortEvents(sampleLog()));
    const shared: IntakeInputs = { events: frozen, foods: FAKE_FOODS, products: freezeShared(new Map([[PRODUCT.barcode, PRODUCT]])), overrides: {}, preps: derivedOf(frozen).preps };
    expect(intakeFor(shared).intake).toEqual(intakeAsBefore(sortEvents(log), FAKE_FOODS, shared.products, {}, derivePreps(log)).intake);

    // i dati di prova passano davvero dalla preparazione, dal prodotto e dalla tabella
    const full = intakeFor(inputsOf(sortEvents(log)));
    expect(full.prepInfo.size).toBe(1);
    expect([...full.prepInfo.values()][0].partial.length).toBeGreaterThan(0);
    expect(full.intake.days[0].totals.energyKcal?.value).toBeGreaterThan(0);
  });

  it("in sviluppo il risultato, condiviso tra le schermate, è congelato", () => {
    const out = intakeFor(inputsOf(sortEvents(sampleLog())));
    expect(() => (out.intake.days as unknown[]).push(out.intake.days[0])).toThrow(TypeError);
    expect(() => (out.prepInfo as Map<string, unknown>).clear()).toThrow(TypeError);
    expect(out.prepInfo.size).toBe(1);
  });
});

describe("intakeFor: le risposte del risolutore ricordate da una scrittura all'altra", () => {
  const products = new Map([[PRODUCT.barcode, PRODUCT]]);
  const OTHER: Product = { ...PRODUCT, name: "Yogurt nuovo", nutrients: { per: "100g", certainty: "label", energyKcal: 200, proteins: 1 } };

  /** Lo stesso calcolo, contando quante volte si interroga il risolutore vero. */
  function run(events: AnyEvent[], over: Partial<IntakeInputs> = {}) {
    const inputs: IntakeInputs = { events, foods: FAKE_FOODS, products, overrides: {}, preps: derivePreps(events), ...over };
    const before = asked.count;
    const actual = intakeFor(inputs);
    const calls = asked.count - before;
    const expected = intakeAsBefore(events, inputs.foods, inputs.products, inputs.overrides, inputs.preps);
    expect(actual.intake).toEqual(expected.intake);
    expect([...actual.prepInfo]).toEqual([...expected.prepInfo]);
    return { calls, lines: actual.intake.days.flatMap((d) => d.meals.flatMap((m) => m.lines)) };
  }

  it("dopo una scrittura il risolutore si interroga solo per le voci nuove, e il risultato è quello di un calcolo da capo", () => {
    const first = sortEvents(sampleLog());
    const cold = run(first);
    expect(cold.calls).toBeGreaterThan(2);

    // un tè: nessuna voce nuova da riconoscere, solo la porzione della preparazione (che passa sempre dal risolutore)
    const withDrink = sortEvents([...first, water("w2", `${DAY}T09:00:00.000Z`, { ml: 200 })]);
    expect(run(withDrink).calls).toBe(1);

    // un pasto con una voce libera nuova e un consumo di un lotto già visto
    const withMeal = sortEvents([
      ...withDrink,
      meal("m-next", "2026-03-11T12:30:00.000Z", { mealId: "next", kind: "lunch", items: [{ name: "Pesca", quantity: q(120), certainty: "estimated" }] }),
      consume("c-next", "2026-03-11T12:30:00.000Z", { lotId: "pollo", quantity: q(100), mealId: "next" }),
    ]);
    const warm = run(withMeal);
    expect(warm.calls).toBeLessThan(cold.calls);
    expect(warm.lines.some((l) => l.label === "Pesca" && l.status === "ok")).toBe(true);
  });

  it("ciò che cambia per un lotto (codice a barre, nome, preparazione annullata) non resta quello di prima", () => {
    const first = sortEvents(sampleLog());
    run(first);

    // il pollo riceve il codice di un prodotto conosciuto: da qui vale l'etichetta
    const withBarcode = sortEvents([...first, updateLot("u-code", "2026-03-12T08:00:00.000Z", { lotId: "pollo", patch: { barcode: PRODUCT.barcode } })]);
    const labelled = run(withBarcode);
    expect(labelled.lines.find((l) => l.eventId === "c-pollo")).toMatchObject({ status: "ok", composition: { origin: "label" } });

    // il codice se ne va e il nome cambia
    const renamed = sortEvents([...withBarcode, updateLot("u-name", "2026-03-13T08:00:00.000Z", { lotId: "pollo", patch: { barcode: null, productRef: "Mela" } })]);
    expect(run(renamed).lines.find((l) => l.eventId === "c-pollo")).toMatchObject({ status: "ok", composition: { name: "Mela" } });

    // la preparazione annullata: il suo lotto di porzioni non c'è più
    const prepEvent = first.find((e) => e.type === "prep")!;
    const withoutPrep = sortEvents([...renamed, voidOf("v-prep", "2026-03-14T08:00:00.000Z", prepEvent.id)]);
    expect(run(withoutPrep).lines.length).toBeGreaterThan(0);
    // e torna: annullato l'annullamento
    run(sortEvents([...withoutPrep, voidOf("v-back", "2026-03-15T08:00:00.000Z", "v-prep")]));
  });

  it("tabella, prodotti o scelte manuali diversi: niente di ricordato vale più", () => {
    const events = sortEvents(sampleLog());
    // una mappa dei prodotti mai vista: si parte da zero
    const mine = new Map(products);
    const cold = run(events, { products: mine }).calls;
    expect(run([...events], { products: mine }).calls).toBeLessThan(cold);
    expect(run([...events], { products: mine, overrides: { mela: "pesca" } }).calls).toBe(cold);
    expect(run([...events], { products: new Map([[OTHER.barcode, OTHER]]) }).calls).toBe(cold);
    expect(run([...events], { foods: [...FAKE_FOODS] }).calls).toBe(cold);
    // i valori dell'etichetta nuova sono arrivati nel risultato
    const yogurt = intakeFor({ events, foods: FAKE_FOODS, products: new Map([[OTHER.barcode, OTHER]]), overrides: {}, preps: derivePreps(events) })
      .intake.days.flatMap((d) => d.meals.flatMap((m) => m.lines))
      .find((l) => l.eventId === "c-yogurt");
    expect(yogurt).toMatchObject({ status: "ok", nutrients: { energyKcal: 250 } });
  });
});

describe("intakeFor: voci uguali, una domanda sola", () => {
  it("due confezioni dello stesso prodotto si riconoscono una volta; con un codice a barre diverso sono due domande", () => {
    const products = new Map([[PRODUCT.barcode, PRODUCT]]);
    const at = "2026-04-01T08:00:00.000Z";
    const events = sortEvents([
      purchase("p1", at, { lotId: "mela-1", productRef: "Mela", quantity: q(300), location: "frigo" }),
      purchase("p2", at, { lotId: "mela-2", productRef: "Mela", quantity: q(300), location: "frigo" }),
      // stesso nome, ma con il codice di un prodotto conosciuto: vale l'etichetta
      purchase("p3", at, { lotId: "mela-3", productRef: "Mela", barcode: PRODUCT.barcode, quantity: q(300), location: "frigo" }),
      meal("m1", "2026-04-02T12:00:00.000Z", { mealId: "m1", kind: "lunch", items: [{ name: "Pesca", quantity: q(100), certainty: "estimated" }] }),
      meal("m2", "2026-04-03T12:00:00.000Z", { mealId: "m2", kind: "lunch", items: [{ name: "Pesca", quantity: q(150), certainty: "estimated" }] }),
      consume("c1", "2026-04-02T12:00:00.000Z", { lotId: "mela-1", quantity: q(100), mealId: "m1" }),
      consume("c2", "2026-04-02T12:00:00.000Z", { lotId: "mela-2", quantity: q(100), mealId: "m1" }),
      consume("c3", "2026-04-03T12:00:00.000Z", { lotId: "mela-3", quantity: q(100), mealId: "m2" }),
      consume("c4", "2026-04-03T12:00:00.000Z", { lotId: "mela-1", quantity: q(50), mealId: "m2" }),
    ]);
    const inputs: IntakeInputs = { events, foods: FAKE_FOODS, products, overrides: {}, preps: derivePreps(events) };
    const before = asked.count;
    const actual = intakeFor(inputs);
    // mela senza codice, mela con il codice, pesca: tre domande per sei voci
    expect(asked.count - before).toBe(3);
    const expected = intakeAsBefore(events, inputs.foods, inputs.products, inputs.overrides, inputs.preps);
    expect(actual.intake).toEqual(expected.intake);
    const lines = actual.intake.days.flatMap((d) => d.meals.flatMap((m) => m.lines));
    expect(lines.find((l) => l.eventId === "c1")).toMatchObject({ status: "ok", composition: { name: "Mela" } });
    expect(lines.find((l) => l.eventId === "c3")).toMatchObject({ status: "ok", composition: { origin: "label" } });
    expect(lines.filter((l) => l.status === "ok")).toHaveLength(6);
  });
});

describe("intakeFor: diario e dispensa presi dallo stato condiviso", () => {
  const B1 = PRODUCT.barcode;
  const B2 = "8009999999999";
  const product = (barcode: string, kcal: number | undefined): Product => ({
    barcode,
    name: `Prodotto ${barcode}`,
    ...(kcal === undefined ? {} : { nutrients: { per: "100g", certainty: "label", energyKcal: kcal, proteins: 3 } }),
    fetchedAt: "2026-11-01T00:00:00.000Z",
    source: "openfoodfacts",
  });
  const NAMES = ["Mela", "Pesca", "Petto di pollo crudo", "Pasta di semola secca", "Latte intero", "Ignoto x", "Yogurt greco 5%", "uova"];
  const pick = <T,>(rand: () => number, list: readonly T[]): T => list[Math.floor(rand() * list.length)];

  /** Una scrittura a caso: spesa (con e senza scheda), consumo, pasto, nuova versione di un pasto, annullamento, correzione di un lotto… */
  function step(rand: () => number, log: readonly AnyEvent[], i: number): AnyEvent {
    const at = `2026-03-${String(Math.min(10 + Math.floor(i / 6), 28)).padStart(2, "0")}T${String(7 + (i % 12)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}:00.000Z`;
    const deviceId = rand() < 0.3 ? "dev-b" : "dev-a";
    const lots = derivePantry(log).lots.filter((l) => l.status === "active");
    const meals = log.filter((e): e is Extract<AnyEvent, { type: "meal" }> => e.type === "meal");
    const r = rand();
    const id = `e${i}`;
    const outOfHome = () => ({ name: "Pranzo fuori", quantity: q(1, "pz"), certainty: "estimated" as const, energyKcal: Math.floor(rand() * 900) });
    if (r < 0.15) {
      const barcode = rand() < 0.3 ? B1 : rand() < 0.5 ? B2 : undefined;
      return purchase(id, at, { lotId: `lot${i}`, productRef: pick(rand, NAMES), quantity: q(500), location: "frigo", ...(barcode ? { barcode } : {}), deviceId });
    }
    if (r < 0.35 && lots.length > 0) {
      const lot = pick(rand, lots);
      const m = meals.length > 0 && rand() < 0.6 ? pick(rand, meals) : undefined;
      return consume(id, at, { lotId: lot.lotId, quantity: q(lot.unit === "pz" ? 1 : 50, lot.unit), ...(m ? { mealId: m.mealId } : {}), deviceId });
    }
    if (r < 0.5) {
      const items = [{ name: pick(rand, NAMES), quantity: q(100), certainty: "estimated" as const }, ...(rand() < 0.2 ? [outOfHome()] : [])];
      return meal(id, at, { mealId: `meal${i}`, kind: pick(rand, ["breakfast", "lunch", "dinner", "snack"] as const), items, deviceId });
    }
    if (r < 0.62 && meals.length > 0) {
      // un'altra versione dello stesso pasto: un alimento scelto a mano, «Fuori casa», un'altra voce
      const m = pick(rand, meals);
      const k = rand();
      const items =
        k < 0.33
          ? [{ name: "Ignoto x", quantity: q(100), certainty: "estimated" as const, foodId: "mela" }]
          : k < 0.66
            ? [outOfHome()]
            : [{ name: pick(rand, NAMES), quantity: q(150), certainty: "measured" as const }];
      return meal(id, at, { mealId: m.mealId, kind: m.kind, items, deviceId });
    }
    if (r < 0.72 && log.length > 0) return voidOf(id, at, pick(rand, log).id, { deviceId });
    if (r < 0.8 && lots.length > 0) {
      const k = rand();
      const patch = k < 0.33 ? { barcode: B1 } : k < 0.66 ? { barcode: null } : { productRef: pick(rand, NAMES) };
      return updateLot(id, at, { lotId: pick(rand, lots).lotId, patch, deviceId });
    }
    if (r < 0.85 && lots.length > 0) {
      const lot = pick(rand, lots);
      return discard(id, at, { lotId: lot.lotId, quantity: q(lot.unit === "pz" ? 1 : 10, lot.unit), reason: "expired", deviceId });
    }
    if (r < 0.9) return untracked(id, at, { kind: "dinner", deviceId });
    if (r < 0.95) return drink(id, at, { name: "Tè", ml: 200, caffeineMg: 30, deviceId });
    return water(id, at, { ml: 250, deviceId });
  }

  beforeEach(() => {
    vi.mocked(computeIntake).mockClear();
  });

  it("passa a computeIntake il diario e la dispensa già calcolati per quello stato", () => {
    const events = freezeShared(sortEvents(sampleLog()));
    const derived = derivedOf(events);
    intakeFor({ events, foods: FAKE_FOODS, products: new Map([[PRODUCT.barcode, PRODUCT]]), overrides: {}, preps: derived.preps });
    expect(computeIntake).toHaveBeenCalledTimes(1);
    const [, , , given] = vi.mocked(computeIntake).mock.calls[0];
    expect(given?.diary).toBe(derived.diary);
    expect(given?.pantry).toBe(derived.pantry);
  });

  for (const seed of [1, 2, 3, 4, 5, 6]) {
    it(`registro a caso (seme ${seed}): dopo ogni scrittura il risultato è identico a quello calcolato da capo`, { timeout: 120_000 }, () => {
      const rand = seededRandom(seed);
      let log = sampleLog();
      let products = new Map([[B1, product(B1, 80)], [B2, product(B2, undefined)]]);
      let overrides: FoodOverrides = {};
      for (let i = 0; i < 160; i++) {
        log = [...log, step(rand, log, i)];
        // fuori dal registro: una scheda che arriva o cambia, una scelta manuale
        const x = rand();
        if (x < 0.05) products = new Map([...products, [B2, product(B2, Math.floor(rand() * 400))]]);
        else if (x < 0.08) products = new Map([...products, [B1, product(B1, Math.floor(rand() * 400))]]);
        else if (x < 0.11) overrides = rand() < 0.5 ? { ...overrides, "ignoto x": "pesca" } : {};
        const sorted = sortEvents(log);
        // come arriva dai ganci: un elenco nuovo e congelato, con le derivazioni condivise
        const shared = freezeShared(structuredClone(sorted));
        const got = intakeFor({ events: shared, foods: FAKE_FOODS, products, overrides, preps: derivedOf(shared).preps });
        const want = intakeAsBefore(sorted, FAKE_FOODS, products, overrides, derivePreps(sorted));
        expect(got.intake).toStrictEqual(want.intake);
        expect(got.prepInfo).toStrictEqual(want.prepInfo);
      }
      // l'ordine dell'archivio non conta
      const mixed = shuffled(log, rand);
      expect(intakeFor({ events: mixed, foods: FAKE_FOODS, products, overrides, preps: derivedOf(mixed).preps }).intake).toStrictEqual(
        intakeAsBefore(mixed, FAKE_FOODS, products, overrides, derivePreps(mixed)).intake,
      );
    });
  }
});

/** Circa 28 eventi al giorno: spesa settimanale, tre pasti con voci libere e consumi, ogni tanto «Fuori casa», bevande. */
function generateLog(days: number): AnyEvent[] {
  const out: AnyEvent[] = [];
  let n = 0;
  const id = () => `e${String(n++).padStart(7, "0")}`;
  const start = Date.parse("2026-01-01T00:00:00.000Z");
  const names = ["Mela", "Pesca", "Latte intero", "Yogurt greco 5%", "uova", "Pasta di semola secca", "Ignoto x"];
  const lots: { lotId: string; left: number }[] = [];
  for (let d = 0; d < days; d++) {
    const at = (hour: number, minute = 0) => new Date(start + d * 86_400_000 + hour * 3_600_000 + minute * 60_000).toISOString();
    if (d % 7 === 0) {
      for (let i = 0; i < 21; i++) {
        const lotId = `lot${d}-${i}`;
        out.push(purchase(id(), at(9, i), { lotId, productRef: names[i % names.length], quantity: q(180), location: "frigo", ...(i % 5 === 0 ? { barcode: PRODUCT.barcode } : {}) }));
        lots.push({ lotId, left: 180 });
      }
    }
    for (const [kind, hour] of [["breakfast", 7], ["lunch", 12], ["dinner", 19]] as const) {
      const mealId = `meal${d}-${kind}`;
      const items =
        kind === "lunch" && d % 4 === 0
          ? [{ name: "Pranzo fuori", quantity: q(1, "pz"), certainty: "estimated" as const, energyKcal: 700 }]
          : [{ name: names[(d + hour) % names.length], quantity: q(100), certainty: "estimated" as const }];
      out.push(meal(id(), at(hour, 5), { mealId, kind, items }));
      for (let i = 0; i < 2 && lots.length > 0; i++) {
        const lot = lots[0];
        out.push(consume(id(), at(hour, 5), { lotId: lot.lotId, quantity: q(60), mealId }));
        lot.left -= 60;
        lots.push(...lots.splice(0, 1).filter((l) => l.left > 0));
      }
    }
    for (let i = 0; i < 8; i++) out.push(water(id(), at(7 + i, 20), { ml: 200 }));
    out.push(drink(id(), at(7, 10), { name: "Caffè", ml: 40, caffeineMg: 60 }));
    out.push(drink(id(), at(15, 40), { name: "Tè", ml: 200, caffeineMg: 40 }));
    if (d % 3 === 0) out.push(voidOf(id(), at(21), out[out.length - 4].id));
  }
  return out;
}

describe("misura: nutrienti dopo un tocco (stampa i tempi, non fallisce per il tempo)", () => {
  /** Il calcolo dei nutrienti dopo una scrittura, con le derivazioni condivise già fatte dalle schermate. */
  async function measure(days: number) {
    const actual = await vi.importActual<typeof import("@/core/nutrition")>("@/core/nutrition");
    const products = new Map([[PRODUCT.barcode, PRODUCT]]);
    const base = sortEvents(generateLog(days));
    let taps = 0;
    const stateAfterTap = (): IntakeInputs => {
      const events = freezeShared(sortEvents([...base, drink(`tap-${taps++}`, "2031-01-01T10:00:00.000Z", { name: "Tè", ml: 200, caffeineMg: 30 })]));
      const derived = derivedOf(events);
      // ciò che le schermate di Oggi hanno già chiesto per questo stato
      void [derived.pantry, derived.diary, derived.preps];
      return { events, foods: FAKE_FOODS, products, overrides: {}, preps: derived.preps };
    };
    const time = (inputs: IntakeInputs) => {
      const start = performance.now();
      intakeFor(inputs);
      return Math.round(performance.now() - start);
    };
    // il primo calcolo riempie la memoria del risolutore: le misure sono tutte «a caldo», come dopo un tocco
    intakeFor(stateAfterTap());
    const asBefore = () => {
      const inputs = stateAfterTap();
      // computeIntake senza le derivazioni condivise: le rifà da sé, come prima
      vi.mocked(computeIntake).mockImplementationOnce((events, resolver, options) => actual.computeIntake(events, resolver, options));
      return time(inputs);
    };
    const asNow = () => time(stateAfterTap());
    const median = (run: () => number) => [run(), run(), run()].sort((a, b) => a - b)[1];
    const before = median(asBefore);
    const after = median(asNow);
    console.log(`[misura nutrienti] ${base.length} eventi · dopo un tocco, prima: ${before} ms · ora: ${after} ms`);
    return { events: base.length, before, after };
  }

  it("5.000 eventi", { timeout: 300_000 }, async () => {
    const result = await measure(224);
    expect(result.events).toBeGreaterThan(4500);
    expect(result.events).toBeLessThan(5500);
  });

  // dieci volte tanto: lungo, gira solo a richiesta (BENCH_50K=1). I tempi si leggono con `--silent=false`.
  it.runIf(process.env.BENCH_50K === "1")("50.000 eventi", { timeout: 600_000 }, async () => {
    expect((await measure(2240)).events).toBeGreaterThan(49_000);
  });
});
