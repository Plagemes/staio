import { describe, expect, it } from "vitest";
import type { Advice, AdviceAction } from "../types";
import { adviceKey, briefingAdvice, buildAdvice, type MaybeClearRecipe } from "./engine";
import { CURRENT, LAST_CLOSED, TODAY, history, ind, input, pantry, recipe } from "./test-helpers";

const legumesLow = () => history({ indicators: [ind("group:legumes", "below", 1)] });
const byRule = (advice: readonly Advice[], id: string) => advice.find((a) => a.ruleId === id);
const kinds = (a: Advice | undefined) => a?.actions.map((x: AdviceAction) => x.kind);

describe("adviceKey", () => {
  it("regola più lunedì", () => {
    expect(adviceKey("legumesLow", "2026-11-16")).toBe("diet:legumesLow:2026-11-16");
  });
});

describe("buildAdvice", () => {
  it("fatto dall'ultima settimana chiusa, azioni sulla settimana in corso", () => {
    const { advice } = buildAdvice(input(legumesLow()));
    expect(advice).toHaveLength(1);
    const a = advice[0];
    expect(a.key).toBe(`diet:legumesLow:${LAST_CLOSED}`);
    expect(a.weekStart).toBe(LAST_CLOSED);
    expect(a.targetWeekStart).toBe(CURRENT);
    expect(a.fact.indicator.id).toBe("group:legumes");
    expect(a.fact.progress).toEqual({ value: 3, daysElapsed: 3 });
    expect(a.source).toBe("crea-lg-2018");
  });

  it("un quadro calmo non produce consigli", () => {
    const r = buildAdvice(input(history()));
    expect(r.advice).toEqual([]);
    expect(r.skipped.every((s) => s.reason === "not_triggered")).toBe(true);
  });

  it("nessun consiglio con dati insufficienti", () => {
    const h = history({
      daysWithData: 2,
      indicators: [ind("group:legumes", "below", 0), ind("salt", "above", 9), ind("group:redMeat", "above", 4)],
    });
    const r = buildAdvice(input(h));
    expect(r.advice).toEqual([]);
    expect(r.skipped.find((s) => s.ruleId === "legumesLow")?.reason).toBe("insufficient");
    const low = buildAdvice(input(history({ coverage: 0.4, indicators: [ind("group:fish", "below", 0)] })));
    expect(low.advice).toEqual([]);
  });

  it("senza settimane chiuse nessun consiglio di «aumentare»", () => {
    const h = legumesLow();
    const r = buildAdvice(input({ ...h, weeks: h.weeks.slice(-1) }));
    expect(r.advice).toEqual([]);
  });

  it("«decrease» sui conteggi può scattare sulla settimana in corso", () => {
    const h = history({}, { current: { daysWithData: 4, indicators: [ind("group:redMeat", "above", 3, { lowerBound: true })] } });
    const a = byRule(buildAdvice(input(h)).advice, "redMeatHigh");
    expect(a?.weekStart).toBe(CURRENT);
    expect(a?.key).toBe(`diet:redMeatHigh:${CURRENT}`);
    expect(a?.fact.progress).toBeUndefined();
    // Il sale non è un conteggio: non scatta sulla settimana in corso.
    const salt = history({}, { current: { daysWithData: 4, indicators: [ind("salt", "above", 9)] } });
    expect(buildAdvice(input(salt)).advice).toEqual([]);
  });

  it("al massimo 3, ordinati per priorità; maxAdvice si rispetta", () => {
    const h = history({
      indicators: [
        ind("group:legumes", "below", 0),
        ind("group:fish", "below", 0),
        ind("group:nutsSeeds", "below", 0),
        ind("fiber", "below", 10),
        ind("salt", "above", 9),
      ],
    });
    const { advice } = buildAdvice(input(h));
    expect(advice).toHaveLength(3);
    for (let i = 1; i < advice.length; i++) expect(advice[i - 1].priority).toBeGreaterThanOrEqual(advice[i].priority);
    expect(buildAdvice(input(h, { maxAdvice: 1 })).advice).toHaveLength(1);
    expect(buildAdvice(input(h, { maxAdvice: 0 })).advice).toHaveLength(0);
  });

  it("priorità = severità × fattibilità × certezza; a parità vince la chiave più bassa", () => {
    const h = history({
      indicators: [ind("group:legumes", "below", 0), ind("group:fish", "below", 0, { certainty: "estimated" })],
    });
    const { advice } = buildAdvice(input(h, { pantry: [pantry("Ceci", "legumes"), pantry("Sgombro", "fish")] }));
    expect(byRule(advice, "legumesLow")?.priority).toBeCloseTo(1 * 1 * 1);
    expect(byRule(advice, "fishLow")?.priority).toBeCloseTo(1 * 1 * 0.75);
    expect(advice[0].ruleId).toBe("legumesLow");

    // Parità esatta: fish (chiave «diet:fishLow») prima di legumes.
    const tie = history({ indicators: [ind("group:legumes", "below", 0), ind("group:fish", "below", 0)] });
    expect(buildAdvice(input(tie)).advice.map((a) => a.ruleId)).toEqual(["fishLow", "legumesLow"]);
  });

  it("la fattibilità alza un consiglio con la dispensa sopra uno solo da guardare", () => {
    const h = history({ indicators: [ind("group:legumes", "below", 1), ind("salt", "above", 9)] });
    const { advice } = buildAdvice(input(h, { pantry: [pantry("Ceci", "legumes")] }));
    expect(advice[0].ruleId).toBe("legumesLow");
    expect(kinds(byRule(advice, "saltHigh"))).toEqual(["openDetail"]);
    expect(briefingAdvice(advice)?.ruleId).toBe("legumesLow");
    expect(briefingAdvice(advice.filter((a) => a.ruleId === "saltHigh"))).toBeUndefined();
  });

  describe("azioni", () => {
    it("increase: dispensa che scade prima, poi ricetta in casa; al massimo 2", () => {
      const r = buildAdvice(
        input(legumesLow(), {
          pantry: [
            pantry("Lenticchie", "legumes", "2027-03-01"),
            pantry("Ceci", "legumes", "2026-12-01"),
            pantry("Fagioli scaduti", "legumes", "2026-11-20"),
            pantry("Pane", "refinedGrains", "2026-11-26"),
          ],
          recipes: [recipe("r1", ["legumes", "refinedGrains"], 0.3), recipe("r2", ["legumes"], 0.8)],
        }),
      );
      const a = r.advice[0];
      expect(a.actions).toHaveLength(2);
      expect(a.actions[0]).toEqual({ kind: "cookWithPantry", foodName: "Ceci", lotIds: ["Ceci"], expiresOn: "2026-12-01" });
      expect(a.actions[1]).toEqual({ kind: "openRecipe", recipeId: "r2", title: "Ricetta r2", inHomeShare: 0.8 });
    });

    it("increase: senza dispensa, piano e poi spesa; mai due azioni sulla stessa ricetta", () => {
      const a = buildAdvice(input(legumesLow(), { recipes: [recipe("r1", ["legumes"], 0.1)] })).advice[0];
      expect(a.actions).toEqual([
        { kind: "addToPlan", recipeId: "r1", title: "Ricetta r1", servings: 2 },
        { kind: "addToShopping", names: ["lenticchie"] },
      ]);
    });

    it("increase: la spesa non ripete un nome già in lista", () => {
      const a = buildAdvice(input(legumesLow(), { shoppingNames: ["Lenticchie "] })).advice[0];
      expect(kinds(a)).toEqual(["openDetail"]);
      const veg = buildAdvice(
        input(history({ indicators: [ind("vegFruit", "below", 200)] }), { shoppingNames: ["verdura di stagione"] }),
      ).advice[0];
      expect(veg.actions).toEqual([{ kind: "addToShopping", names: ["frutta di stagione"] }]);
    });

    it("decrease: alternativa nota più consumata, poi ricetta di ricambio senza il gruppo da evitare", () => {
      const h = history({ indicators: [ind("group:cakesIceCream", "occasional", 5)] });
      const a = buildAdvice(
        input(h, {
          alternatives: [
            { fromBarcode: "1", fromName: "Merendina A", toBarcode: "2", toName: "B", dimension: "sugars", fromShare: 0.2 },
            { fromBarcode: "3", fromName: "Merendina C", toBarcode: "4", toName: "D", dimension: "sugars", fromShare: 0.6 },
            { fromBarcode: "5", fromName: "Cracker", toBarcode: "6", toName: "E", dimension: "salt", fromShare: 0.9 },
          ],
          recipes: [recipe("torta", ["fruit", "sweets"], 0.9), recipe("macedonia", ["fruit"], 0.4)],
        }),
      ).advice[0];
      expect(a.ruleId).toBe("sweetsDrinksOften");
      expect(a.actions[0]).toMatchObject({ kind: "seeAlternative", fromBarcode: "3", dimension: "sugars" });
      expect(a.actions[1]).toMatchObject({ kind: "openRecipe", recipeId: "macedonia" });
    });

    it("carne rossa: ricetta di pesce o legumi, fonte CREA anche se l'indicazione dice altro", () => {
      const h = history({
        indicators: [
          ind("group:redMeat", "above", 4, {
            target: { kind: "perWeek", max: 1, row: "redMeat", source: "who-healthy-diet", where: "t" },
          }),
        ],
      });
      const a = buildAdvice(
        input(h, { recipes: [recipe("ragu", ["redMeat", "legumes"], 1), recipe("zuppa", ["legumes"], 0.6)] }),
      ).advice[0];
      expect(a.source).toBe("crea-lg-2018");
      expect(a.actions).toEqual([{ kind: "openRecipe", recipeId: "zuppa", title: "Ricetta zuppa", inHomeShare: 0.6 }]);
    });

    it("ricette non «clear» mai proposte", () => {
      const notClear: MaybeClearRecipe = { ...recipe("arachidi", ["legumes"], 1), clear: false };
      const a = buildAdvice(input(legumesLow(), { recipes: [notClear, recipe("ok", ["legumes"], 0.1)] })).advice[0];
      const ids = a.actions.flatMap((x) => ("recipeId" in x ? [x.recipeId] : []));
      expect(ids).not.toContain("arachidi");
      expect(ids).toContain("ok");
    });
  });

  describe("«Lascia così»", () => {
    it("la chiave lasciata così toglie il consiglio", () => {
      const r = buildAdvice(input(legumesLow(), { dismissed: [`diet:legumesLow:${LAST_CLOSED}`] }));
      expect(r.advice).toEqual([]);
      expect(r.skipped.find((s) => s.ruleId === "legumesLow")?.reason).toBe("dismissed");
    });

    it("vale solo per quella settimana", () => {
      const r = buildAdvice(input(legumesLow(), { dismissed: ["diet:legumesLow:2026-11-09"] }));
      expect(r.advice).toHaveLength(1);
    });

    it("lasciata così la settimana chiusa, non torna sulla settimana in corso", () => {
      const h = history({}, { current: { daysWithData: 4, indicators: [ind("group:redMeat", "above", 3)] } });
      const r = buildAdvice(input(h, { dismissed: [`diet:redMeatHigh:${LAST_CLOSED}`] }));
      expect(r.advice).toEqual([]);
    });
  });

  describe("already_planned", () => {
    it("il piano più il mangiato colmano la lacuna", () => {
      const planned = { weekStart: CURRENT, servingsByGroup: { legumes: 1 }, entriesByGroup: { legumes: 1 }, unresolved: 0 };
      const h = history({ indicators: [ind("group:legumes", "below", 0)] }, { current: { servings: { legumes: 1 } } });
      const r = buildAdvice(input(h, { planned }));
      expect(r.advice).toEqual([]);
      expect(r.skipped.find((s) => s.ruleId === "legumesLow")?.reason).toBe("already_planned");
    });

    it("se il piano non basta il consiglio resta e porta le porzioni pianificate", () => {
      const planned = { weekStart: CURRENT, servingsByGroup: { legumes: 1 }, entriesByGroup: { legumes: 1 }, unresolved: 0 };
      const a = buildAdvice(input(legumesLow(), { planned })).advice[0];
      expect(a.fact.planned).toBe(1);
    });

    it("un piano di un'altra settimana non conta", () => {
      const planned = { weekStart: LAST_CLOSED, servingsByGroup: { legumes: 9 }, entriesByGroup: { legumes: 9 }, unresolved: 0 };
      const a = buildAdvice(input(legumesLow(), { planned })).advice[0];
      expect(a.ruleId).toBe("legumesLow");
      expect(a.fact.planned).toBeUndefined();
    });
  });

  it("una regola per indicatore, nessun consiglio su alcol o latte", () => {
    const h = history({
      indicators: [ind("group:alcohol", "occasional", 20), ind("group:milkYogurt", "below", 0)],
    });
    expect(buildAdvice(input(h)).advice).toEqual([]);
    const all = history({
      indicators: [
        ind("group:legumes", "below", 0),
        ind("group:fish", "below", 0),
        ind("salt", "above", 9),
        ind("group:redMeat", "above", 4),
        ind("group:sugaryDrinks", "occasional", 5),
      ],
    });
    const ids = buildAdvice(input(all, { maxAdvice: 20 })).advice.map((a) => a.fact.indicator.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("deterministico: stesso ingresso, stesso risultato, anche con l'ordine degli ingressi cambiato", () => {
    const h = history({ indicators: [ind("group:legumes", "below", 0), ind("group:fish", "below", 1), ind("salt", "above", 7)] });
    const pantryList = [pantry("Ceci", "legumes", "2026-12-01", "a"), pantry("Ceci", "legumes", "2026-12-01", "b"), pantry("Tonno", "fish")];
    const recipes = [recipe("x", ["fish"], 0.5), recipe("y", ["fish"], 0.5), recipe("z", ["legumes"], 0.7)];
    const one = buildAdvice(input(h, { pantry: pantryList, recipes, today: TODAY }));
    const two = buildAdvice(input(h, { pantry: [...pantryList].reverse(), recipes: [...recipes].reverse(), today: TODAY }));
    expect(two).toEqual(one);
    expect(JSON.stringify(buildAdvice(input(h, { pantry: pantryList, recipes })))).toBe(JSON.stringify(one));
  });
});
