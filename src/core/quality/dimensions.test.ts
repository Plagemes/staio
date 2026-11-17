import { describe, expect, it } from "vitest";
import {
  assessAdditives,
  assessDensity,
  assessNova,
  assessNutriScore,
  assessNutrient,
  isDrink,
} from "./dimensions";
import { product, withNutrients } from "./test-helpers";
import type { NutrientDimensionId } from "./types";

const FOOD_CASES: ReadonlyArray<readonly [NutrientDimensionId, number, number, number, number]> = [
  // dimensione, ultimo verde, primo ambra, ultimo ambra, primo rosso
  ["fat", 3, 3.1, 17.5, 17.6],
  ["saturatedFat", 1.5, 1.6, 5, 5.1],
  ["sugars", 5, 5.1, 22.5, 22.6],
  ["salt", 0.3, 0.4, 1.5, 1.6],
];

const FIELD = { fat: "fat", saturatedFat: "saturatedFat", sugars: "sugars", salt: "salt" } as const;

describe("assessNutrient: alimenti per 100 g", () => {
  for (const [id, lastGreen, firstAmber, lastAmber, firstRed] of FOOD_CASES) {
    it(`${id}: confini della tabella alimenti`, () => {
      const at = (v: number) => assessNutrient(withNutrients("1", { [FIELD[id]]: v }), id);
      expect(at(0).outcome).toBe("favorable");
      expect(at(lastGreen)).toMatchObject({ outcome: "favorable", band: "green", table: "food", per: "100g" });
      expect(at(firstAmber)).toMatchObject({ outcome: "intermediate", band: "amber" });
      expect(at(lastAmber)).toMatchObject({ outcome: "intermediate", band: "amber" });
      expect(at(firstRed)).toMatchObject({ outcome: "unfavorable", band: "red" });
    });
  }

  it("riporta soglia, valore e fonte con indirizzo", () => {
    const d = assessNutrient(withNutrients("1", { sugars: 30 }), "sugars");
    expect(d).toMatchObject({ value: 30, lowMax: 5, highAbove: 22.5, outcome: "unfavorable" });
    expect(d.sources).toHaveLength(1);
    expect(d.sources[0].url).toMatch(/^https:\/\//);
    expect(d.explanation).toContain("30");
  });
});

describe("assessNutrient: bevande per 100 ml", () => {
  const drink = (n: Parameters<typeof withNutrients>[1]) =>
    withNutrients("2", n, { per: "100ml", categories: ["beverages", "sodas"] });

  it("usa la tabella delle bevande, con soglie diverse da quelle degli alimenti", () => {
    expect(assessNutrient(drink({ sugars: 2.5 }), "sugars")).toMatchObject({ band: "green", table: "drink", per: "100ml" });
    expect(assessNutrient(drink({ sugars: 2.6 }), "sugars").band).toBe("amber");
    expect(assessNutrient(drink({ sugars: 11.25 }), "sugars").band).toBe("amber");
    expect(assessNutrient(drink({ sugars: 11.3 }), "sugars").band).toBe("red");
    expect(assessNutrient(drink({ salt: 0.75 }), "salt").band).toBe("amber");
    expect(assessNutrient(drink({ salt: 0.8 }), "salt").band).toBe("red");
    expect(assessNutrient(drink({ saturatedFat: 0.75 }), "saturatedFat").band).toBe("green");
    expect(assessNutrient(drink({ fat: 8.75 }), "fat").band).toBe("amber");
    // lo stesso 6 g sarebbe ambra per un alimento e rosso per una bevanda
    expect(assessNutrient(withNutrients("3", { sugars: 6 }), "sugars").band).toBe("amber");
    expect(assessNutrient(drink({ sugars: 11.5 }), "sugars").band).toBe("red");
  });

  it("per 100 ml senza categoria bevanda non sceglie una tabella: non valutabile", () => {
    const liquidFood = withNutrients("4", { sugars: 1 }, { per: "100ml", categories: ["dairies"] });
    expect(assessNutrient(liquidFood, "sugars")).toMatchObject({ outcome: "not_assessable", sources: [] });
    expect(isDrink(liquidFood)).toBe(false);
    expect(isDrink(drink({}))).toBe(true);
  });
});

describe("assessNutrient: dati mancanti", () => {
  const ids: NutrientDimensionId[] = ["fat", "saturatedFat", "sugars", "salt"];

  it("senza nutrienti nessuna dimensione è valutabile", () => {
    for (const id of ids) {
      const d = assessNutrient(product("5"), id);
      expect(d.outcome).toBe("not_assessable");
      expect(d.band).toBeUndefined();
      expect(d.sources).toEqual([]);
    }
  });

  it("un valore assente non vale zero: non è mai favorevole", () => {
    const p = withNutrients("6", { fat: 1 });
    expect(assessNutrient(p, "fat").outcome).toBe("favorable");
    for (const id of ["saturatedFat", "sugars", "salt"] as const) {
      expect(assessNutrient(p, id).outcome).toBe("not_assessable");
    }
  });

  it("un valore non valido (negativo, non finito) non è valutabile", () => {
    expect(assessNutrient(withNutrients("7", { salt: -1 }), "salt").outcome).toBe("not_assessable");
    expect(assessNutrient(withNutrients("7", { salt: Number.NaN }), "salt").outcome).toBe("not_assessable");
  });
});

describe("assessNutriScore", () => {
  it("usa la lettera del prodotto e dichiara l'origine", () => {
    const d = assessNutriScore(product("1", { nutriScore: "b" }));
    expect(d).toMatchObject({ outcome: "favorable", grade: "b" });
    expect(d.explanation).toContain("Open Food Facts");
    expect(d.sources[0].url).toMatch(/^http/);
  });

  it("raggruppa la scala per posizione", () => {
    const out = (g: "a" | "b" | "c" | "d" | "e") => assessNutriScore(product("1", { nutriScore: g })).outcome;
    expect([out("a"), out("b"), out("c"), out("d"), out("e")]).toEqual([
      "favorable",
      "favorable",
      "intermediate",
      "unfavorable",
      "unfavorable",
    ]);
  });

  it("senza lettera è non valutabile e non viene ricalcolato dai nutrienti", () => {
    const d = assessNutriScore(withNutrients("1", { fat: 0, sugars: 0, salt: 0, saturatedFat: 0, energyKcal: 10 }));
    expect(d).toMatchObject({ outcome: "not_assessable", sources: [] });
    expect(d.grade).toBeUndefined();
  });
});

describe("assessNova", () => {
  it("riporta il gruppo con la definizione della fonte", () => {
    const d = assessNova(product("1", { nova: 4 }));
    expect(d).toMatchObject({ outcome: "unfavorable", group: 4 });
    expect(d.explanation).toContain("ultra-processati");
    expect(d.sources.map((s) => s.url)).toContain("https://www.fao.org/3/ca5644en/ca5644en.pdf");
  });

  it("gruppi 1, 2, 3", () => {
    expect(assessNova(product("1", { nova: 1 })).outcome).toBe("favorable");
    expect(assessNova(product("1", { nova: 2 })).outcome).toBe("intermediate");
    expect(assessNova(product("1", { nova: 3 })).outcome).toBe("intermediate");
  });

  it("senza gruppo è non valutabile", () => {
    expect(assessNova(product("1"))).toMatchObject({ outcome: "not_assessable", sources: [] });
  });
});

describe("assessAdditives", () => {
  it("senza elenco: non valutabile e senza conteggio", () => {
    const d = assessAdditives(product("1"));
    expect(d.outcome).toBe("not_assessable");
    expect(d.count).toBeUndefined();
  });

  it("elenco vuoto esplicito: descrittivo, non è un dato mancante", () => {
    const d = assessAdditives(product("1", { additives: [] }));
    expect(d).toMatchObject({ kind: "descriptive", outcome: "not_assessable", count: 0, sources: [] });
    expect(d.explanation).toContain("Nessun additivo tra gli ingredienti dichiarati");
  });

  it("ingredienti analizzati e nessun additivo: descrittivo; senza l'indicazione resta non valutabile", () => {
    expect(assessAdditives(product("1"), { ingredientsAnalysed: true })).toMatchObject({ kind: "descriptive", count: 0 });
    expect(assessAdditives(product("1"), { ingredientsAnalysed: false })).toMatchObject({ kind: "graded", outcome: "not_assessable" });
    expect(assessAdditives(product("1")).kind).toBe("graded");
    expect(assessAdditives(product("1")).count).toBeUndefined();
  });

  it("ingredienti analizzati con additivi: l'elenco prevale", () => {
    const d = assessAdditives(product("1", { additives: ["E330"] }), { ingredientsAnalysed: true });
    expect(d).toMatchObject({ kind: "graded", count: 1 });
  });

  it("additivi senza dichiarazione ufficiale: solo presenza e numero, senza allarmi", () => {
    const d = assessAdditives(product("1", { additives: ["E330", "E322", "E330"] }));
    expect(d).toMatchObject({ outcome: "not_assessable", count: 2, sources: [] });
    expect(d.items.every((i) => i.statement === undefined)).toBe(true);
    expect(d.explanation).toContain("2 additivi: E330, E322");
    expect(d.explanation).toContain("nessuno di questi additivi è tra quelli");
    expect(d.explanation).not.toMatch(/mancant|non riporta/);
  });

  it("E171: non più autorizzato negli alimenti UE, con fonte", () => {
    const d = assessAdditives(product("1", { additives: ["e171", "E330"] }));
    expect(d.outcome).toBe("unfavorable");
    const item = d.items.find((i) => i.code === "E171");
    expect(item?.statement?.kind).toBe("not_authorised_in_food");
    expect(d.sources[0].url).toContain("32022R0063");
    expect(d.items.find((i) => i.code === "E330")?.statement).toBeUndefined();
  });

  it("coloranti con avvertenza obbligatoria: intermedio", () => {
    const d = assessAdditives(product("1", { additives: ["E102"] }));
    expect(d.outcome).toBe("intermediate");
    expect(d.explanation).toContain("bambini");
    expect(d.sources[0].url).toContain("32008R1333");
  });

  it("il peggiore prevale", () => {
    expect(assessAdditives(product("1", { additives: ["E110", "E171"] })).outcome).toBe("unfavorable");
  });
});

describe("assessDensity", () => {
  it("proteine e fibre per 100 kcal, descrittivo e senza esito", () => {
    const d = assessDensity(withNutrients("1", { energyKcal: 200, proteins: 10, fiber: 4 }));
    expect(d).toMatchObject({ kind: "descriptive", proteinGPer100Kcal: 5, fiberGPer100Kcal: 2, outcome: "not_assessable", sources: [] });
  });

  it("un solo dato disponibile", () => {
    const d = assessDensity(withNutrients("1", { energyKcal: 50, proteins: 5 }));
    expect(d.proteinGPer100Kcal).toBe(10);
    expect(d.fiberGPer100Kcal).toBeUndefined();
  });

  it("senza energia o con energia zero non si calcola", () => {
    expect(assessDensity(withNutrients("1", { proteins: 5, fiber: 1 })).proteinGPer100Kcal).toBeUndefined();
    expect(assessDensity(withNutrients("1", { energyKcal: 0, proteins: 5 })).proteinGPer100Kcal).toBeUndefined();
    expect(assessDensity(product("1")).fiberGPer100Kcal).toBeUndefined();
  });
});
