import { describe, expect, it } from "vitest";
import { allergensOfIngredient, exclusionReasons, filterRecipes, totalMinutes, type Filterable } from "./filters";

const r = (title: string, extra: Partial<Filterable> = {}, names: string[] = ["Acqua"]): Filterable => ({
  title,
  ingredients: names.map((name) => ({ name })),
  ...extra,
});

describe("totalMinutes", () => {
  it("usa totale, poi preparazione più cottura, poi i passi", () => {
    expect(totalMinutes({ times: { totalMinutes: 45, prepMinutes: 10 } })).toBe(45);
    expect(totalMinutes({ times: { prepMinutes: 10, cookMinutes: 20 } })).toBe(30);
    expect(totalMinutes({ times: { cookMinutes: 20 } })).toBe(20);
    expect(totalMinutes({ steps: [{ text: "a", durationMinutes: 5 }, { text: "b" }, { text: "c", durationMinutes: 7 }] })).toBe(12);
    expect(totalMinutes({})).toBeUndefined();
  });
});

describe("filterRecipes", () => {
  it("filtra per tempo disponibile e decide sui tempi ignoti", () => {
    const list = [
      r("Veloce", { times: { totalMinutes: 15 } }),
      r("Lenta", { times: { totalMinutes: 120 } }),
      r("Boh"),
    ];
    const keep = filterRecipes(list, { maxMinutes: 30 });
    expect(keep.kept.map((x) => x.title)).toEqual(["Veloce", "Boh"]);
    expect(keep.excluded[0]?.reasons).toEqual([{ code: "too_long", minutes: 120, maxMinutes: 30 }]);
    const strict = filterRecipes(list, { maxMinutes: 30, unknownTime: "exclude" });
    expect(strict.kept.map((x) => x.title)).toEqual(["Veloce"]);
    expect(strict.excluded.map((x) => x.reasons[0]?.code)).toEqual(["too_long", "time_unknown"]);
  });

  it("richiede tutta l'attrezzatura, anche con nomi un po' diversi", () => {
    const list = [
      r("Torta", { equipment: ["forno", "frullatore"] }),
      r("Insalata", { equipment: [] }),
      r("Arrosto", { equipment: ["Forno ventilato"] }),
    ];
    const res = filterRecipes(list, { ownedEquipment: ["forno", "padella"] });
    expect(res.kept.map((x) => x.title)).toEqual(["Insalata", "Arrosto"]);
    expect(res.excluded[0]?.reasons).toEqual([{ code: "missing_equipment", equipment: ["frullatore"] }]);
    expect(filterRecipes(list, { ownedEquipment: [] }).kept.map((x) => x.title)).toEqual(["Insalata"]);
  });

  it("esclude gli alimenti per nome o per foodId", () => {
    const list = [
      r("Pesto", {}, ["Basilico", "Pinoli", "Olio extravergine di oliva"]),
      r("Aglio e olio", {}, ["Spaghetti", "Aglio", "Olio"]),
    ];
    expect(filterRecipes(list, { excludedFoods: ["aglio"] }).kept.map((x) => x.title)).toEqual(["Pesto"]);
    expect(filterRecipes(list, { excludedFoods: ["olio"] }).kept).toEqual([]);
    const withId: Filterable = {
      title: "X",
      ingredients: [{ name: "Spaghetti", foodId: "pasta-semola-secca" }],
    };
    expect(filterRecipes([withId], { excludedFoods: [{ foodId: "pasta-semola-secca" }] }).kept).toEqual([]);
    expect(filterRecipes([withId], { excludedFoods: [{ foodId: "riso" }] }).kept).toHaveLength(1);
  });

  it("riconosce gli allergeni dal nome dell'ingrediente", () => {
    expect(allergensOfIngredient({ name: "Farina 00" })).toContain("glutine");
    expect(allergensOfIngredient({ name: "Parmigiano reggiano" })).toContain("latte");
    expect(allergensOfIngredient({ name: "Tuorli" })).toContain("uova");
    expect(allergensOfIngredient({ name: "Gamberi" })).toContain("crostacei");
    expect(allergensOfIngredient({ name: "Noce moscata" })).not.toContain("frutta a guscio");
    expect(allergensOfIngredient({ name: "Noci" })).toContain("frutta a guscio");
    expect(allergensOfIngredient({ name: "Melanzana (eggplant)" })).not.toContain("uova");
    expect(allergensOfIngredient({ name: "Pomodori" })).toEqual([]);
  });

  it("esclude per allergene, con alias e con dati esterni", () => {
    const list = [
      r("Torta", {}, ["Farina", "Burro", "Uova"]),
      r("Insalata", {}, ["Lattuga", "Pomodori"]),
      r("Cena", {}, ["Salsiccia", "Zuppa di Ceci"]),
    ];
    const res = filterRecipes(list, { allergens: ["lattosio", "glutine"] });
    expect(res.kept.map((x) => x.title)).toEqual(["Insalata", "Cena"]);
    expect(res.excluded[0]?.reasons).toEqual([
      { code: "allergen", allergen: "latte", ingredients: ["Burro"] },
      { code: "allergen", allergen: "glutine", ingredients: ["Farina"] },
    ]);
    const ext = filterRecipes(list, {
      allergens: ["soia"],
      allergensOf: (i) => (i.name === "Salsiccia" ? ["soia"] : undefined),
    });
    expect(ext.kept.map((x) => x.title)).toEqual(["Torta", "Insalata"]);
  });

  it("un allergene sconosciuto si cerca come parola", () => {
    const res = filterRecipes([r("Kiwi", {}, ["Kiwi maturi"]), r("Mela", {}, ["Mele"])], { allergens: ["kiwi"] });
    expect(res.kept.map((x) => x.title)).toEqual(["Mela"]);
  });

  it("combina i criteri e conserva l'ordine", () => {
    const list = [
      r("A", { times: { totalMinutes: 90 }, equipment: ["forno"] }, ["Latte"]),
      r("B", { times: { totalMinutes: 10 } }, ["Mela"]),
    ];
    const reasons = exclusionReasons(list[0] as Filterable, {
      maxMinutes: 30,
      ownedEquipment: [],
      allergens: ["latte"],
    });
    expect(reasons.map((x) => x.code)).toEqual(["too_long", "missing_equipment", "allergen"]);
    expect(filterRecipes(list, {}).kept).toEqual(list);
  });
});
