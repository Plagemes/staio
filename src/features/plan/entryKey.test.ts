import { describe, expect, it } from "vitest";
import type { PlannedEntry } from "@/core/plan";
import { entryKey, entryRefs, findEntry, findLastEntry } from "./entryKey";

const food = (date: string, meal: PlannedEntry["meal"], name: string, value = 80, note?: string): PlannedEntry => ({
  date,
  meal,
  item: { kind: "food", name, quantity: { value, unit: "g" } },
  ...(note ? { note } : {}),
});
const recipe = (date: string, meal: PlannedEntry["meal"], recipeId: string, servings = 2): PlannedEntry => ({ date, meal, item: { kind: "recipe", recipeId, servings } });

describe("entryKey", () => {
  it("è stabile: nome piegato, stessa voce", () => {
    expect(entryKey(food("2026-11-16", "lunch", "Caffè"))).toBe(entryKey(food("2026-11-16", "lunch", "  caffe ")));
  });

  it("cambia con giorno, pasto, quantità, nota e tipo", () => {
    const base = entryKey(food("2026-11-16", "lunch", "Pasta"));
    expect(entryKey(food("2026-11-17", "lunch", "Pasta"))).not.toBe(base);
    expect(entryKey(food("2026-11-16", "dinner", "Pasta"))).not.toBe(base);
    expect(entryKey(food("2026-11-16", "lunch", "Pasta", 90))).not.toBe(base);
    expect(entryKey(food("2026-11-16", "lunch", "Pasta", 80, "integrale"))).not.toBe(base);
    expect(entryKey(recipe("2026-11-16", "lunch", "pasta"))).not.toBe(base);
  });

  it("ricette: il riferimento e le porzioni", () => {
    expect(entryKey(recipe("2026-11-16", "dinner", "a", 2))).not.toBe(entryKey(recipe("2026-11-16", "dinner", "b", 2)));
    expect(entryKey(recipe("2026-11-16", "dinner", "a", 2))).not.toBe(entryKey(recipe("2026-11-16", "dinner", "a", 4)));
  });
});

describe("ritrovare una voce dopo la rilettura", () => {
  const shown = [food("2026-11-16", "lunch", "Pasta"), food("2026-11-16", "lunch", "Pasta"), recipe("2026-11-16", "dinner", "ragu")];

  it("due voci uguali nello stesso pasto: si distinguono per l'ordine tra le uguali", () => {
    const refs = entryRefs(shown);
    expect(refs.map((r) => r.nth)).toEqual([0, 1, 0]);
    expect(findEntry(shown, refs[0])).toBe(0);
    expect(findEntry(shown, refs[1])).toBe(1);
  });

  it("un altro telefono ha aggiunto una voce prima: l'indice è scorso, la voce si ritrova", () => {
    const refs = entryRefs(shown);
    const reread = [food("2026-11-15", "dinner", "Zuppa"), ...shown];
    expect(findEntry(reread, refs[2])).toBe(3);
    expect(findEntry(reread, refs[1])).toBe(2);
  });

  it("la voce non c'è più: -1", () => {
    const refs = entryRefs(shown);
    expect(findEntry([shown[0], shown[2]], refs[1])).toBe(-1);
    expect(findEntry([], refs[0])).toBe(-1);
  });

  it("l'ultima voce con la chiave", () => {
    expect(findLastEntry(shown, entryKey(shown[0]))).toBe(1);
    expect(findLastEntry(shown, "niente")).toBe(-1);
  });
});
