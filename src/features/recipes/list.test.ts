import { describe, expect, it } from "vitest";
import { activeLots } from "@/core/ledger";
import { compareWithPantry, stockFromLots } from "@/core/recipes";
import { NOW, lotsOf, recipeOf } from "../prep/test-helpers";
import {
  NO_FILTERS,
  applyFilters,
  availabilityLabel,
  buildRows,
  countsText,
  effectiveStatus,
  expiringText,
  filtersActive,
  missingText,
  pantryView,
  pendingConfirmations,
  shortfallsWith,
  sortRows,
} from "./list";

const pasta = recipeOf("pasta", {
  title: "Pasta al pomodoro",
  servings: 2,
  ingredients: [
    { name: "Spaghetti", quantity: { value: 200, unit: "g" } },
    { name: "Pomodori pelati", quantity: { value: 400, unit: "g" } },
    { name: "Basilico", quantity: { value: 10, unit: "g" } },
  ],
  steps: [{ text: "Cuoci.", durationMinutes: 10 }],
  times: { totalMinutes: 25 },
  tags: ["primo", "veloce"],
  equipment: ["pentola"],
});
const frittata = recipeOf("fritt", {
  title: "Frittata di zucchine",
  servings: 2,
  ingredients: [
    { name: "Uova", quantity: { value: 4, unit: "pz" } },
    { name: "Zucchine", quantity: { value: 300, unit: "g" } },
    { name: "Parmigiano", quantity: { value: 30, unit: "g" } },
  ],
  steps: [{ text: "Cuoci in padella." }],
  times: { totalMinutes: 40 },
  tags: ["secondo"],
  equipment: ["padella", "forno"],
});
const dolce = recipeOf("dolce", {
  title: "Torta",
  servings: 8,
  ingredients: [{ name: "Farina 00", quantity: { value: 300, unit: "g" } }, { name: "Burro", quantity: { value: 150, unit: "g" } }],
  steps: [{ text: "Inforna." }],
});

function view() {
  const { lots } = lotsOf([
    { id: "sp", name: "Spaghetti", value: 500 },
    { id: "po", name: "Pomodori pelati", value: 400 },
    { id: "zu", name: "Zucchine", value: 400, expiry: "2026-11-17", location: "frigo" },
    { id: "uo", name: "Uova", value: 6, unit: "pz", location: "frigo" },
  ]);
  return pantryView(activeLots({ lots, anomalies: [], voidedEventIds: [] }), NOW);
}

describe("buildRows", () => {
  it("conta gli ingredienti che hai e dice quali mancano", () => {
    const rows = buildRows([pasta, frittata, dolce], view());
    const p = rows.find((r) => r.recipe.recipeId === "pasta");
    expect(p?.total).toBe(3);
    expect(p?.available).toBe(2);
    expect(p?.missingNames).toEqual(["Basilico"]);
    expect(countsText(p as never)).toBe("3 ingredienti, 2 in casa");
    expect(missingText(p as never)).toBe("Manca: basilico");
    const d = rows.find((r) => r.recipe.recipeId === "dolce");
    expect(countsText(d as never)).toBe("2 ingredienti, nessuno in casa");
    expect(missingText(d as never)).toBe("Mancano: farina 00 e burro");
  });

  it("riconosce ciò che sta scadendo e lo dice", () => {
    const rows = buildRows([pasta, frittata], view());
    const f = rows.find((r) => r.recipe.recipeId === "fritt");
    expect(f?.expiringUses.map((u) => u.name)).toEqual(["Zucchine"]);
    expect(expiringText(f as never)).toBe("Usa zucchine (scade domani)");
    expect(expiringText(rows.find((r) => r.recipe.recipeId === "pasta") as never)).toBeUndefined();
  });

  it("senza dispensa tutto manca", () => {
    const rows = buildRows([pasta], { stock: [], expiring: [] });
    expect(rows[0]?.available).toBe(0);
    expect(rows[0]?.missing).toBe(3);
  });
});

describe("sortRows", () => {
  const rows = () => buildRows([dolce, pasta, frittata], view());
  it("per nome", () => {
    expect(sortRows(rows(), "title").map((r) => r.recipe.title)).toEqual(["Frittata di zucchine", "Pasta al pomodoro", "Torta"]);
  });
  it("con ciò che hai: prima chi ha più ingredienti in casa", () => {
    expect(sortRows(rows(), "pantry").map((r) => r.recipe.recipeId).slice(0, 2).sort()).toEqual(["fritt", "pasta"]);
    expect(sortRows(rows(), "pantry").at(-1)?.recipe.recipeId).toBe("dolce");
  });
  it("per usare ciò che scade: prima chi usa le zucchine", () => {
    expect(sortRows(rows(), "expiring")[0]?.recipe.recipeId).toBe("fritt");
  });
});

describe("applyFilters", () => {
  const all = () => buildRows([pasta, frittata, dolce], view());
  const ids = (r: { rows: { recipe: { recipeId: string } }[] }) => r.rows.map((x) => x.recipe.recipeId).sort();

  it("senza filtri non toglie niente", () => {
    expect(filtersActive(NO_FILTERS)).toBe(false);
    expect(ids(applyFilters(all(), NO_FILTERS))).toEqual(["dolce", "fritt", "pasta"]);
  });

  it("cerca in titolo, ingredienti ed etichette senza badare ad accenti e maiuscole", () => {
    expect(ids(applyFilters(all(), { ...NO_FILTERS, query: "ZUCCHINE" }))).toEqual(["fritt"]);
    expect(ids(applyFilters(all(), { ...NO_FILTERS, query: "pelati pasta" }))).toEqual(["pasta"]);
    expect(ids(applyFilters(all(), { ...NO_FILTERS, query: "veloce" }))).toEqual(["pasta"]);
  });

  it("le etichette scelte devono esserci tutte", () => {
    expect(ids(applyFilters(all(), { ...NO_FILTERS, tags: ["primo", "veloce"] }))).toEqual(["pasta"]);
    expect(ids(applyFilters(all(), { ...NO_FILTERS, tags: ["primo", "secondo"] }))).toEqual([]);
  });

  it("il tempo non toglie le ricette senza tempo indicato", () => {
    const r = applyFilters(all(), { ...NO_FILTERS, maxMinutes: 30 });
    expect(ids(r)).toEqual(["dolce", "pasta"]);
    expect(r.hidden).toBe(1);
  });

  it("l'attrezzatura posseduta toglie le ricette che richiedono altro", () => {
    expect(ids(applyFilters(all(), { ...NO_FILTERS, ownedEquipment: ["pentola", "padella"] }))).toEqual(["dolce", "pasta"]);
  });

  it("esclude allergeni e alimenti scritti a mano", () => {
    expect(ids(applyFilters(all(), { ...NO_FILTERS, allergens: ["latte"] }))).toEqual(["pasta"]);
    expect(ids(applyFilters(all(), { ...NO_FILTERS, allergens: ["glutine"] }))).toEqual(["fritt"]);
    expect(ids(applyFilters(all(), { ...NO_FILTERS, excludedFoods: ["basilico"] }))).toEqual(["dolce", "fritt"]);
  });
});

describe("disponibilità: ingredienti da confermare e di quantità non nota", () => {
  const rec = recipeOf("r", {
    servings: 1,
    ingredients: [
      { name: "Uova", quantity: { value: 2, unit: "pz" } },
      { name: "Farina", quantity: { value: 100, unit: "g" } },
      { name: "Burro", quantity: { value: 50, unit: "g" } },
      { name: "Sale" },
    ],
  });
  const { lots } = lotsOf([
    { id: "pu", name: "Pasta all'uovo", value: 500 },
    { id: "fa", name: "Farina", value: 60 },
  ]);
  const cmp = (() => {
    const r = compareWithPantry(rec, stockFromLots(lots));
    if (!r.ok) throw new Error("atteso ok");
    return r.value;
  })();

  it("un alimento solo simile non conta tra i disponibili", () => {
    const uova = cmp.items[0];
    expect(uova?.status).toBe("to_confirm");
    expect(cmp.counts.to_confirm).toBeGreaterThanOrEqual(1);
    expect(availabilityLabel(uova as never).text).toBe("da confermare");
    expect(pendingConfirmations(cmp, {}).map((i) => i.index)).toEqual([0]);
  });

  it("«sì» lo rende disponibile, «no» lo rende mancante e finisce nella spesa", () => {
    const uova = cmp.items[0] as never;
    expect(effectiveStatus(uova, "yes")).toBe("available");
    expect(effectiveStatus(uova, "no")).toBe("missing");
    expect(shortfallsWith(cmp, {}).map((s) => s.name)).toEqual(["Farina", "Burro", "Sale"]);
    const withNo = shortfallsWith(cmp, { 0: "no" });
    expect(withNo.map((s) => s.name)).toEqual(["Uova", "Farina", "Burro", "Sale"]);
    expect(withNo[0]?.quantity).toEqual({ value: 2, unit: "pz" });
    expect(shortfallsWith(cmp, { 0: "yes" }).map((s) => s.name)).toEqual(["Farina", "Burro", "Sale"]);
    expect(pendingConfirmations(cmp, { 0: "yes" })).toEqual([]);
  });

  it("dice quanto hai e quanto manca per un ingrediente parziale", () => {
    expect(availabilityLabel(cmp.items[1] as never)).toEqual({ text: "hai 60 g, mancano 40 g", tone: "partial" });
    expect(availabilityLabel(cmp.items[2] as never)).toEqual({ text: "manca", tone: "missing" });
  });

  it("presenza senza quantità conosciuta", () => {
    const stock = [{ ref: "Farina", name: "Farina", quantity: { value: 1, unit: "pz" as const } }];
    const r = compareWithPantry(recipeOf("q", { servings: 1, ingredients: [{ name: "Farina", quantity: { value: 100, unit: "g" } }] }), stock);
    if (!r.ok) throw new Error("atteso ok");
    expect(r.value.items[0]?.status).toBe("unquantified");
    expect(availabilityLabel(r.value.items[0] as never)).toEqual({ text: "c'è, quantità non confrontabile", tone: "neutral" });
  });

  it("nell'elenco i «da controllare» non contano tra quelli in casa", () => {
    const rows = buildRows([rec], pantryView(activeLots({ lots, anomalies: [], voidedEventIds: [] }), NOW));
    expect(rows[0]?.available).toBe(0);
    expect(rows[0]?.toConfirm).toBeGreaterThanOrEqual(1);
    expect(countsText(rows[0] as never)).toContain("da controllare");
  });
});
