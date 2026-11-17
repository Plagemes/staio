import { describe, expect, it } from "vitest";
import type { Lot } from "../ledger";
import type { ResolvedComposition } from "../nutrition";
import { compareWithPantry, expiryWeight, rankByExpiring, stockFromLots, type PantryStock } from "./pantry";
import { recipeCost, recipeNutrition } from "./nutrition";
import type { RecipeIngredient } from "./types";

const stock = (ref: string, value: number, unit: "g" | "ml" | "pz", extra: Partial<PantryStock> = {}): PantryStock => ({
  ref,
  name: ref,
  quantity: { value, unit },
  ...extra,
});

const carbonara = {
  title: "Carbonara",
  servings: 4,
  ingredients: [
    { name: "Spaghetti", quantity: { value: 320, unit: "g" } },
    { name: "Guanciale", quantity: { value: 150, unit: "g" } },
    { name: "Uova", quantity: { value: 4, unit: "pz" } },
    { name: "Pecorino romano", quantity: { value: 80, unit: "g" } },
    { name: "Pepe nero", note: "q.b." },
  ] satisfies RecipeIngredient[],
};

function compare(...args: Parameters<typeof compareWithPantry>) {
  const r = compareWithPantry(...args);
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}

describe("compareWithPantry", () => {
  it("distingue disponibile, parziale e mancante", () => {
    const c = compare(carbonara, [
      stock("spaghetti", 500, "g"),
      stock("uova", 2, "pz"),
      stock("pecorino-romano", 1, "pz"),
    ]);
    const by = (n: string) => c.items.find((i) => i.ingredient.name === n);
    expect(by("Spaghetti")?.status).toBe("available");
    expect(by("Uova")?.status).toBe("partial");
    expect(by("Uova")?.shortfall).toEqual({ value: 2, unit: "pz" });
    expect(by("Guanciale")?.status).toBe("missing");
    expect(by("Guanciale")?.shortfall).toEqual({ value: 150, unit: "g" });
    // 1 pz di pecorino contro 80 g: non confrontabile senza peso unitario, si dichiara la sola presenza.
    expect(by("Pecorino romano")?.status).toBe("unquantified");
    expect(by("Pecorino romano")?.check).toBe("presence");
    expect(by("Pecorino romano")?.unquantified).toEqual(["pecorino-romano"]);
    expect(by("Pepe nero")?.status).toBe("missing");
    expect(c.counts).toEqual({ available: 1, partial: 1, missing: 2, unquantified: 1, to_confirm: 0 });
    expect(c.shortfalls.map((s) => s.name)).toEqual(["Guanciale", "Uova", "Pepe nero"]);
    expect(c.coverage).toBeCloseTo(0.2);
  });

  it("converte le unità (kg contro g, l contro ml) e somma le giacenze", () => {
    const sum = compare(
      { servings: 1, ingredients: [{ name: "Latte", quantity: { value: 600, unit: "ml" } }] },
      [
        { ref: "latte-a", name: "latte", quantity: { value: 400, unit: "ml" } },
        { ref: "latte-b", name: "Latte", quantity: { value: 300, unit: "ml" } },
      ],
    );
    expect(sum.items[0]?.status).toBe("available");
    expect(sum.items[0]?.available).toEqual({ value: 700, unit: "ml" });
    const kg = compare(
      { servings: 2, ingredients: [{ name: "Farina", quantity: { value: 300, unit: "g" } }] },
      [{ ref: "farina", name: "farina", quantity: { value: 1, unit: "g" } }],
    );
    expect(kg.items[0]?.status).toBe("partial");
    const l = compare(
      { servings: 1, ingredients: [{ name: "Latte", quantity: { value: 0.5, unit: "l" } }] },
      [stock("latte", 600, "ml")],
    );
    expect(l.items[0]?.status).toBe("available");
    expect(l.items[0]?.available).toEqual({ value: 0.6, unit: "l" });
  });

  it("scala per le porzioni richieste", () => {
    const c = compare(carbonara, [stock("spaghetti", 200, "g")], { servings: 2 });
    expect(c.items[0]?.needed).toEqual({ value: 160, unit: "g" });
    expect(c.items[0]?.status).toBe("available");
    const r = compareWithPantry(carbonara, [], { servings: 0 });
    expect(r.ok).toBe(false);
  });

  it("usa il contesto di conversione se dato", () => {
    const stockList = [stock("uova", 4, "pz")];
    const rec = { servings: 1, ingredients: [{ name: "Uova", quantity: { value: 200, unit: "g" } as const }] };
    expect(compare(rec, stockList).items[0]?.status).toBe("unquantified");
    expect(compare(rec, stockList).items[0]?.check).toBe("presence");
    const c = compare(rec, stockList, { contextFor: () => ({ unitWeight: 60 }) });
    expect(c.items[0]?.check).toBe("quantity");
    expect(c.items[0]?.status).toBe("available");
  });

  it("associa per foodId e non confonde alimenti diversi", () => {
    const rec = { servings: 1, ingredients: [{ name: "Pasta", foodId: "pasta-semola-secca", quantity: { value: 80, unit: "g" } as const }] };
    expect(compare(rec, [stock("pasta-integrale", 500, "g", { foodId: "pasta-integrale" })]).items[0]?.status).toBe("missing");
    expect(compare(rec, [stock("barilla n.5", 500, "g", { foodId: "pasta-semola-secca" })]).items[0]?.status).toBe("available");
    expect(compare({ servings: 1, ingredients: [{ name: "Pesce", quantity: { value: 100, unit: "g" } as const }] }, [stock("pesca", 500, "g")]).items[0]?.status).toBe("missing");
  });

  it("una ricetta senza ingredienti è coperta", () => {
    expect(compare({ servings: 2, ingredients: [] }, []).coverage).toBe(1);
  });

  describe("prudenza sulle corrispondenze", () => {
    const need = (name: string, value: number, unit: "g" | "ml" | "pz") => ({
      servings: 1,
      ingredients: [{ name, quantity: { value, unit } }],
    });

    it("un alimento simile ma diverso è da confermare, mai disponibile", () => {
      const cases: [string, number, "g" | "ml" | "pz", string, number, "g" | "ml" | "pz"][] = [
        ["uova", 2, "pz", "pasta all'uovo", 500, "g"],
        ["Uova", 2, "pz", "pasta all'uovo", 2, "pz"],
        ["latte", 200, "ml", "latte di cocco", 1000, "ml"],
        ["burro", 50, "g", "burro di arachidi", 500, "g"],
        ["pasta all'uovo", 100, "g", "uova", 500, "g"],
        ["Farina", 100, "g", "farina di mais", 1000, "g"],
      ];
      for (const [ing, v, u, st, sv, su] of cases) {
        const item = compare(need(ing, v, u), [stock(st, sv, su)]).items[0];
        expect(item?.status, `${ing} / ${st}`).toBe("to_confirm");
        expect(item?.matched).toEqual([st]);
      }
    });

    it("da confermare non entra né nella copertura né nella lista della spesa", () => {
      const c = compare(need("uova", 2, "pz"), [stock("pasta all'uovo", 1, "pz")]);
      expect(c.counts.to_confirm).toBe(1);
      expect(c.counts.available).toBe(0);
      expect(c.coverage).toBe(0);
      expect(c.shortfalls).toEqual([]);
    });

    it("una corrispondenza esatta vince sulle parziali", () => {
      const c = compare(need("latte", 200, "ml"), [stock("latte di cocco", 1000, "ml"), stock("latte", 500, "ml")]);
      expect(c.items[0]?.status).toBe("available");
      expect(c.items[0]?.matched).toEqual(["latte"]);
    });

    it("anche senza quantità un alimento simile è da confermare", () => {
      const rec = { servings: 1, ingredients: [{ name: "Burro" }, { name: "Sale", note: "q.b." }] };
      const c = compare(rec, [stock("burro di arachidi", 200, "g"), stock("sale", 1000, "g")]);
      expect(c.items.map((i) => i.status)).toEqual(["to_confirm", "available"]);
    });

    it("una giacenza non convertibile non colma la differenza: parziale, non disponibile", () => {
      const rec = need("Farina", 500, "g");
      const c = compare(rec, [stock("farina", 50, "g"), { ref: "farina 00", name: "Farina", quantity: { value: 1, unit: "confezione" } }]);
      const item = c.items[0];
      expect(item?.status).toBe("partial");
      expect(item?.available).toEqual({ value: 50, unit: "g" });
      expect(item?.shortfall).toEqual({ value: 450, unit: "g" });
      expect(item?.unquantified).toEqual(["farina 00"]);
      expect(c.shortfalls).toEqual([{ name: "Farina", quantity: { value: 450, unit: "g" } }]);
    });

    it("solo giacenze non convertibili: presenza non quantificata", () => {
      const c = compare(need("Farina", 500, "g"), [{ ref: "farina", name: "farina", quantity: { value: 1, unit: "confezione" } }]);
      expect(c.items[0]?.status).toBe("unquantified");
      expect(c.items[0]?.check).toBe("presence");
      expect(c.counts.unquantified).toBe(1);
      expect(c.coverage).toBe(0);
      expect(c.shortfalls).toEqual([]);
    });

    it("una giacenza convertibile sufficiente resta disponibile anche con altre non convertibili", () => {
      const c = compare(need("Farina", 500, "g"), [
        stock("farina", 800, "g"),
        { ref: "farina 00", name: "Farina", quantity: { value: 1, unit: "confezione" } },
      ]);
      expect(c.items[0]?.status).toBe("available");
      expect(c.items[0]?.unquantified).toEqual(["farina 00"]);
    });
  });
});

describe("stockFromLots", () => {
  const lot = (id: string, productRef: string, remaining: number, extra: Partial<Lot> = {}): Lot =>
    ({
      lotId: id,
      productRef,
      origin: "purchase",
      status: "active",
      unit: "g",
      initial: remaining,
      remaining,
      consumed: 0,
      discarded: 0,
      gifted: 0,
      location: "dispensa",
      createdAt: "2026-03-01T10:00:00.000Z",
      initialCertainty: "measured",
      remainingCertainty: "measured",
      history: [],
      ...extra,
    }) as Lot;

  it("somma i lotti attivi per prodotto e tiene la scadenza più vicina", () => {
    const s = stockFromLots([
      lot("a", "pasta-semola-secca", 300, { expiry: { date: "2026-06-01", kind: "best_before" } }),
      lot("b", "pasta-semola-secca", 200, { expiry: { date: "2026-05-01", kind: "best_before" } }),
      lot("c", "riso", 0),
      lot("d", "latte", 500, { status: "finished" }),
      lot("e", "Latte fresco", 1, { unit: "pz" }),
    ]);
    expect(s.map((x) => x.ref)).toEqual(["Latte fresco", "pasta-semola-secca"]);
    const pasta = s.find((x) => x.ref === "pasta-semola-secca");
    expect(pasta?.quantity).toEqual({ value: 500, unit: "g" });
    expect(pasta?.earliestExpiry).toBe("2026-05-01");
    expect(pasta?.foodId).toBe("pasta-semola-secca");
    expect(s[0]?.foodId).toBeUndefined();
  });
});

describe("rankByExpiring", () => {
  const recipes = [
    { title: "Zuppa", ingredients: [{ name: "Carote" }, { name: "Sedano" }] },
    { title: "Frittata", ingredients: [{ name: "Uova" }, { name: "Zucchine" }, { name: "Latte" }] },
    { title: "Insalata", ingredients: [{ name: "Lattuga" }] },
    { title: "Budino", ingredients: [{ name: "Latte intero" }] },
  ];

  it("mette in testa le ricette che usano ciò che scade prima", () => {
    const r = rankByExpiring(recipes, [
      { name: "zucchine", daysLeft: 0 },
      { name: "latte", daysLeft: 6 },
    ]);
    expect(r.map((x) => x.recipe.title)).toEqual(["Frittata", "Budino", "Insalata", "Zuppa"]);
    expect(r[0]?.score).toBeCloseTo(1 + expiryWeight(6));
    // "Latte intero" somiglia soltanto a "latte": pesa la metà e lo dichiara
    expect(r[1]?.score).toBeCloseTo(expiryWeight(6) / 2);
    expect(r[1]?.uses[0]?.match).toBe("partial");
    expect(r[0]?.uses.map((u) => u.match)).toEqual(["exact", "exact"]);
    expect(r[0]?.uses.map((u) => u.ingredientIndex)).toEqual([1, 2]);
    expect(r[2]?.score).toBe(0);
  });

  it("senza alimenti in scadenza ordina per titolo", () => {
    expect(rankByExpiring(recipes, []).map((x) => x.recipe.title)).toEqual(["Budino", "Frittata", "Insalata", "Zuppa"]);
  });

  it("pesa di più ciò che scade prima e conta ogni alimento una volta", () => {
    expect(expiryWeight(-3)).toBe(1);
    expect(expiryWeight(0)).toBe(1);
    expect(expiryWeight(1)).toBeGreaterThan(expiryWeight(5));
    const r = rankByExpiring(
      [{ title: "A", ingredients: [{ name: "Latte" }, { name: "Latte intero" }] }],
      [{ name: "latte", daysLeft: 1 }],
    );
    expect(r[0]?.uses).toHaveLength(1);
  });
});

describe("recipeNutrition", () => {
  const flour: ResolvedComposition = {
    name: "Farina",
    origin: "table",
    basis: "g",
    per100: { energyKcal: 340, proteinG: 10 },
  };
  const egg: ResolvedComposition = {
    name: "Uovo",
    origin: "table",
    basis: "g",
    per100: { energyKcal: 140, proteinG: 12, fatG: 10 },
    unitWeightG: 60,
  };
  const milk: ResolvedComposition = {
    name: "Latte",
    origin: "label",
    basis: "ml",
    per100: { energyKcal: 46 },
  };
  const recipe = {
    servings: 2,
    certainty: "label" as const,
    ingredients: [
      { name: "Farina", quantity: { value: 200, unit: "g" }, foodId: "farina" },
      { name: "Uova", quantity: { value: 2, unit: "pz" }, foodId: "uova" },
      { name: "Latte", quantity: { value: 200, unit: "ml" }, foodId: "latte" },
      { name: "Vaniglia", quantity: { value: 1, unit: "g" } },
      { name: "Sale", note: "q.b." },
    ] satisfies RecipeIngredient[],
  };
  const table: Record<string, ResolvedComposition> = { farina: flour, uova: egg, latte: milk };

  it("somma i nutrienti, divide per porzione e dichiara la quota mancante", () => {
    const r = recipeNutrition(recipe, (i) => (i.foodId ? table[i.foodId] : undefined));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const e = r.value.total.energyKcal;
    expect(e?.value).toBeCloseTo(680 + 168 + 92);
    expect(r.value.perServing.energyKcal?.value).toBeCloseTo((680 + 168 + 92) / 2);
    expect(e?.partial).toBe(true);
    expect(e?.missingShare).toBeGreaterThan(0);
    // la proteina manca nel latte: la quota di dato mancante è dichiarata per nutriente
    expect(r.value.total.proteinG?.partial).toBe(true);
    expect(r.value.perServing.fatG?.value).toBeCloseTo(12 / 2);
    expect(r.value.coverage.ingredients).toBe(5);
    expect(r.value.coverage.resolved).toBe(3);
    expect(r.value.coverage.unresolved.map((u) => [u.name, u.reason])).toEqual([
      ["Vaniglia", "no_composition"],
      ["Sale", "no_quantity"],
    ]);
    expect(r.value.coverage.unresolvedShare).toBeGreaterThan(0);
    expect(r.value.certainty).toBe("estimated");
  });

  it("dichiara l'impossibilità di convertire (pezzi senza peso unitario)", () => {
    const noWeight: ResolvedComposition = { ...egg };
    delete noWeight.unitWeightG;
    const r = recipeNutrition(
      { servings: 1, ingredients: [{ name: "Uova", quantity: { value: 2, unit: "pz" }, foodId: "uova" }] },
      () => noWeight,
    );
    expect(r.ok && r.value.coverage.unresolved[0]?.reason).toBe("missing_unit_weight");
    expect(r.ok && r.value.coverage.unresolvedShare).toBe(1);
    expect(r.ok && r.value.total).toEqual({});
  });

  it("senza alcuna composizione non inventa nulla", () => {
    const r = recipeNutrition(recipe, () => undefined);
    expect(r.ok && r.value.total).toEqual({});
    expect(r.ok && r.value.coverage.resolved).toBe(0);
    expect(r.ok && r.value.coverage.unresolvedShare).toBe(1);
  });

  it("rifiuta porzioni non valide", () => {
    expect(recipeNutrition({ ...recipe, servings: 0 }, () => undefined).ok).toBe(false);
  });
});

describe("recipeCost", () => {
  const recipe = {
    servings: 4,
    ingredients: [
      { name: "Farina", quantity: { value: 500, unit: "g" } },
      { name: "Uova", quantity: { value: 3, unit: "pz" } },
      { name: "Sale", note: "q.b." },
    ] satisfies RecipeIngredient[],
  };

  it("somma i prezzi noti in centesimi interi e dichiara i mancanti", () => {
    const r = recipeCost(recipe, (i) =>
      i.name === "Farina" ? { cents: 55.5, certainty: "label" } : i.name === "Uova" ? { cents: 90 } : undefined,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.totalCents).toBe(146);
    expect(Number.isInteger(r.value.perServingCents)).toBe(true);
    expect(r.value.perServingCents).toBe(36);
    expect(r.value.partial).toBe(true);
    expect(r.value.certainty).toBe("estimated");
    expect(r.value.coverage.unresolved).toEqual([{ index: 2, name: "Sale", reason: "no_price" }]);
  });

  it("senza prezzi non vale zero; prezzi non validi sono ignorati", () => {
    const r = recipeCost(recipe, () => ({ cents: -5 }));
    expect(r.ok && r.value.partial).toBe(true);
    expect(r.ok && r.value.coverage.resolved).toBe(0);
    const full = recipeCost(recipe, () => ({ cents: 10, certainty: "label" }));
    expect(full.ok && full.value.partial).toBe(false);
    expect(full.ok && full.value.certainty).toBe("label");
    expect(recipeCost({ ...recipe, servings: 0 }, () => undefined).ok).toBe(false);
  });
});
