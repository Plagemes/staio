// "Registralo come mangiato": da una voce del piano alle voci di un pasto. Ciò che c'è in dispensa si scala
// (prima i lotti che scadono prima); ciò che manca diventa una voce libera, sempre stimata. Logica pura.
import type { Lot } from "@/core/ledger";
import type { ExpandRef, PlannedEntry } from "@/core/plan";
import type { PrepRecord } from "@/core/prep";
import { formatQuantity } from "@/core/units";
import type { FreeItemInput, MealInput, MealPick } from "../meals";

export interface EatLine {
  name: string;
  /** "80 g" */
  text: string;
  source: "pantry" | "free";
}

export interface EatPlan {
  input: MealInput;
  lines: EatLine[];
  /** Voci che la dispensa non copre (in tutto o in parte). */
  missing: string[];
  /** Ingredienti che non si sono potuti espandere (ricetta o preparazione sconosciuta). */
  unresolved: boolean;
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
const round = (n: number) => Math.round(n * 1e6) / 1e6;

const byExpiry = (a: Lot, b: Lot): number => {
  const ax = a.expiry?.date ?? "9999-12-31";
  const bx = b.expiry?.date ?? "9999-12-31";
  return ax < bx ? -1 : ax > bx ? 1 : a.lotId < b.lotId ? -1 : 1;
};

interface Need {
  name: string;
  foodId?: string;
  value: number;
  unit: "g" | "ml" | "pz";
}

export function planEat(
  entry: PlannedEntry,
  ctx: { lots: readonly Lot[]; preps: readonly PrepRecord[]; expand: ExpandRef },
): EatPlan {
  const item = entry.item;
  const needs: Need[] = [];
  const picks: MealPick[] = [];
  const free: FreeItemInput[] = [];
  const lines: EatLine[] = [];
  const missing: string[] = [];
  let unresolved = false;
  const left = new Map(ctx.lots.map((l) => [l.lotId, l.remaining]));

  const take = (lot: Lot, value: number, name: string) => {
    const available = left.get(lot.lotId) ?? 0;
    left.set(lot.lotId, round(available - value));
    const all = Math.abs(available - value) < 1e-9 && value >= lot.remaining - 1e-9;
    picks.push({ lot, choice: all ? { kind: "all" } : { kind: "text", text: `${value} ${lot.unit}` } });
    lines.push({ name, text: formatQuantity({ value, unit: lot.unit }), source: "pantry" });
  };

  if (item.kind === "prep") {
    const prep = ctx.preps.find((p) => p.prepId === item.prepId);
    const lot = prep ? ctx.lots.find((l) => l.lotId === prep.batchLotId) : undefined;
    const available = lot ? (left.get(lot.lotId) ?? 0) : 0;
    if (prep && lot && available >= item.servings - 1e-9) take(lot, item.servings, prep.title);
    else {
      const name = prep?.title ?? "Preparazione";
      if (!prep) unresolved = true;
      const useful = lot ? Math.min(available, item.servings) : 0;
      if (lot && useful > 0) take(lot, useful, name);
      const rest = round(item.servings - useful);
      if (rest > 0) {
        free.push({ name, quantityText: `${rest} pz` });
        lines.push({ name, text: formatQuantity({ value: rest, unit: "pz" }), source: "free" });
        missing.push(name);
      }
    }
  } else if (item.kind === "recipe") {
    const ingredients = ctx.expand({ kind: "recipe", id: item.recipeId }, item.servings);
    if (!ingredients) unresolved = true;
    for (const ing of ingredients ?? []) {
      needs.push({ name: ing.name, ...(ing.foodId ? { foodId: ing.foodId } : {}), value: ing.quantity.value, unit: ing.quantity.unit });
    }
  } else {
    needs.push({
      name: item.name,
      ...(item.foodId ? { foodId: item.foodId } : {}),
      value: item.quantity.value,
      unit: item.quantity.unit,
    });
  }

  for (const need of needs) {
    let remaining = need.value;
    const matches = ctx.lots
      .filter((l) => fold(l.productRef) === fold(need.name) && l.unit === need.unit && (left.get(l.lotId) ?? 0) > 1e-9)
      .sort(byExpiry);
    for (const lot of matches) {
      if (remaining <= 1e-9) break;
      const value = Math.min(left.get(lot.lotId) ?? 0, remaining);
      take(lot, round(value), need.name);
      remaining = round(remaining - value);
    }
    if (remaining > 1e-9) {
      free.push({ name: need.name, quantityText: `${round(remaining)} ${need.unit}`, ...(need.foodId ? { foodId: need.foodId } : {}) });
      lines.push({ name: need.name, text: formatQuantity({ value: round(remaining), unit: need.unit }), source: "free" });
      missing.push(need.name);
    }
  }

  return { input: { kind: entry.meal, picks, freeItems: free }, lines, missing: [...new Set(missing)], unresolved };
}
