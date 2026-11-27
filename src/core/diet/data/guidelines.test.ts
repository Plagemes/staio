import { describe, expect, it } from "vitest";
import {
  ENERGY_LEVELS,
  GUIDELINE_ROW_IDS,
  PORTION_KEYS,
  SOURCE_IDS,
  type EnergyLevel,
  type GuidelineRowId,
} from "../types";
import { DEFAULT_LEVEL, GUIDELINE_ROWS, PORTIONS, guidelineRow, targetFor } from "./guidelines";
import { DIET_SOURCES } from "./sources";

const QUALITATIVE = ["occasional", "notAdvised"];
const FORBIDDEN = /\b(devi|dovresti|sano|sani|voto|punteggio)\b/i;

describe("DIET_SOURCES", () => {
  it("ha tutte le fonti, con l'id uguale alla chiave", () => {
    for (const id of SOURCE_IDS) {
      expect(DIET_SOURCES[id].id).toBe(id);
      expect(DIET_SOURCES[id].body).not.toBe("");
      expect(DIET_SOURCES[id].document).not.toBe("");
      expect(DIET_SOURCES[id].consultedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("segna come non verificata la fonte NOVA FAO e come verificate quelle lette", () => {
    expect(DIET_SOURCES["nova-fao-2019"].verified).toBe(false);
    expect(DIET_SOURCES["crea-lg-2018"].verified).toBe(true);
    expect(DIET_SOURCES["who-sugars-2015"].verified).toBe(true);
  });

  it("ha un indirizzo per ogni fonte esterna verificata", () => {
    for (const id of SOURCE_IDS) {
      if (id !== "app" && DIET_SOURCES[id].verified) expect(DIET_SOURCES[id].url).toMatch(/^https:\/\//);
    }
  });
});

describe("GUIDELINE_ROWS", () => {
  it("ha una riga per ogni id, senza doppioni", () => {
    expect(GUIDELINE_ROWS.map((r) => r.id).sort()).toEqual([...GUIDELINE_ROW_IDS].sort());
  });

  it("ogni riga ha fonte, punto della fonte e frase non vuoti", () => {
    for (const row of GUIDELINE_ROWS) {
      expect(SOURCE_IDS).toContain(row.source);
      expect(row.where.trim(), row.id).not.toBe("");
      expect(row.quote.trim(), row.id).not.toBe("");
      expect(["read", "interpretation"]).toContain(row.reading);
    }
  });

  it("byLevel c'è per i tipi numerici e manca per quelli qualitativi", () => {
    for (const row of GUIDELINE_ROWS) {
      if (QUALITATIVE.includes(row.kind)) {
        expect(row.byLevel, row.id).toBeUndefined();
        expect(row.textRange, row.id).toBeUndefined();
      } else {
        expect(row.byLevel, row.id).toBeDefined();
        for (const level of ENERGY_LEVELS) expect(row.byLevel?.[level], `${row.id} ${level}`).not.toBeUndefined();
      }
    }
  });

  it("nessun minimo supera il massimo", () => {
    for (const row of GUIDELINE_ROWS) {
      const bounds = [...Object.values(row.byLevel ?? {}), row.textRange];
      for (const b of bounds) {
        if (b && b.min !== undefined && b.max !== undefined) expect(b.min, row.id).toBeLessThanOrEqual(b.max);
      }
    }
  });

  it("le righe con tetto hanno un tipo coerente", () => {
    for (const row of GUIDELINE_ROWS) {
      if (row.kind.startsWith("max") || row.kind.endsWith("Max")) {
        for (const level of ENERGY_LEVELS) {
          const b = row.byLevel?.[level];
          expect(b?.max, `${row.id} ${level}`).not.toBeUndefined();
        }
      }
    }
  });

  it("le righe che contano porzioni hanno almeno un gruppo e le chiavi esistono", () => {
    for (const row of GUIDELINE_ROWS) {
      if (row.groups.length === 0) continue;
      for (const key of row.portionKeys ?? []) expect(PORTION_KEYS).toContain(key);
    }
    expect(guidelineRow("salt")?.groups).toEqual([]);
  });

  it("nessun testo contiene parole vietate", () => {
    for (const row of GUIDELINE_ROWS) {
      expect(row.quote, row.id).not.toMatch(FORBIDDEN);
      expect(row.note ?? "", row.id).not.toMatch(FORBIDDEN);
      expect(row.where, row.id).not.toMatch(FORBIDDEN);
    }
  });

  it("le letture di celle unite sono marcate come interpretazione", () => {
    const interpreted = GUIDELINE_ROWS.filter((r) => r.reading === "interpretation").map((r) => r.id);
    expect(interpreted.sort()).toEqual(
      [
        "vegetables",
        "fruit",
        "milkYogurt",
        "cheese",
        "legumes",
        "redMeat",
        "breadSubstitutes",
        "sweetBakery",
        "breakfastCereals",
        "fishPreserved",
      ].sort(),
    );
  });
});

describe("PORTIONS", () => {
  it("ogni PortionKey ha una porzione positiva con fonte e punto", () => {
    for (const key of PORTION_KEYS) {
      const p = PORTIONS[key];
      expect(p.key).toBe(key);
      expect(p.amount).toBeGreaterThan(0);
      expect(["g", "ml"]).toContain(p.unit);
      expect(["raw", "ready"]).toContain(p.basis);
      expect(p.where.trim()).not.toBe("");
      expect(p.source).toBe("crea-lg-2018");
    }
  });
});

describe("targetFor", () => {
  it("preferisce textRange a byLevel", () => {
    expect(targetFor("eggs", 1500)).toMatchObject({ kind: "perWeek", min: 2, max: 4, where: "testo, p. 127" });
    expect(targetFor("eggs", 2500)).toMatchObject({ min: 2, max: 4 });
    expect(targetFor("legumes", 2000)).toMatchObject({ min: 2, where: "cap. 3, p. 59" });
    expect(targetFor("legumes", 2000)?.max).toBeUndefined();
  });

  it("usa byLevel quando non c'è textRange e porta fonte e riga", () => {
    expect(targetFor("vegetables", 2500)).toEqual({
      kind: "perDay",
      row: "vegetables",
      source: "crea-lg-2018",
      where: expect.stringContaining("p. 131"),
      min: 3,
    });
    expect(targetFor("redMeat", 2000)).toMatchObject({ kind: "maxPerWeek", max: 1 });
  });

  it("è undefined per i tipi qualitativi", () => {
    for (const id of ["processedMeat", "cakesIceCream", "snacksChocolate", "sugaryDrinks", "alcohol"] as const) {
      for (const level of ENERGY_LEVELS) expect(targetFor(id, level), id).toBeUndefined();
    }
  });

  it("risolve le righe di misura", () => {
    expect(targetFor("salt", DEFAULT_LEVEL)).toMatchObject({ kind: "gramsPerDayMax", max: 5, source: "crea-lg-2018" });
    expect(targetFor("freeSugars", DEFAULT_LEVEL)).toMatchObject({
      kind: "percentEnergyMax",
      max: 10,
      source: "who-sugars-2015",
    });
    expect(targetFor("fiber", DEFAULT_LEVEL)).toMatchObject({ kind: "gramsPerDayMin", min: 25, source: "efsa-drv" });
    expect(targetFor("vegFruitTotal", DEFAULT_LEVEL)).toMatchObject({ min: 400 });
    expect(targetFor("wholeGrainShare", DEFAULT_LEVEL)).toMatchObject({ kind: "shareMin", min: 0.5 });
  });

  it("è undefined per un livello fuori elenco", () => {
    expect(targetFor("bread", 1800 as EnergyLevel)).toBeUndefined();
  });

  it("il livello predefinito è 2000", () => {
    expect(DEFAULT_LEVEL).toBe(2000);
  });
});

// Istantanea dei numeri, copiata da FONTI-LINEE-GUIDA.md (1500 / 2000 / 2500 kcal). Chi cambia un valore in
// guidelines.ts deve aggiornare anche questa tabella e `core/diet/FONTI.md`.
type Triple = readonly [number, number, number];
const MIN_SNAPSHOT: Partial<Record<GuidelineRowId, Triple>> = {
  vegetables: [2.5, 2.5, 3],
  fruit: [2, 3, 3],
  bread: [2.5, 3.5, 4.5],
  grains: [1, 1.5, 1.5],
  potatoes: [1, 2, 2],
  legumes: [3, 3, 3],
  fish: [2, 2, 3],
  whiteMeat: [1, 2, 3],
  eggs: [2, 3, 4],
  milkYogurt: [3, 3, 3],
  cheese: [3, 3, 3],
  oilsFats: [2, 3, 4],
  nutsSeeds: [1, 2, 2.5],
  vegFruitTotal: [400, 400, 400],
  wholeGrainShare: [0.5, 0.5, 0.5],
  fiber: [25, 25, 25],
};
const MAX_SNAPSHOT: Partial<Record<GuidelineRowId, Triple>> = {
  breadSubstitutes: [1, 1, 1],
  sweetBakery: [0.5, 2, 2],
  breakfastCereals: [0.5, 2, 3],
  fishPreserved: [0, 1, 1],
  redMeat: [1, 1, 1],
  sugar: [1, 1.5, 2],
  honeyJam: [1, 2, 2],
  salt: [5, 5, 5],
  freeSugars: [10, 10, 10],
};
const PORTION_SNAPSHOT: Record<(typeof PORTION_KEYS)[number], number> = {
  vegetables: 200,
  leafySalad: 80,
  fruit: 150,
  driedFruit: 30,
  bread: 50,
  grains: 80,
  freshEggPasta: 100,
  breadSubstitutes: 30,
  sweetBakery: 50,
  breakfastCereals: 30,
  potatoes: 200,
  legumes: 150,
  legumesDry: 50,
  soy: 100,
  fish: 150,
  fishPreserved: 50,
  whiteMeat: 100,
  redMeat: 100,
  processedMeat: 50,
  eggs: 50,
  milk: 125,
  yogurt: 125,
  cheeseFresh: 100,
  cheeseAged: 50,
  oil: 10,
  butter: 10,
  nutsSeeds: 30,
  cakes: 100,
  snacks: 30,
  spreads: 15,
  sugaryDrinks: 200,
  sugar: 5,
  honeyJam: 20,
};

describe("istantanea dei numeri (FONTI-LINEE-GUIDA.md)", () => {
  it("frequenze minime per livello", () => {
    for (const [id, values] of Object.entries(MIN_SNAPSHOT) as [GuidelineRowId, Triple][]) {
      const row = guidelineRow(id);
      ENERGY_LEVELS.forEach((level, i) => expect(row?.byLevel?.[level]?.min, `${id} ${level}`).toBe(values[i]));
    }
  });

  it("massimi per livello", () => {
    for (const [id, values] of Object.entries(MAX_SNAPSHOT) as [GuidelineRowId, Triple][]) {
      const row = guidelineRow(id);
      ENERGY_LEVELS.forEach((level, i) => expect(row?.byLevel?.[level]?.max, `${id} ${level}`).toBe(values[i]));
    }
  });

  it("porzioni standard", () => {
    for (const key of PORTION_KEYS) expect(PORTIONS[key].amount, key).toBe(PORTION_SNAPSHOT[key]);
    expect(PORTIONS.milk.unit).toBe("ml");
    expect(PORTIONS.oil.unit).toBe("ml");
    expect(PORTIONS.sugaryDrinks.unit).toBe("ml");
  });
});
