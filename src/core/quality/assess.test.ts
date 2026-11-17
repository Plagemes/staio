import { describe, expect, it } from "vitest";
import { assessProduct, dimensionOf, summarize } from "./assess";
import { ADDITIVE_STATEMENTS } from "./data/additives";
import { NOVA_DEFINITIONS } from "./data/definitions";
import { TRAFFIC_LIGHT_TABLES } from "./data/thresholds";
import { product, withNutrients } from "./test-helpers";

describe("assessProduct", () => {
  it("un prodotto senza dati: tutte le dimensioni con giudizio non sono valutabili", () => {
    const a = assessProduct(product("1"));
    expect(a.dimensions).toHaveLength(8);
    expect(a.summary).toMatchObject({
      favorable: 0,
      intermediate: 0,
      unfavorable: 0,
      notAssessable: 7,
      graded: 7,
      descriptive: 1,
    });
  });

  it("prodotto completo: elenco di esiti e nessun punteggio unico", () => {
    const p = withNutrients(
      "2",
      { energyKcal: 400, proteins: 8, fiber: 2, fat: 20, saturatedFat: 1, sugars: 10, salt: 0.1 },
      { nutriScore: "d", nova: 4, additives: ["E330", "E171"] },
    );
    const a = assessProduct(p);
    expect(a.summary).toMatchObject({ favorable: 2, intermediate: 1, unfavorable: 4, notAssessable: 0, graded: 7 });
    expect(a.summary.text).toBe("2 favorevoli, 1 intermedia, 4 sfavorevoli, 0 non valutabili su 7 dimensioni con giudizio.");
    expect(Object.keys(a)).not.toContain("score");
    expect(dimensionOf(a, "fat")?.outcome).toBe("unfavorable");
    expect(dimensionOf(a, "nutrientDensity")?.kind).toBe("descriptive");
  });

  it("la densità descrittiva non entra nei conteggi dei giudizi", () => {
    const a = assessProduct(withNutrients("3", { energyKcal: 100, proteins: 1 }));
    expect(dimensionOf(a, "nutrientDensity")?.proteinGPer100Kcal).toBe(1);
    expect(a.summary.notAssessable).toBe(7);
    expect(a.summary.graded).toBe(7);
    expect(a.summary.descriptive).toBe(1);
  });

  it("zero additivi dichiarati non gonfia i non valutabili", () => {
    const a = assessProduct(product("5", { additives: [] }));
    expect(a.summary).toMatchObject({ notAssessable: 6, graded: 6, descriptive: 2 });
    expect(dimensionOf(a, "additives")?.kind).toBe("descriptive");
    const unknown = assessProduct(product("6"));
    expect(unknown.summary).toMatchObject({ notAssessable: 7, graded: 7, descriptive: 1 });
    expect(assessProduct(product("7"), { ingredientsAnalysed: true }).summary.notAssessable).toBe(6);
  });

  it("concordanza al singolare e al plurale per ogni esito", () => {
    const one = assessProduct(
      withNutrients("8", { fat: 1 }, { nutriScore: "c", nova: 4 }),
    );
    // fat favorevole, nutriScore intermedia, nova sfavorevole, le altre 4 non valutabili
    expect(one.summary.text).toBe("1 favorevole, 1 intermedia, 1 sfavorevole, 4 non valutabili su 7 dimensioni con giudizio.");
    const none = summarize([]);
    expect(none.text).toBe("0 favorevoli, 0 intermedie, 0 sfavorevoli, 0 non valutabili su 0 dimensioni con giudizio.");
    const single = summarize(assessProduct(product("9")).dimensions.slice(0, 1));
    expect(single.text).toBe("0 favorevoli, 0 intermedie, 0 sfavorevoli, 1 non valutabile su 1 dimensione con giudizio.");
  });

  it("summarize conta solo le dimensioni con giudizio", () => {
    const s = summarize(assessProduct(product("4")).dimensions.slice(0, 2));
    expect(s.graded).toBe(2);
  });
});

describe("dati con fonte", () => {
  it("ogni tabella di soglie ha soglie ordinate e positive", () => {
    for (const table of Object.values(TRAFFIC_LIGHT_TABLES)) {
      for (const c of Object.values(table.cutoffs)) {
        expect(c.lowMax).toBeGreaterThan(0);
        expect(c.highAbove).toBeGreaterThan(c.lowMax);
      }
    }
  });

  it("le soglie delle bevande non superano quelle degli alimenti", () => {
    for (const id of ["fat", "saturatedFat", "sugars", "salt"] as const) {
      expect(TRAFFIC_LIGHT_TABLES.drink.cutoffs[id].highAbove).toBeLessThanOrEqual(TRAFFIC_LIGHT_TABLES.food.cutoffs[id].highAbove);
    }
  });

  it("ogni dichiarazione sugli additivi ha fonte con indirizzo", () => {
    for (const s of ADDITIVE_STATEMENTS) {
      expect(s.code).toMatch(/^E\d{3}$/);
      expect(s.source.url).toMatch(/^https:\/\/eur-lex\.europa\.eu\//);
      expect(s.text.length).toBeGreaterThan(20);
    }
    expect(new Set(ADDITIVE_STATEMENTS.map((s) => s.code)).size).toBe(ADDITIVE_STATEMENTS.length);
  });

  it("i quattro gruppi NOVA hanno definizione e motivazione", () => {
    for (const g of [1, 2, 3, 4] as const) {
      expect(NOVA_DEFINITIONS[g].definition.length).toBeGreaterThan(40);
      expect(NOVA_DEFINITIONS[g].basis).toContain("FAO");
    }
  });
});
