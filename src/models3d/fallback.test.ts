import { describe, expect, it } from "vitest";
import { recipeForUnknown, type UnknownProduct } from "./fallback";
import { buildModel } from "./generate";
import { validateRecipe } from "./recipe";

const pick = (p: UnknownProduct) => recipeForUnknown(p);

describe("recipeForUnknown: somiglianza con il catalogo", () => {
  it("riconosce prodotti comuni dal nome, ignorando marca e quantità", () => {
    const cases: [string, string][] = [
      ["Spaghetti Barilla n.5 500 g", "ds-spaghetti"],
      ["Pelati Mutti 400 g", "ds-pelati-lattina"],
      ["Mele Golden 1 kg", "fr-mela-golden"],
      ["Yogurt greco bianco 150 g", "lt-yogurt-greco-vasetto-largo"],
      ["Tonno Rio Mare 3x80g", "cp-tonno-scatoletta"],
      ["Fette biscottate Buitoni", "ds-fette-biscottate"],
      ["Biscotti Mulino Bianco Macine 350 g", "ds-biscotti-pacco"],
      ["Parmigiano Reggiano 24 mesi", "spicchio-parmigiano"],
      ["Prosciutto cotto Rovagnati 100 g", "cp-prosciutto-cotto-vaschetta"],
      ["Olio extravergine di oliva 1 L", "ds-olio-oliva"],
      ["Mozzarelle di bufala 125 g", "lt-mozzarella-palla"],
    ];
    for (const [name, id] of cases) {
      const r = pick({ name });
      expect(r.recipe.id, name).toBe(id);
      expect(r.source, name).toBe("catalog");
      expect(r.baseId).toBe(id);
    }
  });

  it("usa la confezione dichiarata per scegliere fra varianti dello stesso prodotto", () => {
    expect(pick({ name: "Latte UHT Parmalat brick 1 l" }).recipe.id).toBe("lt-latte-brick");
    expect(pick({ name: "Latte fresco", packaging: "bottiglia di vetro" }).recipe.id).toBe("lt-latte-bottiglia-vetro");
    expect(pick({ name: "Birra Peroni 33 cl in lattina" }).recipe.id).toBe("bv-birra-lattina");
  });

  it("sceglie la taglia dell'acqua dalla quantità", () => {
    expect(pick({ name: "Acqua naturale 1,5 L" }).recipe.id).toBe("bv-acqua-grande");
    expect(pick({ name: "Acqua frizzante 50 cl" }).recipe.id).toBe("bv-acqua-piccola");
    expect(pick({ name: "Acqua Sant'Anna 0,5 L vetro" }).recipe.id).toBe("bv-acqua-vetro");
  });

  it("non scambia piatti per ingredienti quando la categoria li distingue", () => {
    const r = pick({ name: "Gnocchi di patate 500 g", category: "pasta-riso" });
    expect(r.source).toBe("category");
    expect(r.recipe.id).toBe("pacco-pasta");
  });

  it("non usa mai le forme generiche ct-* come somiglianza di nome", () => {
    const r = pick({ name: "Bottiglia di plastica piccola" });
    expect(r.source).not.toBe("catalog");
  });
});

describe("recipeForUnknown: confezione e quantità", () => {
  it("sceglie bottiglia piccola o grande e adatta l'altezza", () => {
    const small = pick({ name: "Estratto di ginkgo", packaging: "bottiglia", quantity: { value: 250, unit: "ml" } });
    const big = pick({ name: "Estratto di ginkgo", packaging: "bottiglia", quantity: { value: 2, unit: "l" } });
    expect(small.source).toBe("packaging");
    expect(small.recipe.id).toBe("ct-bottiglia-plastica-piccola");
    expect(big.recipe.id).toBe("ct-bottiglia-plastica-grande");
    expect(small.recipe.heightCm).toBeLessThan(20);
    expect(big.recipe.heightCm).toBeGreaterThanOrEqual(33);
    expect(big.recipe.heightCm).toBeGreaterThan(small.recipe.heightCm * 1.5);
  });

  it("1 l contro 250 ml dà bottiglie diverse e altezze diverse (quantità nel nome)", () => {
    const a = pick({ name: "Infuso di ginkgo 250 ml", packaging: "bottiglia" });
    const b = pick({ name: "Infuso di ginkgo 1 L", packaging: "bottiglia" });
    expect(a.recipe.id).not.toBe(b.recipe.id);
    expect(a.recipe.heightCm).toBeLessThan(b.recipe.heightCm);
  });

  it("riconosce la confezione dalle parole del nome", () => {
    expect(pick({ name: "Coca-Cola 33 cl lattina" })).toMatchObject({ source: "packaging", recipe: { id: "ct-lattina-alta" } });
    expect(pick({ name: "Dentifricio Colgate tubetto 75 ml" })).toMatchObject({ source: "packaging", recipe: { id: "ct-tubetto" } });
    expect(pick({ name: "Gelato alla crema, vaschetta 500 g" })).toMatchObject({ source: "packaging", recipe: { id: "ct-vaschetta-alta" } });
    expect(pick({ name: "Nutella 450 g", packaging: "vasetto" })).toMatchObject({ recipe: { id: "ct-barattolo-vetro-grande" } });
    expect(pick({ name: "Fazzoletti", packaging: "scatola" }).recipe.id).toMatch(/^ct-scatola-cartone/);
    expect(pick({ name: "Zuppa istantanea", packaging: "busta" }).recipe.id).toBe("ct-busta-piatta");
    expect(pick({ name: "Crocchette", packaging: "sacchetto", quantity: { value: 2, unit: "kg" } }).recipe.id).toBe("ct-sacchetto");
  });

  it("il campo packaging vince sulle parole del nome", () => {
    const r = pick({ name: "Infuso ai fiori di sambuco in lattina", packaging: "brick", quantity: { value: 1, unit: "l" } });
    expect(r.recipe.id).toBe("ct-brick-grande");
  });

  it("la quantità esplicita vince su quella nel nome e converte le unità", () => {
    const r = pick({ name: "Tisana 1 L", packaging: "bottiglia", quantity: { value: 33, unit: "cl" } });
    expect(r.recipe.id).toBe("ct-bottiglia-plastica-piccola");
  });

  it("l'altezza adattata resta entro limiti ragionevoli", () => {
    const tiny = pick({ name: "Colla", packaging: "tubetto", quantity: { value: 1, unit: "g" } });
    const huge = pick({ name: "Vernice", packaging: "bottiglia", quantity: { value: 900, unit: "l" } });
    expect(tiny.recipe.heightCm).toBeGreaterThanOrEqual(9);
    expect(huge.recipe.heightCm).toBeLessThan(45);
  });

  it("senza quantità lascia l'altezza della forma", () => {
    expect(pick({ name: "Qualcosa", packaging: "brick" }).recipe.heightCm).toBe(19);
  });

  it("la bottiglia di vetro è una sola forma", () => {
    expect(pick({ name: "Aperitivo analcolico", packaging: "bottiglia di vetro", quantity: { value: 75, unit: "cl" } }).recipe.id).toBe("ct-bottiglia-vetro");
  });
});

describe("recipeForUnknown: categoria e forma generica", () => {
  it("sceglie la forma tipica della categoria, adattata alla quantità", () => {
    expect(pick({ name: "Coca-Cola 1,5 L", category: "bevande" })).toMatchObject({ source: "category", recipe: { id: "ct-bottiglia-plastica-grande" } });
    expect(pick({ name: "Coca-Cola 250 ml", category: "bevande" }).recipe.id).toBe("ct-bottiglia-plastica-piccola");
    expect(pick({ name: "Bastoncini Findus", category: "surgelati" })).toMatchObject({ source: "category", recipe: { id: "ct-busta-piatta" } });
    expect(pick({ name: "Pomodori datterini", category: "verdura" }).source).toBe("category");
  });

  it("accetta etichette libere di categoria", () => {
    expect(pick({ name: "Roba", category: "Latte e derivati" })).toMatchObject({ source: "category", recipe: { id: "lt-latte-brick" } });
    expect(pick({ name: "Roba", category: "Gelati e surgelati" })).toMatchObject({ source: "category" });
    expect(pick({ name: "Roba", category: "Carne e salumi" }).recipe.id).toMatch(/^ct-vaschetta/);
  });

  it("deduce le bevande da parole inequivocabili e il vetro per il vino", () => {
    const r = pick({ name: "Vino rosso Chianti 75 cl" });
    expect(r.source).toBe("category");
    expect(r.recipe.id).toBe("ct-bottiglia-vetro");
  });

  it("senza alcun indizio restituisce la scatola generica", () => {
    for (const p of [{ name: "Cosa strana" }, { name: "" }, { name: "Roba", category: "Cose varie" }]) {
      const r = pick(p);
      expect(r.source).toBe("generic");
      expect(r.recipe.id).toBe("ct-scatola-cartone-alta");
    }
  });

  it("anche la quantità sola adatta la scatola generica", () => {
    const r = pick({ name: "Detersivo piatti 750 ml" });
    expect(r.source).toBe("generic");
    expect(r.recipe.heightCm).toBeGreaterThan(20);
  });
});

describe("recipeForUnknown: robustezza", () => {
  const weird: UnknownProduct[] = [
    { name: "" },
    { name: "   " },
    { name: "💥💥" },
    { name: "((( ))) !!!" },
    { name: "x".repeat(5000) },
    { name: "Latte", quantity: { value: NaN, unit: "l" } },
    { name: "Latte", quantity: { value: -3, unit: "l" } },
    { name: "Latte", quantity: { value: 1e12, unit: "kg" } },
    { name: "Latte", quantity: { value: 1, unit: "parsec" } },
    { name: "Acqua", packaging: "???", category: "???" },
    { name: undefined as unknown as string },
    { name: 42 as unknown as string, category: 7 as unknown as string },
    { name: "Olio 0 ml" },
    { name: "Bottiglia" },
  ];

  it("restituisce sempre una ricetta valida e generabile, con una fonte nota", () => {
    for (const p of weird) {
      const r = recipeForUnknown(p);
      expect(["catalog", "packaging", "category", "generic"]).toContain(r.source);
      expect(validateRecipe(r.recipe).ok, JSON.stringify(p).slice(0, 40)).toBe(true);
      expect(r.recipe.id).toBe(r.baseId);
      expect(buildModel(r.recipe, "x").parts.length).toBeGreaterThan(0);
    }
  });

  it("è deterministico e non modifica il catalogo", () => {
    const p = { name: "Infuso ai frutti rossi", packaging: "brick", quantity: { value: 1, unit: "l" } };
    const a = recipeForUnknown(p);
    expect(recipeForUnknown(p)).toEqual(a);
    expect(recipeForUnknown({ ...p, quantity: { value: 200, unit: "ml" } }).recipe.heightCm).toBeLessThan(a.recipe.heightCm);
    expect(recipeForUnknown({ ...p, quantity: undefined }).recipe.heightCm).toBe(19);
  });
});
