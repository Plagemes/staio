// Classificatore delle righe del mangiato: a ogni riga una o più parti con gruppo, porzione, lavorazione e
// certezza. Una preparazione si scompone nei suoi ingredienti. Un dato che manca resta assente, mai zero.

import type { Product } from "../catalog";
import { isFoodCategory } from "../expiry";
import { worseCertainty, type Certainty, type Lot, type Quantity } from "../ledger";
import {
  DEFAULT_STATE_PREFERENCE,
  normalizeName,
  nutrientsOfQuantity,
  type DayIntake,
  type DrinkIntake,
  type FoodComposition,
  type IntakeLine,
  type NutrientAmounts,
  type ResolvedComposition,
} from "../nutrition";
import {
  LOT_CATEGORY_GROUP,
  LOT_CATEGORY_PORTION,
  OFF_CATEGORY_RULES,
  OFF_WHOLE_GRAIN_CATEGORY,
  firstIngredientIsWholeGrain,
} from "./data/categories";
import { GROUP_DEFAULT_PORTION, foodGroupOf } from "./data/foodGroups";
import { nameRuleOf } from "./data/nameRules";
import { CATEGORY_PROCESSING, declaredProcessingOf } from "./data/processing";
import type {
  ClassOverride,
  ClassPart,
  Classifier,
  ClassifierSources,
  DietGroup,
  LineClass,
  PortionKey,
  PrepForDiet,
  ProcessingInfo,
} from "./types";

/** Riferimento della composizione di una porzione di preparazione (`features/nutrition/prepPortion.ts`). */
export const PREP_REF_PREFIX = "prep:";

/** Soglia CREA della Tab. 9.1 tra formaggi «fino al 25% di grassi» e gli altri, in kcal per 100 g. */
export const CHEESE_FRESH_MAX_KCAL = 300;

/** Ciò che di una parte non dipende dalla quantità: si ricorda per soggetto. */
type Template = Pick<ClassPart, "group" | "portionKey" | "processing" | "basis" | "certainty">;

interface Amounts {
  grams?: number;
  gramsCertainty?: Certainty;
  energyKcal?: number;
  sugarsG?: number;
  saltG?: number;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
const isAmount = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;

function makePart(t: Template, label: string, a: Amounts, prepId?: string): ClassPart {
  return {
    group: t.group,
    ...(t.portionKey !== undefined ? { portionKey: t.portionKey } : {}),
    ...(t.processing !== undefined ? { processing: t.processing } : {}),
    basis: t.basis,
    certainty: t.certainty,
    ...(a.grams !== undefined ? { grams: a.grams } : {}),
    ...(a.grams !== undefined && a.gramsCertainty !== undefined ? { gramsCertainty: a.gramsCertainty } : {}),
    ...(a.energyKcal !== undefined ? { energyKcal: a.energyKcal } : {}),
    ...(a.sugarsG !== undefined ? { sugarsG: a.sugarsG } : {}),
    ...(a.saltG !== undefined ? { saltG: a.saltG } : {}),
    ...(prepId !== undefined ? { prepId } : {}),
    label,
  };
}

function nutrientAmounts(n: NutrientAmounts | undefined): Amounts {
  if (!n) return {};
  return {
    ...(isAmount(n.energyKcal) ? { energyKcal: n.energyKcal } : {}),
    ...(isAmount(n.sugarsG) ? { sugarsG: n.sugarsG } : {}),
    ...(isAmount(n.saltG) ? { saltG: n.saltG } : {}),
  };
}

/** Grammi di una quantità (g, ml, pz). Senza il peso di un pezzo i pezzi non hanno grammi. */
function gramsOf(
  quantity: Quantity,
  certainty: Certainty,
  ctx: { unitWeightG?: number; densityGPerMl?: number } = {},
): { grams: number; certainty: Certainty } | undefined {
  if (!isAmount(quantity.value)) return undefined;
  switch (quantity.unit) {
    case "g":
      return { grams: quantity.value, certainty };
    case "ml":
      return isAmount(ctx.densityGPerMl) && ctx.densityGPerMl > 0
        ? { grams: round(quantity.value * ctx.densityGPerMl), certainty }
        : { grams: quantity.value, certainty: worseCertainty(certainty, "estimated") };
    case "pz":
      return isAmount(ctx.unitWeightG) && ctx.unitWeightG > 0
        ? { grams: round(quantity.value * ctx.unitWeightG), certainty: worseCertainty(certainty, "estimated") }
        : undefined;
    default:
      return undefined;
  }
}

const rawSiblings = new WeakMap<ReadonlyMap<string, FoodComposition>, Map<string, FoodComposition>>();

/** Voce secca o cruda con lo stesso `variantOf`, se la voce data è in un altro stato. */
function rawSiblingOf(food: FoodComposition, foods: ReadonlyMap<string, FoodComposition>): FoodComposition | undefined {
  if (food.variantOf === undefined || food.state === "raw" || food.state === "dried") return undefined;
  let index = rawSiblings.get(foods);
  if (!index) {
    index = new Map();
    for (const f of foods.values()) {
      if (f.variantOf === undefined) continue;
      if (f.state === "dried") index.set(f.variantOf, f);
      else if (f.state === "raw" && !index.has(f.variantOf)) index.set(f.variantOf, f);
    }
    rawSiblings.set(foods, index);
  }
  return index.get(food.variantOf);
}

/**
 * Equivalente crudo (o secco) di una quantità di alimento della tabella: se esiste una voce con lo stesso
 * `variantOf` in stato `dried` o `raw`, si converte a parità di energia per 100 g. Scelta dell'app (FONTI.md):
 * la tabella non ha rese. `certainty` è quella della sola conversione: `measured` se non serve convertire,
 * `estimated` se si è convertito; chi la usa la combina con la certezza della quantità.
 */
export function rawEquivalentGrams(
  food: FoodComposition,
  grams: number,
  foods: ReadonlyMap<string, FoodComposition>,
): { grams: number; certainty: Certainty } {
  const sibling = rawSiblingOf(food, foods);
  const from = food.per100.energyKcal;
  const to = sibling?.per100.energyKcal;
  if (!sibling || !isAmount(from) || !isAmount(to) || from <= 0 || to <= 0) return { grams, certainty: "measured" };
  return { grams: round((grams * from) / to), certainty: "estimated" };
}

/** Consumo → lotto, da `Lot.history`: la riga di dispensa porta solo l'id del `consume`. */
export function lotsByConsume(lots: readonly Lot[]): ReadonlyMap<string, Lot> {
  const out = new Map<string, Lot>();
  for (const lot of lots) {
    for (const h of lot.history) if (h.type === "consume") out.set(h.eventId, lot);
  }
  return out;
}

const BARCODE = /^\d{8,14}$/;

const nameKey = (name: string): string | undefined => {
  const n = normalizeName(name);
  return n === "" ? undefined : `n:${n}`;
};

/** Chiave di `ClassOverrides` con cui si corregge la riga: il codice del prodotto se c'è, altrimenti il nome. */
export function overrideKeyOf(line: IntakeLine, lot?: Lot): string | undefined {
  if (line.status === "ok" && line.outOfHome) return undefined;
  if (line.status === "ok" && line.composition.selection === "product" && line.composition.ref) {
    return `b:${line.composition.ref}`;
  }
  if (lot?.barcode) return `b:${lot.barcode}`;
  const name = line.kind === "pantry" ? (lot?.productRef ?? line.label) : line.label;
  if (BARCODE.test(name)) return `b:${name}`;
  return nameKey(name);
}

const estimatedProcessing = (level: ProcessingInfo["level"], basis: ProcessingInfo["basis"]): ProcessingInfo => ({
  level,
  certainty: "estimated",
  basis,
});

function foodTemplate(food: FoodComposition, foods: ReadonlyMap<string, FoodComposition>, chosen: boolean): Template {
  const sibling = rawSiblingOf(food, foods);
  const { group, portionKey } = foodGroupOf(food, sibling?.state ?? food.state);
  const level = declaredProcessingOf(food);
  return {
    group,
    ...(portionKey !== undefined ? { portionKey } : {}),
    ...(level !== undefined ? { processing: estimatedProcessing(level, "declared") } : {}),
    basis: "food",
    certainty: chosen ? "label" : "estimated",
  };
}

function withGroup(t: Template, group: DietGroup, portionKey: PortionKey | undefined): Template {
  return {
    group,
    ...(portionKey !== undefined ? { portionKey } : {}),
    ...(t.processing !== undefined ? { processing: t.processing } : {}),
    basis: t.basis,
    certainty: t.certainty,
  };
}

function categoryTemplate(category: string | undefined): Template | undefined {
  if (!isFoodCategory(category)) return undefined;
  const group = LOT_CATEGORY_GROUP[category];
  if (group === "unknown") return undefined;
  const portionKey = LOT_CATEGORY_PORTION[category];
  const level = CATEGORY_PROCESSING[category];
  return {
    group,
    ...(portionKey !== undefined ? { portionKey } : {}),
    ...(level !== undefined ? { processing: estimatedProcessing(level, "category") } : {}),
    basis: "category",
    certainty: "estimated",
  };
}

function nameTemplate(name: string): Template | undefined {
  const match = nameRuleOf(name);
  if (!match) return undefined;
  return {
    group: match.group,
    ...(match.portionKey !== undefined ? { portionKey: match.portionKey } : {}),
    basis: "name",
    certainty: "estimated",
  };
}

const UNKNOWN: Template = { group: "unknown", basis: "none", certainty: "estimated" };

/** Prodotto con codice: categorie di Open Food Facts, poi categoria del lotto, poi nome. */
function productTemplate(product: Product | undefined, lotCategory: string | undefined, name: string): Template {
  let t: Template | undefined;
  const categories = product?.categories ?? [];
  for (const [pattern, group, portionKey] of OFF_CATEGORY_RULES) {
    if (!categories.some((c) => pattern.test(c))) continue;
    t = { group, ...(portionKey !== undefined ? { portionKey } : {}), basis: "product", certainty: "label" };
    break;
  }
  if (!t) {
    const byCategory = categoryTemplate(lotCategory);
    // la lavorazione di un prodotto viene solo dalla sua scheda
    if (byCategory) {
      t = {
        group: byCategory.group,
        ...(byCategory.portionKey !== undefined ? { portionKey: byCategory.portionKey } : {}),
        basis: byCategory.basis,
        certainty: byCategory.certainty,
      };
    }
  }
  t ??= nameTemplate(product?.name ?? name) ?? UNKNOWN;

  if (product && (t.group === "refinedGrains" || t.group === "wholeGrains")) {
    const text = product.ingredientsText?.trim();
    if (text) {
      const whole = firstIngredientIsWholeGrain(text);
      t = withGroup(t, whole ? "wholeGrains" : "refinedGrains", t.portionKey);
      if (whole) t = { ...t, certainty: "label" };
    } else if (t.group === "refinedGrains" && categories.some((c) => OFF_WHOLE_GRAIN_CATEGORY.test(c))) {
      t = { ...withGroup(t, "wholeGrains", t.portionKey), certainty: "estimated" };
    }
  }
  const kcal = product?.nutrients?.per === "100g" ? product.nutrients.energyKcal : undefined;
  if (t.group === "cheese" && isAmount(kcal)) {
    t = withGroup(t, "cheese", kcal < CHEESE_FRESH_MAX_KCAL ? "cheeseFresh" : "cheeseAged");
  }
  if (product?.nova !== undefined) {
    t = { ...t, processing: { level: product.nova, certainty: "label", basis: "product" } };
  }
  return t;
}

const GRAINS: ReadonlySet<string> = new Set(["refinedGrains", "wholeGrains"]);

function applyOverride(t: Template, o: ClassOverride | undefined): Template {
  if (!o || (o.group === undefined && o.processing === undefined)) return t;
  let out: Template = t;
  if (o.group !== undefined) {
    // tra integrale e non integrale la forma (pane, pasta, sostituti) non cambia
    const sameShape = t.group === o.group || (GRAINS.has(t.group) && GRAINS.has(o.group));
    const portionKey = sameShape && t.portionKey !== undefined ? t.portionKey : GROUP_DEFAULT_PORTION[o.group];
    out = { ...withGroup(t, o.group, portionKey), basis: "user", certainty: "label" };
  }
  if (o.processing !== undefined) out = { ...out, processing: { level: o.processing, certainty: "label", basis: "user" } };
  return out;
}

function scaleParts(parts: readonly ClassPart[], f: number, certainty: Certainty): ClassPart[] {
  return parts.map((p) => {
    const out: ClassPart = { ...p };
    if (p.grams !== undefined) {
      out.grams = round(p.grams * f);
      out.gramsCertainty = worseCertainty(p.gramsCertainty ?? "estimated", certainty);
    }
    if (p.energyKcal !== undefined) out.energyKcal = round(p.energyKcal * f);
    if (p.sugarsG !== undefined) out.sugarsG = round(p.sugarsG * f);
    if (p.saltG !== undefined) out.saltG = round(p.saltG * f);
    return out;
  });
}

const isComposition = (r: unknown): r is ResolvedComposition =>
  typeof r === "object" && r !== null && "per100" in r;

export function createClassifier(sources: ClassifierSources): Classifier {
  const { foods, products, overrides } = sources;
  const templates = new Map<string, Template>();
  const batches = new Map<string, ClassPart[]>();
  const named = new Map<string, ClassPart>();
  let prepById: Map<string, PrepForDiet> | undefined;
  let drinkFoods: Map<string, FoodComposition> | undefined;

  const prepOf = (prepId: string): PrepForDiet | undefined => {
    if (!prepById) {
      prepById = new Map();
      for (const p of sources.preps.values()) prepById.set(p.prepId, p);
    }
    return prepById.get(prepId);
  };

  const overrideOf = (key: string | undefined): ClassOverride | undefined =>
    key !== undefined && Object.hasOwn(overrides, key) ? overrides[key] : undefined;

  const productOfLot = (lot: Lot | undefined, productRef: string): Product | undefined =>
    (lot?.barcode !== undefined ? products.get(lot.barcode) : undefined) ?? products.get(productRef);

  const remember = (key: string, make: () => Template): Template => {
    let t = templates.get(key);
    if (!t) {
      t = make();
      templates.set(key, t);
    }
    return t;
  };

  /** Amounts di un alimento della tabella: grammi come equivalente crudo. */
  function foodAmounts(food: FoodComposition, quantity: Quantity, certainty: Certainty, nutrients?: NutrientAmounts): Amounts {
    const g = gramsOf(quantity, certainty, {
      ...(food.unitWeightG !== undefined ? { unitWeightG: food.unitWeightG } : {}),
      ...(food.densityGPerMl !== undefined ? { densityGPerMl: food.densityGPerMl } : {}),
    });
    const base = nutrientAmounts(nutrients);
    if (!g) return base;
    const raw = rawEquivalentGrams(food, g.grams, foods);
    return { ...base, grams: raw.grams, gramsCertainty: worseCertainty(g.certainty, raw.certainty) };
  }

  /** Parti di un intero lotto di preparazione, prima della frazione. `stack`: preparazioni già aperte. */
  function batchParts(prep: PrepForDiet, stack: ReadonlySet<string>): ClassPart[] {
    if (stack.size === 0) {
      const cached = batches.get(prep.prepId);
      if (cached) return cached;
    }
    const inner = new Set([...stack, prep.prepId]);
    const parts = prep.ingredients.flatMap((ing) => ingredientParts(prep.prepId, ing, inner));
    if (stack.size === 0) batches.set(prep.prepId, parts);
    return parts;
  }

  function ingredientParts(prepId: string, ing: PrepForDiet["ingredients"][number], stack: ReadonlySet<string>): ClassPart[] {
    const lot = sources.lots.get(ing.lotId);
    const nested = sources.preps.get(ing.lotId);
    const label = lot?.productRef ?? ing.productRef;
    if (nested && !stack.has(nested.prepId)) {
      if (ing.quantity.unit === "pz" && isAmount(ing.quantity.value) && nested.portions > 0) {
        return scaleParts(batchParts(nested, stack), ing.quantity.value / nested.portions, "estimated");
      }
      return [makePart({ group: "mixedDish", basis: "prep", certainty: "estimated" }, label, {}, prepId)];
    }
    const product = productOfLot(lot, ing.productRef);
    const found = sources.resolve?.({
      kind: "pantry",
      productRef: ing.productRef,
      lotId: ing.lotId,
      ...(lot?.category !== undefined ? { category: lot.category } : {}),
      preferStates: DEFAULT_STATE_PREFERENCE.pantry,
    });
    const composition = isComposition(found) ? found : undefined;
    const food =
      !product && composition?.origin === "table" && composition.ref !== undefined ? foods.get(composition.ref) : undefined;

    const key = `ing|${product?.barcode ?? ""}|${food?.id ?? ""}|${lot?.category ?? ""}|${label}`;
    let t = remember(key, () => {
      if (product) return productTemplate(product, lot?.category, label);
      if (food) return foodTemplate(food, foods, false);
      return categoryTemplate(lot?.category) ?? nameTemplate(label) ?? UNKNOWN;
    });
    const overrideKey = product ? `b:${product.barcode}` : lot?.barcode ? `b:${lot.barcode}` : nameKey(label);
    t = applyOverride(t, overrideOf(overrideKey));

    let amounts: Amounts;
    if (composition) {
      const r = nutrientsOfQuantity(composition, ing.quantity, "estimated");
      if (r.ok) {
        amounts = nutrientAmounts(r.value.nutrients);
        const raw = food ? rawEquivalentGrams(food, r.value.amount, foods) : { grams: r.value.amount, certainty: "measured" as const };
        amounts.grams = raw.grams;
        amounts.gramsCertainty = worseCertainty(r.value.certainty, raw.certainty);
      } else {
        amounts = {};
      }
    } else {
      const g = gramsOf(ing.quantity, "estimated");
      amounts = g ? { grams: g.grams, gramsCertainty: g.certainty } : {};
    }
    return [makePart({ ...t, basis: "prep" }, product?.name ?? label, amounts, prepId)];
  }

  function prepLineParts(prep: PrepForDiet, line: IntakeLine, label: string): ClassPart[] {
    const q = line.quantity;
    if (q.unit === "pz" && isAmount(q.value) && prep.portions > 0) {
      return scaleParts(batchParts(prep, new Set()), q.value / prep.portions, line.quantityCertainty);
    }
    const nutrients = line.status === "ok" ? line.nutrients : undefined;
    return [makePart({ group: "mixedDish", basis: "prep", certainty: "estimated" }, label, nutrientAmounts(nutrients), prep.prepId)];
  }

  function lineParts(line: IntakeLine, lot: Lot | undefined, override: ClassOverride | undefined): ClassPart[] {
    const label = line.status === "ok" ? line.composition.name || line.label : line.label;
    if (line.status === "ok" && line.outOfHome) {
      return [makePart({ group: "outOfHome", basis: "outOfHome", certainty: "estimated" }, line.label, nutrientAmounts(line.nutrients))];
    }

    const ref = line.status === "ok" ? line.composition.ref : undefined;
    const prep =
      ref !== undefined && ref.startsWith(PREP_REF_PREFIX)
        ? prepOf(ref.slice(PREP_REF_PREFIX.length))
        : lot
          ? sources.preps.get(lot.lotId)
          : undefined;
    if (prep && !override?.group) {
      const parts = prepLineParts(prep, line, line.label);
      return override?.processing !== undefined ? parts.map((p) => ({ ...p, ...applyOverride(p, override) })) : parts;
    }

    const productRef = lot?.productRef ?? line.label;
    if (line.status === "ok") {
      const c = line.composition;
      const amountsBase = nutrientAmounts(line.nutrients);
      if (c.selection === "product" || c.origin === "label") {
        const product = (c.ref !== undefined ? products.get(c.ref) : undefined) ?? productOfLot(lot, productRef);
        const key = `p|${product?.barcode ?? c.ref ?? ""}|${lot?.category ?? ""}|${label}`;
        const t = applyOverride(
          remember(key, () => productTemplate(product, lot?.category, label)),
          override,
        );
        const g = gramsOf(line.quantity, line.quantityCertainty);
        return [makePart(t, label, g ? { ...amountsBase, grams: g.grams, gramsCertainty: g.certainty } : amountsBase)];
      }
      const food = c.ref !== undefined ? foods.get(c.ref) : undefined;
      if (food) {
        const chosen = c.selection === "explicit";
        const t = applyOverride(remember(`f|${food.id}|${chosen}`, () => foodTemplate(food, foods, chosen)), override);
        return [makePart(t, label, foodAmounts(food, line.quantity, line.quantityCertainty, line.nutrients))];
      }
    }

    const product = line.kind === "pantry" ? productOfLot(lot, productRef) : undefined;
    const key = `u|${product?.barcode ?? ""}|${lot?.category ?? ""}|${productRef}`;
    const t = applyOverride(
      remember(key, () =>
        product
          ? productTemplate(product, lot?.category, productRef)
          : (categoryTemplate(lot?.category) ?? nameTemplate(productRef) ?? UNKNOWN),
      ),
      override,
    );
    const g = line.quantity.unit === "pz" ? undefined : gramsOf(line.quantity, line.quantityCertainty);
    const nutrients = line.status === "ok" ? nutrientAmounts(line.nutrients) : {};
    return [makePart(t, label, g ? { ...nutrients, grams: g.grams, gramsCertainty: g.certainty } : nutrients)];
  }

  function line(l: IntakeLine, date: string): LineClass {
    const lineKey = l.kind === "mealItem" ? `${l.eventId}#${l.itemIndex ?? 0}` : l.eventId;
    const lot = l.kind === "pantry" ? sources.lotOfConsume(l.eventId) : undefined;
    const overrideKey = overrideKeyOf(l, lot);
    const parts = lineParts(l, lot, overrideOf(overrideKey));
    return {
      lineKey,
      date,
      occasionKey: l.mealId ?? lineKey,
      parts,
      ...(overrideKey !== undefined ? { overrideKey } : {}),
    };
  }

  function drinkFoodOf(name: string): FoodComposition | undefined {
    if (!drinkFoods) {
      drinkFoods = new Map();
      for (const f of foods.values()) {
        if (f.group !== "bevande") continue;
        for (const n of [f.name, ...(f.aliases ?? [])]) {
          const k = normalizeName(n);
          if (k !== "" && !drinkFoods.has(k)) drinkFoods.set(k, f);
        }
      }
    }
    return drinkFoods.get(normalizeName(name));
  }

  function drink(d: DrinkIntake, date: string): LineClass {
    const overrideKey = nameKey(d.name);
    const t = applyOverride(
      remember(`d|${d.name}`, () => {
        const food = drinkFoodOf(d.name);
        return food ? foodTemplate(food, foods, false) : (nameTemplate(d.name) ?? UNKNOWN);
      }),
      overrideOf(overrideKey),
    );
    const amounts: Amounts = {
      ...(isAmount(d.ml) ? { grams: d.ml, gramsCertainty: d.certainty } : {}),
      ...(isAmount(d.energyKcal) ? { energyKcal: d.energyKcal } : {}),
      ...(isAmount(d.sugarsG) ? { sugarsG: d.sugarsG } : {}),
    };
    return {
      lineKey: d.eventId,
      date,
      occasionKey: d.eventId,
      parts: [makePart(t, d.name, amounts)],
      ...(overrideKey !== undefined ? { overrideKey } : {}),
    };
  }

  function day(d: DayIntake): LineClass[] {
    const out: LineClass[] = [];
    for (const meal of d.meals) for (const l of meal.lines) out.push(line(l, d.date));
    for (const l of d.standalone) out.push(line(l, d.date));
    for (const dr of d.drinks) out.push(drink(dr, d.date));
    return out;
  }

  function name(n: string, foodId?: string): ClassPart {
    const key = `${foodId ?? ""}|${n}`;
    const cached = named.get(key);
    if (cached) return cached;
    const food = foodId ? foods.get(foodId) : undefined;
    const base = food ? foodTemplate(food, foods, true) : (nameTemplate(n) ?? UNKNOWN);
    const part = makePart(applyOverride(base, overrideOf(nameKey(n))), n, {});
    named.set(key, part);
    return part;
  }

  return { line, drink, day, name };
}
