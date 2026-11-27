import { describe, expect, it } from "vitest";
import { buildAdvice, targetFor, type ClassPart, type Classifier, type PlannedDiet } from "@/core/diet";
import { CURRENT, TODAY, history, input } from "@/core/diet/advice/test-helpers";
import { fakeDay, foodLine, part } from "@/core/diet/test-helpers";
import { meal } from "@/core/diary/test-helpers";
import { derivePantry, type Lot } from "@/core/ledger";
import { food as planFood, recipe as planRecipe, weekEv } from "@/core/plan/test-helpers";
import { derivedOf } from "@/data";
import { purchase, q } from "@/core/ledger/test-helpers";
import type { IntakeLine } from "@/core/nutrition";
import { withNutrients } from "@/core/quality/test-helpers";
import type { Product } from "@/core/catalog";
import type { Recipe } from "@/core/recipes";
import {
  dietGaps,
  knownAlternatives,
  knownRecipes,
  lineMarkOf,
  pantryFoods,
  plannedEntriesFrom,
  productIsClear,
  recentProductShares,
  recipeIsClear,
  shoppingNames,
} from "./inputs";

const NOW = "2026-11-25T10:00:00.000Z";

/** Classificatore dei nomi finto: per nome, altrimenti «non riconosciuto». */
function nameClassifier(groups: Record<string, ClassPart["group"]>): Pick<Classifier, "name"> {
  return { name: (n) => part(groups[n] ?? "unknown", { basis: groups[n] ? "name" : "none", certainty: "estimated", label: n }) };
}

function lots(...specs: { id: string; name: string; category?: string; expiry?: string; grams?: number }[]): Lot[] {
  return derivePantry(
    specs.map((s) =>
      purchase(`p-${s.id}`, "2026-11-20T08:00:00.000Z", {
        lotId: s.id,
        productRef: s.name,
        quantity: q(s.grams ?? 500),
        location: "dispensa",
        ...(s.category ? { category: s.category } : {}),
        ...(s.expiry ? { expiry: { date: s.expiry, kind: "best_before" as const } } : {}),
      }),
    ),
  ).lots;
}

describe("lineMarkOf: il segno solo per ciò che è molto lavorato", () => {
  it("una voce con NOVA 4 sì, con NOVA 3 no", () => {
    expect(lineMarkOf({ parts: [part("sweets", { processing: { level: 4, certainty: "label", basis: "product" } })] })).toEqual({ level: 4, certainty: "label", fromPrep: false });
    expect(lineMarkOf({ parts: [part("cheese", { processing: { level: 3, certainty: "estimated", basis: "declared" } })] })).toBeUndefined();
    expect(lineMarkOf({ parts: [part("legumes")] })).toBeUndefined();
    expect(lineMarkOf({ parts: [] })).toBeUndefined();
  });

  it("una preparazione solo se almeno metà dell'energia è molto lavorata, sempre come stima", () => {
    const p4 = (kcal: number) => part("processedMeat", { prepId: "x", basis: "prep", energyKcal: kcal, processing: { level: 4, certainty: "label", basis: "product" } });
    const p1 = (kcal: number) => part("legumes", { prepId: "x", basis: "prep", energyKcal: kcal, processing: { level: 1, certainty: "estimated", basis: "declared" } });
    expect(lineMarkOf({ parts: [p4(300), p1(200)] })).toEqual({ level: 4, certainty: "estimated", fromPrep: true });
    expect(lineMarkOf({ parts: [p4(200), p1(300)] })).toBeUndefined();
    expect(lineMarkOf({ parts: [part("legumes", { prepId: "x", basis: "prep" })] })).toBeUndefined();
  });
});

describe("pantryFoods", () => {
  it("lotti dello stesso alimento sono uno, con la scadenza più vicina; il gruppo dal nome o dalla categoria", () => {
    const all = lots(
      { id: "c1", name: "Ceci", expiry: "2026-12-10" },
      { id: "c2", name: "ceci", expiry: "2026-11-28" },
      { id: "m", name: "Sacchetto misterioso", category: "legumes_dry" },
      { id: "x", name: "Boh" },
      { id: "old", name: "Lenticchie", expiry: "2026-11-01" },
      { id: "batch", name: "Pasta e ceci" },
    );
    const out = pantryFoods(all, nameClassifier({ Ceci: "legumes", ceci: "legumes", Lenticchie: "legumes", "Pasta e ceci": "legumes" }), NOW, {
      preps: new Map([["batch", {}]]),
    });
    const ceci = out.find((f) => f.group === "legumes" && f.name.toLowerCase() === "ceci");
    expect(ceci).toMatchObject({ lotIds: ["c1", "c2"], expiresOn: "2026-11-28", certainty: "estimated" });
    // la categoria del lotto, quando il nome non dice niente
    expect(out.some((f) => f.lotIds.includes("m") && f.group === "legumes")).toBe(true);
    // non riconosciuto, scaduto, lotto di porzioni: fuori
    expect(out.some((f) => f.lotIds.includes("x"))).toBe(false);
    expect(out.some((f) => f.lotIds.includes("old"))).toBe(false);
    expect(out.some((f) => f.lotIds.includes("batch"))).toBe(false);
  });
});

function recipe(id: string, ingredients: Recipe["ingredients"], extra: Partial<Recipe> = {}): Recipe {
  return {
    recipeId: id,
    title: `Ricetta ${id}`,
    servings: 2,
    ingredients,
    steps: [],
    equipment: [],
    tags: [],
    certainty: "label",
    updatedAt: "2026-11-01T00:00:00.000Z",
    createdAt: "2026-11-01T00:00:00.000Z",
    eventId: `ev-${id}`,
    ...extra,
  };
}

describe("knownRecipes: solo le ricette «clear», con lo stesso controllo del piano", () => {
  const classifier = nameClassifier({ lenticchie: "legumes", latte: "milkYogurt", salmone: "fish", pasta: "refinedGrains" });
  const facts = (r: Recipe) => ({ recipeId: r.recipeId, groups: r.recipeId === "vuota" ? [] : (["legumes"] as const), servingsByGroup: { legumes: 1 }, certainty: "estimated" as const });
  const recipes = [
    recipe("lenticchie", [{ name: "lenticchie", quantity: q(160) }, { name: "pasta", quantity: q(160) }]),
    recipe("besciamella", [{ name: "latte", quantity: q(500, "ml") }, { name: "lenticchie", quantity: q(100) }]),
    recipe("vuota", [{ name: "acqua", quantity: q(100, "ml") }]),
  ];

  it("allergeni ed esclusioni dichiarati tolgono la ricetta; senza dichiarazioni passano tutte; marcate clear", () => {
    const pantry = lots({ id: "l", name: "lenticchie", grams: 1000 });
    const none = knownRecipes({ recipes, declared: { allergens: [], excludedFoods: [] }, classifier, lots: pantry, factsOf: facts });
    expect(none.map((r) => r.recipeId)).toEqual(["lenticchie", "besciamella"]);
    expect(none.every((r) => r.clear === true)).toBe(true);
    const milk = knownRecipes({ recipes, declared: { allergens: ["latte"], excludedFoods: [] }, classifier, lots: pantry, factsOf: facts });
    expect(milk.map((r) => r.recipeId)).toEqual(["lenticchie"]);
    const excluded = knownRecipes({ recipes, declared: { allergens: [], excludedFoods: ["pasta"] }, classifier, lots: pantry, factsOf: facts });
    expect(excluded.map((r) => r.recipeId)).toEqual(["besciamella"]);
    expect(recipeIsClear(recipes[1], { declared: { allergens: ["latte"], excludedFoods: [] } })).toBe(false);
  });

  it("la quota in casa viene dal confronto con la dispensa", () => {
    const withLentils = knownRecipes({ recipes: [recipes[0]], declared: { allergens: [], excludedFoods: [] }, classifier, lots: lots({ id: "l", name: "lenticchie", grams: 1000 }), factsOf: facts });
    const empty = knownRecipes({ recipes: [recipes[0]], declared: { allergens: [], excludedFoods: [] }, classifier, lots: [], factsOf: facts });
    expect(withLentils[0].inHomeShare).toBeGreaterThan(empty[0].inHomeShare);
    expect(empty[0].inHomeShare).toBe(0);
  });

  it("una ricetta esclusa non arriva mai al motore", () => {
    const known = knownRecipes({ recipes, declared: { allergens: ["latte"], excludedFoods: [] }, classifier, lots: [], factsOf: facts });
    const h = history({ indicators: [{ id: "group:legumes", unit: "servingsPerWeek", lowerBound: false, certainty: "label", coverage: 0.9, status: "below", value: 0, target: { kind: "perWeek", min: 2, max: 4, row: "legumes", source: "crea-lg-2018", where: "t" } }] });
    const advice = buildAdvice(input(h, { recipes: known }));
    const ids = advice.advice.flatMap((a) => a.actions.flatMap((x) => ("recipeId" in x ? [x.recipeId] : [])));
    expect(ids).not.toContain("besciamella");
  });
});

const NO_DECLARED = { declared: { allergens: [], excludedFoods: [] }, complete: true };

describe("alternative tra i prodotti noti", () => {
  const CATS = ["snacks", "crisps"];
  const salty = withNutrients("8000000000001", { fat: 20, saturatedFat: 2, sugars: 1, salt: 2.5 }, { name: "Patatine", categories: CATS, nova: 4 });
  const lessSalt = withNutrients("8000000000002", { fat: 20, saturatedFat: 2, sugars: 1, salt: 0.6 }, { name: "Patatine poco sale", categories: CATS, nova: 4 });

  const productLine = (barcode: string, eventId: string): IntakeLine => ({
    ...(foodLine(eventId, barcode) as Extract<IntakeLine, { status: "ok" }>),
    composition: { name: barcode, ref: barcode, origin: "label", selection: "product" },
  });

  it("quota dei prodotti nelle voci recenti", () => {
    const days = [
      fakeDay("2026-11-24", { lines: [productLine("8000000000001", "a"), foodLine("b", "mela")] }),
      fakeDay("2026-11-25", { lines: [productLine("8000000000001", "c"), foodLine("d", "pera")] }),
      fakeDay("2026-09-01", { lines: [productLine("8000000000002", "old")] }),
    ];
    const shares = recentProductShares(days, TODAY);
    expect(shares.get("8000000000001")).toBe(0.5);
    expect(shares.has("8000000000002")).toBe(false);
  });

  it("un'alternativa migliore sul sale, presa solo dai candidati", () => {
    const shares = new Map([["8000000000001", 0.3]]);
    const alts = knownAlternatives([{ product: salty }, { product: lessSalt }], shares, NO_DECLARED);
    expect(alts).toContainEqual({ fromBarcode: "8000000000001", fromName: "Patatine", toBarcode: "8000000000002", toName: "Patatine poco sale", dimension: "salt", fromShare: 0.3 });
    expect(knownAlternatives([{ product: salty }], shares, NO_DECLARED)).toEqual([]);
    expect(knownAlternatives([{ product: salty }, { product: lessSalt }], new Map(), NO_DECLARED)).toEqual([]);
  });

  describe("allergeni ed esclusioni dichiarati", () => {
    const safe = (extra: Partial<Product>): Product => ({
      ...lessSalt,
      ingredientsText: "patate, olio di girasole, sale",
      ingredientsLang: "it",
      safetyFields: true,
      allergens: [],
      traces: [],
      ...extra,
    });
    const milk: Parameters<typeof knownAlternatives>[2] = { declared: { allergens: ["latte"], excludedFoods: [] }, complete: true };
    const shares = new Map([["8000000000001", 0.3]]);
    const proposed = (alt: Product, safety = milk) => knownAlternatives([{ product: salty }, { product: alt }], shares, safety).map((a) => a.toBarcode);

    it("una scheda completa senza corrispondenze si propone", () => {
      expect(proposed(safe({}))).toEqual(["8000000000002"]);
      expect(productIsClear(safe({}), milk)).toBe(true);
    });

    it("contiene, tracce, scheda senza allergeni noti o senza ingredienti: escluso", () => {
      expect(proposed(safe({ allergens: ["en:milk"] }))).toEqual([]);
      expect(proposed(safe({ traces: ["en:milk"] }))).toEqual([]);
      expect(proposed(safe({ ingredientsText: "patate, latte scremato in polvere" }))).toEqual([]);
      expect(proposed(safe({ safetyFields: undefined }))).toEqual([]);
      expect(proposed(safe({ ingredientsText: undefined }))).toEqual([]);
      expect(proposed(safe({ ingredientsLang: "en" }))).toEqual([]);
    });

    it("anche gli alimenti esclusi contano", () => {
      const noPotato = { declared: { allergens: [], excludedFoods: ["patate"] }, complete: true };
      expect(proposed(safe({}), noPotato)).toEqual([]);
    });

    it("dichiarazioni che non si leggono per intero: nessuna proposta, nemmeno senza voci", () => {
      expect(proposed(safe({}), { ...milk, complete: false })).toEqual([]);
      expect(proposed(safe({}), { declared: { allergens: [], excludedFoods: [] }, complete: false })).toEqual([]);
    });

    it("senza dichiarazioni, con il controllo completo, non cambia niente", () => {
      expect(proposed(lessSalt, NO_DECLARED)).toEqual(["8000000000002"]);
      expect(productIsClear(lessSalt, NO_DECLARED)).toBe(true);
    });

    it("il prodotto di partenza resta una fonte anche se contiene ciò che è dichiarato", () => {
      const withMilk = { ...salty, allergens: ["en:milk"] };
      const out = knownAlternatives([{ product: withMilk }, { product: safe({}) }], shares, milk);
      expect(out.map((a) => [a.fromBarcode, a.toBarcode])).toEqual([["8000000000001", "8000000000002"]]);
    });
  });
});

describe("spesa, piano e lacune", () => {
  it("nomi della lista normalizzati e senza doppioni", () => {
    expect(shoppingNames([{ product: "Lenticchie " }, { product: "lenticchie" }, { product: "Pàne" }, { product: "  " }])).toEqual(["lenticchie", "pane"]);
    expect(shoppingNames(undefined)).toEqual([]);
  });

  it("le voci del piano da oggi in poi", () => {
    const plan = {
      targets: [],
      weeks: [{ weekStart: CURRENT, eventId: "w", recordedAt: "", entries: [
        { date: "2026-11-23", meal: "lunch" as const, item: { kind: "food" as const, name: "ceci" } },
        { date: "2026-11-26", meal: "dinner" as const, item: { kind: "food" as const, name: "salmone" } },
      ] }],
      dayTypes: [],
      anomalies: [],
      voidedEventIds: [],
    };
    expect(plannedEntriesFrom(plan as never, CURRENT, TODAY).map((e) => e.date)).toEqual(["2026-11-26"]);
    expect(plannedEntriesFrom(undefined, CURRENT, TODAY)).toEqual([]);
  });

  describe("piano di oggi già mangiato, porzioni per l'utente", () => {
    const D = "2026-11-25";
    const events = [
      weekEv("w", "2026-11-23T08:00:00.000Z", CURRENT, [
        planFood(D, "lunch", "ceci", 100),
        planFood(D, "dinner", "salmone", 150),
        planRecipe(D, "dinner", "r1", 4),
        planFood("2026-11-26", "lunch", "ceci", 100),
        planRecipe("2026-11-26", "dinner", "r1", 0.5),
      ]),
      meal("m1", `${D}T11:00:00.000Z`, { mealId: "m1", kind: "lunch", items: [{ name: "ceci", quantity: q(100), certainty: "estimated" }] }),
    ] as never[];
    const derived = derivedOf(events);
    const eaten = { diary: derived.diary, adherence: { events } };

    it("senza il diario restano tutte le voci di oggi, ma le porzioni sono per una persona", () => {
      const out = plannedEntriesFrom(derived.plan, CURRENT, D);
      expect(out).toHaveLength(5);
      expect(out.filter((e) => e.item.kind === "recipe").map((e) => (e.item as { servings: number }).servings)).toEqual([1, 0.5]);
    });

    it("con il diario si tolgono le voci di oggi già mangiate, non quelle dei giorni dopo", () => {
      const out = plannedEntriesFrom(derived.plan, CURRENT, D, eaten);
      expect(out.map((e) => `${e.date} ${e.meal}`)).toEqual([`${D} dinner`, `${D} dinner`, "2026-11-26 lunch", "2026-11-26 dinner"]);
    });

    it("un piatto mangiato al posto di una voce pianificata la toglie; con una ricetta non espandibile nel pasto non si giudica", () => {
      const plan = (entries: Parameters<typeof weekEv>[3]) => [
        weekEv("w", "2026-11-23T08:00:00.000Z", CURRENT, entries),
        meal("m2", `${D}T19:00:00.000Z`, { mealId: "m2", kind: "dinner", items: [{ name: "pizza", quantity: q(300), certainty: "estimated" }] }),
      ] as never[];
      const run = (ev: never[]) => {
        const d = derivedOf(ev);
        return plannedEntriesFrom(d.plan, CURRENT, D, { diary: d.diary, adherence: { events: ev } }).filter((e) => e.date === D);
      };
      expect(run(plan([planFood(D, "dinner", "salmone", 150)]))).toEqual([]);
      expect(run(plan([planFood(D, "dinner", "salmone", 150), planRecipe(D, "dinner", "r1", 4)]))).toHaveLength(2);
    });

    it("non cambia il piano di partenza", () => {
      const before = JSON.stringify(derived.plan.weeks);
      plannedEntriesFrom(derived.plan, CURRENT, D, eaten);
      expect(JSON.stringify(derived.plan.weeks)).toBe(before);
    });
  });

  it("ciò che manca: indicazione minima meno mangiato meno nel piano", () => {
    const h = history({}, { current: { servings: { legumes: 1 } } });
    const current = h.weeks[h.weeks.length - 1];
    // nel quadro finto le righe seguono i gruppi
    (current.rowTallies as Record<string, { servings: number }>).legumes = { ...current.rowTallies.legumes, servings: 1 };
    const legumesMin = targetFor("legumes", 2000)?.min ?? 0;
    const none = dietGaps(h, undefined, 2000);
    expect(none.legumes).toBe(Math.ceil((legumesMin - 1) * 2) / 2);
    const planned: PlannedDiet = { weekStart: CURRENT, servingsByGroup: { legumes: 5 }, entriesByGroup: { legumes: 2 }, unresolved: 0 };
    expect(dietGaps(h, planned, 2000).legumes).toBeUndefined();
    // il piano di un'altra settimana non conta
    expect(dietGaps(h, { ...planned, weekStart: "2026-11-30" }, 2000).legumes).toBe(none.legumes);
    // senza settimana in corso, niente
    expect(dietGaps({ weeks: h.weeks.slice(0, -1) }, undefined, 2000)).toEqual({});
  });
});
