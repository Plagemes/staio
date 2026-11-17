import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import type { AnyEvent } from "@/core/events";
import { compareWithReferences, computeIntake } from "@/core/nutrition";
import { FAKE_FOODS, fakeFood } from "@/core/nutrition/test-helpers";
import { REFERENCE_VALUES } from "@/core/nutrition/data/reference";
import type { ReferenceWithVariant } from "@/core/nutrition";
import { derivePantry, type Lot } from "@/core/ledger";
import { buildCaptureEvents } from "../capture";
import { buildMealEvents, buildUntrackedMeal } from "../meals";
import { createFoodSearch } from "./candidates";

/** Gli id dei candidati per un testo, in ordine. */
const idsFor = (foods: Parameters<typeof createFoodSearch>[0], query: string) =>
  createFoodSearch(foods).groups(query).flatMap((g) => g.options.map((o) => o.id));
import { NUTRITION_DISCLAIMER, NUTRITION_DISCLAIMER_SHORT, certaintyExplanation, formatNutrient, stateLabel } from "./labels";
import { buildNutritionRows, dayNutritionView, stateText, topContributors, unresolvedGroups } from "./prepare";
import { currentAge, isNutritionProfile, parseAge, toEngineProfile, variantChoices, withVariant } from "./profile";
import { barcodesOfLots, buildResolver, overrideKeyOf } from "./resolver";

const PRODUCT: Product = {
  barcode: "8001234567890",
  name: "Yogurt della casa",
  nutrients: { per: "100g", certainty: "label", energyKcal: 80, proteins: 5, carbohydrates: 10, fat: 2 },
  fetchedAt: "2026-11-01T00:00:00.000Z",
  source: "openfoodfacts",
};

const REFS = REFERENCE_VALUES as readonly ReferenceWithVariant[];
const at = (date: string, hour = 9) => `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`;

function free(date: string, hour: number, kind: "breakfast" | "lunch" | "dinner" | "snack", items: { name: string; quantityText: string }[]): AnyEvent[] {
  const r = buildMealEvents({ kind, picks: [], freeItems: items }, { now: at(date, hour), deviceId: "d" });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.events;
}

/** Un giorno completo con tre pasti di voci libere. */
function completeDay(date: string, extra: { name: string; quantityText: string }[] = []): AnyEvent[] {
  return [
    ...free(date, 7, "breakfast", [{ name: "Latte intero", quantityText: "200 ml" }]),
    ...free(date, 12, "lunch", [{ name: "Pasta di semola secca", quantityText: "80 g" }, ...extra]),
    ...free(date, 19, "dinner", [{ name: "Petto di pollo crudo", quantityText: "150 g" }]),
  ];
}

const resolverFor = (over: Partial<Parameters<typeof buildResolver>[0]> = {}) =>
  buildResolver({ foods: FAKE_FOODS, products: new Map(), barcodes: new Map(), overrides: {}, ...over });

const compositionOf = <T extends object | undefined>(r: T): Exclude<T, { failure: string }> | undefined => (r && "failure" in r ? undefined : (r as Exclude<T, { failure: string }>));

describe("risolutore", () => {
  it("un consumo di dispensa legato al codice a barre usa i valori d'etichetta", () => {
    const r = buildCaptureEvents(
      { name: "Yogurt della casa", quantityText: "125 g", location: "frigo", category: "yogurt", expiryKind: "none", expiryDate: "", priceText: "", alreadyHave: false, barcode: PRODUCT.barcode },
      { now: at("2026-11-10"), deviceId: "d" },
    );
    if (!r.ok) throw new Error("cattura");
    const lot = derivePantry(r.events.filter((e) => e.type === "purchase")).lots[0] as Lot;
    expect(lot.barcode).toBe(PRODUCT.barcode);
    const barcodes = barcodesOfLots([lot]);
    expect(barcodes.get(lot.lotId)).toBe(PRODUCT.barcode);

    const resolve = resolverFor({ products: new Map([[PRODUCT.barcode, PRODUCT]]), barcodes });
    const found = resolve({ kind: "pantry", productRef: lot.productRef, lotId: lot.lotId });
    expect(found).toMatchObject({ origin: "label", ref: PRODUCT.barcode });
  });

  it("senza prodotto si passa dalla tabella, con origine tabella", () => {
    const found = resolverFor()({ kind: "mealItem", name: "latte intero", mealId: "m" });
    expect(found).toMatchObject({ origin: "table", ref: "latte-intero" });
  });

  it("un nome sconosciuto non ha composizione; la scelta manuale ricordata la dà", () => {
    const subject = { kind: "mealItem", name: "Biscotti della nonna", mealId: "m" } as const;
    expect(resolverFor()(subject)).toBeUndefined();
    const overrides = { [overrideKeyOf("biscotti della nonna")]: "farina-00" };
    expect(resolverFor({ overrides })(subject)).toMatchObject({ ref: "farina-00", origin: "table" });
    // anche con maiuscole e articoli diversi, la scelta vale per quel nome
    expect(resolverFor({ overrides })({ kind: "mealItem", name: "BISCOTTI della nonna", mealId: "m" })).toBeDefined();
  });

  it("l'etichetta del prodotto vince sulla scelta manuale", () => {
    const events = buildCaptureEvents(
      { name: "Yogurt della casa", quantityText: "125 g", location: "frigo", category: "yogurt", expiryKind: "none", expiryDate: "", priceText: "", alreadyHave: false, barcode: PRODUCT.barcode },
      { now: at("2026-11-10"), deviceId: "d" },
    );
    if (!events.ok) throw new Error("cattura");
    const lot = derivePantry(events.events).lots[0] as Lot;
    const resolve = resolverFor({
      products: new Map([[PRODUCT.barcode, PRODUCT]]),
      barcodes: barcodesOfLots([lot]),
      overrides: { [overrideKeyOf(lot.productRef)]: "farina-00" },
    });
    expect(compositionOf(resolve({ kind: "pantry", productRef: lot.productRef, lotId: lot.lotId }))?.origin).toBe("label");
  });

  it("l'ingresso annullato non lega più il codice", () => {
    const r = buildCaptureEvents(
      { name: "X", quantityText: "1 pz", location: "frigo", category: "yogurt", expiryKind: "none", expiryDate: "", priceText: "", alreadyHave: false, barcode: PRODUCT.barcode },
      { now: at("2026-11-10"), deviceId: "d" },
    );
    if (!r.ok) throw new Error("cattura");
    const voided: AnyEvent = { id: "v", type: "void", at: at("2026-11-10"), recordedAt: at("2026-11-10"), deviceId: "d", schemaVersion: 1, certainty: "measured", source: "manual", targetEventId: r.events[0].id };
    expect(barcodesOfLots(derivePantry([...r.events, voided]).lots).size).toBe(0);
  });

  it("un testo nella nota non lega nessun prodotto: conta solo il campo barcode", () => {
    const r = buildCaptureEvents(
      { name: "Yogurt della casa", quantityText: "125 g", location: "frigo", category: "yogurt", expiryKind: "none", expiryDate: "", priceText: "", alreadyHave: false },
      { now: at("2026-11-10"), deviceId: "d" },
    );
    if (!r.ok) throw new Error("cattura");
    // un ingresso senza campo barcode ma con il codice scritto a parole nella nota
    const forged = { ...r.events[0], note: `Codice a barre ${PRODUCT.barcode}` } as AnyEvent;
    const lot = derivePantry([forged]).lots[0] as Lot;
    expect(lot.barcode).toBeUndefined();
    const resolve = resolverFor({ products: new Map([[PRODUCT.barcode, PRODUCT]]), barcodes: barcodesOfLots([lot]) });
    expect(compositionOf(resolve({ kind: "pantry", productRef: lot.productRef, lotId: lot.lotId }))?.origin).not.toBe("label");
  });
});

describe("nutrienti del giorno", () => {
  it("giorno completo: totali con certezza stima e nessun avviso di parzialità", () => {
    const intake = computeIntake(completeDay("2026-11-10"), resolverFor());
    const view = dayNutritionView(intake.days[0], "2026-11-10");
    expect(view.complete).toBe(true);
    expect(view.partialText).toBeUndefined();
    expect(view.coverageText).toBeUndefined();
    expect(view.energy).toMatchObject({ certainty: "estimated", partial: false });
    // 200 ml latte (60 kcal/100 ml) + 80 g pasta (350) + 150 g pollo (100) = 120 + 280 + 150
    expect(view.energy?.value).toBe(550);
    expect(view.energy?.text).toBe("550 kcal");
    expect(view.macros.map((m) => m.key)).toContain("proteinG");
  });

  it("voci non riconosciute: «calcolato su 4 voci di 6»", () => {
    const events = completeDay("2026-11-10", [
      { name: "Cibo misterioso", quantityText: "50 g" },
      { name: "Altro mistero", quantityText: "30 g" },
    ]);
    const view = dayNutritionView(computeIntake(events, resolverFor()).days[0], "2026-11-10");
    expect(view.total).toBe(5);
    expect(view.resolved).toBe(3);
    expect(view.coverageText).toBe("calcolato su 3 voci di 5");
  });

  it("giorno incompleto: totale parziale con il motivo", () => {
    const events = [...free("2026-11-10", 7, "breakfast", [{ name: "Latte intero", quantityText: "200 ml" }]), ...buildUntrackedMeal("lunch", { now: at("2026-11-10", 12), deviceId: "d" }).events];
    const view = dayNutritionView(computeIntake(events, resolverFor()).days[0], "2026-11-10");
    expect(view.complete).toBe(false);
    expect(view.partialText).toMatch(/^Totale parziale:/);
    expect(view.partialText).toMatch(/non tracciati/);
    expect(view.partialText).toMatch(/mancano .*cena/);
  });

  it("un giorno senza dati è vuoto, senza inventare zeri", () => {
    expect(dayNutritionView(undefined, "2026-11-10")).toMatchObject({ empty: true, macros: [] });
  });

  it("le certezze hanno parole", () => {
    expect(certaintyExplanation("label")).toMatch(/etichetta/);
    expect(certaintyExplanation("estimated")).toMatch(/Stima/);
    expect(formatNutrient("ironMg", 6.25)).toBe("6,3 mg");
  });
});

describe("confronto con i riferimenti", () => {
  const profile = toEngineProfile({ sex: "female", age: 40, savedOn: "2026-11-01", variants: {} }, "2026-11-16");

  function period(days: number): AnyEvent[] {
    const out: AnyEvent[] = [];
    for (let i = 0; i < days; i++) out.push(...completeDay(`2026-11-${String(10 + i).padStart(2, "0")}`));
    return out;
  }

  it("pochi giorni completi: dati insufficienti con quanti ne mancano", () => {
    const intake = computeIntake(period(2), resolverFor());
    const rows = buildNutritionRows(compareWithReferences(intake.days, REFS, profile), intake.days);
    expect(rows.compared).toEqual([]);
    const protein = rows.insufficient.find((r) => r.id === "proteinG:PRI") ?? rows.insufficient[0];
    expect(protein.headline).toBe("Dati insufficienti");
    expect(protein.detail).toMatch(/Servono almeno 5 giorni completi: ne hai 2, ne mancano 3/);
  });

  it("con dati sufficienti i confronti sono ordinati dal più lontano e mai chiamati carenza", () => {
    const intake = computeIntake(period(6), resolverFor());
    const rows = buildNutritionRows(compareWithReferences(intake.days, REFS, profile), intake.days);
    expect(rows.compared.length).toBeGreaterThan(0);
    const distances = rows.compared.map((r) => r.distance);
    expect([...distances].sort((a, b) => b - a)).toEqual(distances);
    for (const r of [...rows.compared, ...rows.notes, ...rows.insufficient]) {
      expect(`${r.headline} ${r.detail}`.toLowerCase()).not.toMatch(/carenza|deficit/);
    }
    const protein = rows.compared.find((r) => r.nutrient === "carbsG");
    expect(protein?.headline).toMatch(/dell'energia/);
  });

  it("dove il riferimento è solo una nota: assunzione e nota, nessuna soglia", () => {
    // un alimento con zuccheri, sale e grassi saturi, perché il motore risponda per quei nutrienti
    const snack = fakeFood("merenda-test", "Merenda test", { energyKcal: 400, sugarsG: 20, saltG: 1, saturatedFatG: 8 });
    const events: AnyEvent[] = [];
    for (let i = 0; i < 6; i++) events.push(...completeDay(`2026-11-${String(10 + i).padStart(2, "0")}`, [{ name: "Merenda test", quantityText: "50 g" }]));
    const intake = computeIntake(events, resolverFor({ foods: [...FAKE_FOODS, snack] }));
    const rows = buildNutritionRows(compareWithReferences(intake.days, REFS, profile), intake.days);
    const note = rows.notes.find((r) => r.nutrient === "saltG" || r.nutrient === "saturatedFatG" || r.nutrient === "sugarsG");
    expect(note).toBeDefined();
    expect(note?.headline).toMatch(/^Assunto:/);
    expect(note?.detail).toMatch(/solo una nota/);
    expect(note?.share).toBeUndefined();
    expect(note?.note).toBeTruthy();
  });


  it("la variante predefinita viene detta, con rimando al profilo", () => {
    const intake = computeIntake(period(6), resolverFor());
    const rows = buildNutritionRows(compareWithReferences(intake.days, REFS, profile), intake.days);
    const all = [...rows.compared, ...rows.notes, ...rows.insufficient];
    const iron = all.find((r) => r.id === "ironMg:PRI");
    expect(iron?.defaultVariantText).toMatch(/Variante predefinita/);
    expect(iron?.defaultVariantText).toMatch(/profilo/);
  });

  it("gli alimenti che contribuiscono di più a un nutriente", () => {
    const intake = computeIntake(period(5), resolverFor());
    const top = topContributors(intake.days, "proteinG");
    expect(top[0].name).toBe("Petto di pollo crudo");
    expect(top.reduce((s, c) => s + c.share, 0)).toBeCloseTo(1, 5);
    expect(top[0].share).toBeGreaterThan(top[top.length - 1].share);
  });

  it("voci non riconosciute raggruppate per nome", () => {
    const events = [
      ...completeDay("2026-11-10", [{ name: "Cibo misterioso", quantityText: "50 g" }]),
      ...completeDay("2026-11-11", [{ name: "cibo misterioso", quantityText: "20 g" }, { name: "Altro", quantityText: "10 g" }]),
    ];
    const groups = unresolvedGroups(computeIntake(events, resolverFor()).days);
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ["Cibo misterioso", 2],
      ["Altro", 1],
    ]);
    expect(groups[0].lastDate).toBe("2026-11-11");
  });
});

describe("profilo", () => {
  it("età: solo adulti", () => {
    expect(parseAge("42")).toEqual({ ok: true, value: 42 });
    expect(parseAge("17").ok).toBe(false);
    expect(parseAge("abc").ok).toBe(false);
    expect(parseAge("200").ok).toBe(false);
  });

  it("l'età invecchia da sola", () => {
    expect(currentAge({ age: 40, savedOn: "2025-11-16" }, "2026-11-16")).toBe(41);
    expect(currentAge({ age: 40, savedOn: "2026-11-01" }, "2026-11-16")).toBe(40);
  });

  it("riconosce un profilo valido", () => {
    expect(isNutritionProfile({ sex: "female", age: 40, savedOn: "2026-11-01", variants: {} })).toBe(true);
    expect(isNutritionProfile({ sex: "x", age: 40, savedOn: "2026-11-01", variants: {} })).toBe(false);
    expect(isNutritionProfile(null)).toBe(false);
  });

  it("le varianti compaiono solo dove esistono per quel profilo, prese dai dati", () => {
    const woman = variantChoices(REFS, { sex: "female", ageYears: 40 });
    const man = variantChoices(REFS, { sex: "male", ageYears: 40 });
    expect(woman.map((c) => c.key)).toContain("ironMg:PRI");
    expect(man.map((c) => c.key)).not.toContain("ironMg:PRI");
    expect(man.map((c) => c.key)).toContain("zincMg:PRI");
    const iron = woman.find((c) => c.key === "ironMg:PRI");
    expect(iron?.options.map((o) => o.variant).sort()).toEqual(["postmenopausal", "premenopausal"]);
    expect(iron?.how).toBe("default");
  });

  it("scegliere una variante la applica; toglierla torna alla predefinita", () => {
    const base = { sex: "female" as const, age: 40, savedOn: "2026-11-01", variants: {} };
    const chosen = withVariant(base, "ironMg:PRI", "postmenopausal");
    const choice = variantChoices(REFS, toEngineProfile(chosen, "2026-11-16")).find((c) => c.key === "ironMg:PRI");
    expect(choice).toMatchObject({ how: "chosen", applied: "postmenopausal" });
    expect(withVariant(chosen, "ironMg:PRI", null).variants).toEqual({});
  });
});

describe("ricerca a mano nella tabella", () => {
  it("trova per parole e inizi di parola", () => {
    expect(idsFor(FAKE_FOODS, "latte")).toEqual(expect.arrayContaining(["latte-intero", "latte-scremato"]));
    expect(idsFor(FAKE_FOODS, "pasta")[0]).toBe("pasta-secca");
    expect(idsFor(FAKE_FOODS, "farina 00")).toContain("farina-00");
  });

  it("niente risultati per testo troppo corto o senza corrispondenze", () => {
    expect(idsFor(FAKE_FOODS, "")).toEqual([]);
    expect(idsFor(FAKE_FOODS, "x")).toEqual([]);
    expect(idsFor(FAKE_FOODS, "zzzz")).toEqual([]);
  });
});

describe("stato crudo o cotto", () => {
  const pastaFoods = [
    fakeFood("pasta-secca", "Pasta di semola, secca", { energyKcal: 350, proteinG: 12 }, { state: "dried", variantOf: "pasta-semola", aliases: ["pasta"] }),
    fakeFood("pasta-cotta", "Pasta di semola, cotta", { energyKcal: 150, proteinG: 5 }, { state: "cooked", variantOf: "pasta-semola", aliases: ["pasta"] }),
  ];
  const withPasta = (extra: { name: string; quantityText: string }[]) => [
    ...free("2026-11-10", 7, "breakfast", [{ name: "Latte intero", quantityText: "200 ml" }]),
    ...free("2026-11-10", 12, "lunch", extra),
    ...free("2026-11-10", 19, "dinner", [{ name: "Petto di pollo crudo", quantityText: "150 g" }]),
  ];

  it("la frase dice lo stato assunto", () => {
    expect(stateText("Pasta cotta", "cooked", { preferred: ["cooked"], honored: true })).toBe("Calcolato come «Pasta cotta» (cotto).");
    expect(stateText("Pasta", undefined)).toBeUndefined();
  });

  it("se lo stato preferito non esisteva lo dice", () => {
    const text = stateText("Pasta secca", "dried", { preferred: ["cooked"], honored: false });
    expect(text).toMatch(/Cercavo un alimento cotto/);
    expect(text).toMatch(/non c'è/);
    expect(text).toMatch(/«Pasta secca» \(secco\)/);
  });

  it("una voce di pasto è calcolata come cotta e i contributi lo mostrano", () => {
    const foods = [...FAKE_FOODS.filter((f) => f.id !== "pasta-secca"), ...pastaFoods];
    const resolve = buildResolver({ foods, products: new Map(), barcodes: new Map(), overrides: {} });
    const intake = computeIntake(withPasta([{ name: "Pasta", quantityText: "100 g" }]), resolve);
    const top = topContributors([{ ...intake.days[0], complete: true }], "energyKcal");
    const pasta = top.find((c) => c.name === "Pasta");
    expect(pasta?.state).toBe("cooked");
    expect(pasta?.stateText).toBe("Calcolato come «Pasta di semola, cotta» (cotto).");
    expect(pasta?.key).toBeTruthy();
  });

  it("la scelta manuale mostra lo stato di ogni alimento", () => {
    const groups = createFoodSearch([...FAKE_FOODS.filter((f) => f.id !== "pasta-secca"), ...pastaFoods]).groups("pasta");
    const states = groups.flatMap((g) => g.options.map((o) => o.state));
    expect(states).toEqual(expect.arrayContaining(["cooked", "dried"]));
    expect(stateLabel("cooked")).toBe("cotto");
    expect(stateLabel("dried")).toBe("secco");
    expect(stateLabel(undefined)).toBeUndefined();
  });
});

describe("righe «solo nota» con pochi giorni", () => {
  const profile = toEngineProfile({ sex: "female", age: 40, savedOn: "2026-11-01", variants: {} }, "2026-11-16");

  it("senza giorni completi bastanti rispondono come le altre: dati insufficienti, nessuna media nostra", () => {
    const events = [...completeDay("2026-11-10"), ...completeDay("2026-11-11")];
    const intake = computeIntake(events, resolverFor());
    const rows = buildNutritionRows(compareWithReferences(intake.days, REFS, profile), intake.days);
    expect(rows.notes).toEqual([]);
    const note = rows.insufficient.find((r) => r.nutrient === "saltG" || r.nutrient === "saturatedFatG" || r.nutrient === "sugarsG");
    const protein = rows.insufficient.find((r) => r.nutrient === "proteinG");
    expect(note).toBeDefined();
    expect(note?.headline).toBe("Dati insufficienti");
    expect(note?.detail).toBe(protein?.detail);
    expect(note?.note).toBeTruthy();
    expect(note?.certainty).toBeUndefined();
  });
});

describe("nota sulle fonti", () => {
  it("dice che la banca dati è statunitense e che pane, pasta e cereali sono incompleti", () => {
    for (const text of [NUTRITION_DISCLAIMER, NUTRITION_DISCLAIMER_SHORT]) {
      expect(text).toMatch(/statunitense/);
      expect(text).toMatch(/prodotti italiani/);
      expect(text).toMatch(/pareri medici/);
    }
    expect(NUTRITION_DISCLAIMER).toMatch(/pane, pasta e cereali/);
    expect(NUTRITION_DISCLAIMER).toMatch(/arricchimento/);
  });
});
