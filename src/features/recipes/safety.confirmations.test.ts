import { describe, expect, it } from "vitest";
import { confirmIngredient, deriveConfirmations, type ItemSubject } from "@/core/allergens";
import { NOW, recipeOf } from "../prep/test-helpers";
import { NO_FILTERS, applyFilters, buildRows, confirmedRowText, hiddenText, pantryView } from "./list";
import { clearText, confirmedText, ingredientFlags, reasonLines, recipeSafety } from "./safety";

const toast = recipeOf("toast", {
  title: "Toast",
  ingredients: [
    { name: "Riso", quantity: { value: 100, unit: "g" } },
    { name: "Prosciutto cotto", quantity: { value: 50, unit: "g" } },
  ],
  steps: [{ text: "Scalda." }],
});
const CRITERIA = { allergens: ["latte"], excludedFoods: [] as string[] };
const WHEN = "2026-11-05T09:00:00.000Z";

function confirmations(item: ItemSubject, allergens = CRITERIA.allergens) {
  const r = confirmIngredient(item, { allergens, excludedFoods: [] }, { deviceId: "A", now: () => WHEN, idGenerator: () => "c1" });
  if (!r.ok) throw new Error(r.reason);
  return deriveConfirmations([r.event]).byKey;
}

describe("sicurezza di una ricetta con conferme", () => {
  it("senza conferma: non verificabile, con l'ingrediente confermabile", () => {
    const s = recipeSafety(toast, CRITERIA);
    expect(s.verdict).toBe("uncertain");
    expect(s.confirmed).toEqual([]);
    expect(s.doubts.map((d) => d.name)).toEqual(["Prosciutto cotto"]);
    expect(s.doubts[0]?.subject).toMatchObject({ name: "Prosciutto cotto" });
  });

  it("con la conferma: clear ma col segno, non «sicura»", () => {
    const s = recipeSafety(toast, { ...CRITERIA, confirmations: confirmations({ name: "Prosciutto cotto" }) });
    expect(s.verdict).toBe("clear");
    expect(s.uncertain).toEqual([]);
    expect(s.doubts).toEqual([]);
    expect(s.confirmed).toEqual([expect.objectContaining({ name: "Prosciutto cotto", allergens: ["latte"], confirmedAt: WHEN })]);
    expect(s.confirmed[0]?.text).toMatch(/^confermato da te il \d{1,2} novembre 2026$/);
    expect(clearText(CRITERIA, 1)).toContain("tranne l'ingrediente che hai confermato tu");
    expect(clearText(CRITERIA, 2)).toContain("tranne gli ingredienti che hai confermato tu");
    expect(clearText(CRITERIA)).not.toContain("confermato");
  });

  it("accanto all'ingrediente: «confermato da te il…», distinto da non verificabile e da contiene", () => {
    const flags = ingredientFlags(toast, { ...CRITERIA, confirmations: confirmations({ name: "Prosciutto cotto" }) });
    expect(flags.get(1)?.verdict).toBe("confirmed");
    expect(flags.get(1)?.text).toContain("confermato da te il");
    expect(flags.get(1)?.text).toContain("latte");
    expect(flags.get(0)).toBeUndefined();
  });

  it("un nuovo allergene riapre il dubbio e l'ingrediente torna confermabile", () => {
    const c = confirmations({ name: "Prosciutto cotto" });
    const s = recipeSafety(toast, { allergens: ["latte", "uova"], excludedFoods: [], confirmations: c });
    expect(s.verdict).toBe("uncertain");
    expect(s.doubts.map((d) => d.name)).toEqual(["Prosciutto cotto"]);
    expect(s.confirmed).toHaveLength(1);
    expect(ingredientFlags(toast, { allergens: ["latte", "uova"], excludedFoods: [], confirmations: c }).get(1)?.verdict).toBe("uncertain");
  });

  it("un ingrediente che contiene non è mai confermabile", () => {
    const r = recipeOf("lasagne", {
      title: "Lasagne",
      ingredients: [{ name: "Besciamella", quantity: { value: 300, unit: "g" } }, { name: "Prosciutto cotto", quantity: { value: 50, unit: "g" } }],
      steps: [{ text: "Inforna." }],
    });
    const s = recipeSafety(r, CRITERIA);
    expect(s.verdict).toBe("contains");
    expect(s.doubts.map((d) => d.name)).not.toContain("Besciamella");
    expect(s.doubts.map((d) => d.name)).not.toContain("Riso");
  });

  it("le righe per le ricette nascoste usano le stesse conferme", () => {
    const c = confirmations({ name: "Prosciutto cotto" });
    const lines = reasonLines([], toast, { ...CRITERIA, confirmations: c });
    expect(lines.verdict).toBe("clear");
  });
});

describe("elenco del ricettario con conferme", () => {
  const rows = buildRows([toast], pantryView([], NOW));

  it("nascosta senza conferma, mostrata col segno con la conferma", () => {
    const without = applyFilters(rows, { ...NO_FILTERS, allergens: ["latte"] });
    expect(without.rows).toEqual([]);
    expect(without.hiddenUncertain).toHaveLength(1);
    expect(hiddenText(without)).toContain("non verificabile");

    const withIt = applyFilters(rows, { ...NO_FILTERS, allergens: ["latte"], confirmations: confirmations({ name: "Prosciutto cotto" }) });
    expect(withIt.rows.map((r) => r.recipe.recipeId)).toEqual(["toast"]);
    expect(withIt.hiddenUncertain).toEqual([]);
    const hits = withIt.confirmedBy.get("toast") ?? [];
    expect(hits).toHaveLength(1);
    expect(confirmedRowText(hits)).toContain("Ingrediente confermato da te: Prosciutto cotto (confermato da te il");
    expect(confirmedRowText(hits)).toContain("Non verificato dall'app.");
  });

  it("una conferma data prima di un nuovo allergene non fa passare la ricetta", () => {
    const out = applyFilters(rows, { ...NO_FILTERS, allergens: ["latte", "uova"], confirmations: confirmations({ name: "Prosciutto cotto" }) });
    expect(out.rows).toEqual([]);
    expect(out.hiddenUncertain).toHaveLength(1);
  });

  it("senza ricette confermate la mappa è vuota", () => {
    expect(applyFilters(rows, NO_FILTERS).confirmedBy.size).toBe(0);
    expect(confirmedRowText([])).toBeUndefined();
  });
});

describe("data della conferma", () => {
  it("è detta in italiano nel fuso del dispositivo; un valore illeggibile non rompe", () => {
    expect(confirmedText("2026-11-05T12:00:00.000Z")).toContain("novembre 2026");
    expect(confirmedText("boh")).toBe("confermato da te");
  });
});
