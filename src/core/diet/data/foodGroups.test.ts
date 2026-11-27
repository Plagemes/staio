import { describe, expect, it } from "vitest";
import type { FoodCategory } from "../../expiry";
import { FOODS } from "../../nutrition/data/foods";
import { DIET_GROUP_LABEL, PROCESSING_LABEL } from "../labels";
import { DIET_GROUPS, PROCESSING_LEVELS, UNCLASSIFIED, type DietGroup, type PortionKey } from "../types";
import { LOT_CATEGORY_GROUP, LOT_CATEGORY_PORTION, OFF_CATEGORY_RULES } from "./categories";
import { FOOD_ID_GROUP, GROUP_DEFAULT_PORTION, TABLE_GROUP_DEFAULT, foodGroupOf } from "./foodGroups";
import { GUIDELINE_ROWS } from "./guidelines";
import { NAME_RULES } from "./nameRules";
import { DECLARED_PROCESSING, TABLE_GROUP_PROCESSING, declaredProcessingOf } from "./processing";

const ids = new Set(FOODS.map((f) => f.id));

describe("mappa degli alimenti della tabella", () => {
  it("copre tutti gli alimenti: ogni id ha un gruppo vero, mai unknown", () => {
    expect(FOODS.length).toBeGreaterThanOrEqual(388);
    for (const food of FOODS) {
      const { group } = foodGroupOf(food);
      expect(DIET_GROUPS, food.id).toContain(group);
      expect(group as string, food.id).not.toBe("unknown");
    }
  });

  it("ha un gruppo predefinito per ogni gruppo della tabella", () => {
    for (const food of FOODS) expect(TABLE_GROUP_DEFAULT[food.group], food.group).toBeDefined();
  });

  it("le eccezioni e i livelli dichiarati nominano solo id esistenti", () => {
    for (const id of Object.keys(FOOD_ID_GROUP)) expect(ids.has(id), id).toBe(true);
    for (const id of Object.keys(DECLARED_PROCESSING)) expect(ids.has(id), id).toBe(true);
  });

  it("ogni alimento ha un livello di lavorazione dichiarato", () => {
    for (const food of FOODS) expect(PROCESSING_LEVELS, food.id).toContain(declaredProcessingOf(food));
    for (const g of new Set(FOODS.map((f) => f.group))) expect(TABLE_GROUP_PROCESSING[g], g).toBeDefined();
  });

  it("ogni alimento di un gruppo che si conta a porzioni ha una porzione", () => {
    for (const food of FOODS) {
      const { group, portionKey } = foodGroupOf(food);
      if (GROUP_DEFAULT_PORTION[group] !== undefined) expect(portionKey, food.id).toBeDefined();
    }
  });

  it("i formaggi seguono la soglia CREA dei 300 kcal per 100 g", () => {
    for (const food of FOODS) {
      const { group, portionKey } = foodGroupOf(food);
      if (group !== "cheese") continue;
      const kcal = food.per100.energyKcal ?? 0;
      expect(portionKey, food.id).toBe(kcal < 300 ? "cheeseFresh" : "cheeseAged");
    }
  });

  it("eccezioni principali", () => {
    const of = (id: string) => foodGroupOf(FOODS.find((f) => f.id === id)!);
    expect(of("patata-lessa")).toEqual({ group: "potatoes", portionKey: "potatoes" });
    expect(of("piselli-freschi-crudi").group).toBe("legumes");
    expect(of("pollo-petto-crudo").group).toBe("whiteMeat");
    expect(of("anatra-senza-pelle-cruda").group).toBe("redMeat");
    expect(of("maiale-lonza-cruda").group).toBe("redMeat");
    expect(of("burro").group).toBe("oilsFats");
    expect(of("lenticchie-secche").portionKey).toBe("legumesDry");
    expect(of("ceci-in-scatola").portionKey).toBe("legumes");
    expect(of("tofu-crudo").portionKey).toBe("soy");
    expect(of("pasta-integrale-secca").group).toBe("wholeGrains");
    expect(of("farina-integrale").group).toBe("wholeGrains");
    expect(of("pasta-secca").group).toBe("refinedGrains");
    expect(of("pane-integrale")).toEqual({ group: "wholeGrains", portionKey: "bread" });
    expect(of("cola").group).toBe("sugaryDrinks");
    expect(of("succo-d-arancia-spremuta").group).toBe("sugaryDrinks");
    expect(of("birra").group).toBe("alcohol");
    expect(of("patatine-in-sacchetto").group).toBe("saltySnacks");
    expect(of("patatine-fritte-al-forno").group).toBe("potatoes");
    expect(of("lasagne-surgelate").group).toBe("mixedDish");
    expect(of("olive-nere").group).toBe("condiments");
    expect(of("uvetta-sultanina").portionKey).toBe("driedFruit");
    expect(of("rucola-cruda").portionKey).toBe("leafySalad");
    expect(of("tonno-sott-olio").portionKey).toBe("fishPreserved");
  });
});

describe("etichette", () => {
  it("ogni gruppo e ogni livello ha un nome", () => {
    for (const g of [...DIET_GROUPS, ...UNCLASSIFIED]) expect(DIET_GROUP_LABEL[g]).toMatch(/\S/);
    for (const l of PROCESSING_LEVELS) expect(PROCESSING_LABEL[l]).toMatch(/\S/);
  });
});

describe("allineamento con le righe delle linee guida", () => {
  /** Tutte le coppie gruppo/porzione che le mappe possono produrre. */
  const produced = new Set<string>();
  const add = (g: DietGroup | "unknown", p: PortionKey | undefined) => {
    if (p !== undefined && g !== "unknown") produced.add(`${g}/${p}`);
  };
  for (const f of FOODS) {
    const a = foodGroupOf(f);
    add(a.group, a.portionKey);
    const raw = foodGroupOf(f, "raw");
    add(raw.group, raw.portionKey);
    const dried = foodGroupOf(f, "dried");
    add(dried.group, dried.portionKey);
  }
  for (const c of Object.keys(LOT_CATEGORY_GROUP) as FoodCategory[]) add(LOT_CATEGORY_GROUP[c], LOT_CATEGORY_PORTION[c]);
  for (const [, g, p] of OFF_CATEGORY_RULES) add(g, p);
  for (const [, g, p] of NAME_RULES) add(g, p);
  for (const [g, p] of Object.entries(GROUP_DEFAULT_PORTION)) add(g as DietGroup, p);

  it("per ogni riga a porzioni esiste almeno una mappatura che produce una sua porzione", () => {
    for (const row of GUIDELINE_ROWS) {
      if (!row.portionKeys || row.portionKeys.length === 0) continue;
      const ok = row.groups.some((g) => row.portionKeys!.some((p) => produced.has(`${g}/${p}`)));
      expect(ok, row.id).toBe(true);
    }
  });

  it("ogni porzione prodotta è contata da una riga che contiene il suo gruppo", () => {
    for (const pair of produced) {
      const [g, p] = pair.split("/") as [DietGroup, PortionKey];
      const counted = GUIDELINE_ROWS.some((r) => r.groups.includes(g) && (r.portionKeys ?? []).includes(p));
      expect(counted, pair).toBe(true);
    }
  });
});
