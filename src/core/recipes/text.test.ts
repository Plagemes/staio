import { describe, expect, it } from "vitest";
import { parseDurationText, parseIsoDuration, stepDurationFromText } from "./duration";
import { parseIngredientLine } from "./ingredient";
import { parseRecipeText } from "./text";
import { recipeFieldsFromDraft } from "./draft";
import { validateRecipeEvent } from "./validate";
import { recipeEvent } from "./test-helpers";

const p = (s: string) => {
  const r = parseIngredientLine(s);
  return r && { name: r.name, quantity: r.quantity, note: r.note, recognized: r.recognized };
};

describe("parseIngredientLine", () => {
  it("legge quantità, unità e nome in italiano", () => {
    expect(p("200 g di farina 00")).toMatchObject({ name: "farina 00", quantity: { value: 200, unit: "g" } });
    expect(p("1,5 kg di patate")).toMatchObject({ name: "patate", quantity: { value: 1.5, unit: "kg" } });
    expect(p("3 uova")).toMatchObject({ name: "uova", quantity: { value: 3, unit: "pz" } });
    expect(p("2 cucchiai di olio extravergine d'oliva")).toMatchObject({
      name: "olio extravergine d'oliva",
      quantity: { value: 2, unit: "cucchiaio" },
    });
    expect(p("1/2 cucchiaino di sale")).toMatchObject({ name: "sale", quantity: { value: 0.5, unit: "cucchiaino" } });
    expect(p("mezzo limone")).toMatchObject({ name: "limone", quantity: { value: 0.5, unit: "pz" } });
    expect(p("Una cipolla")).toMatchObject({ name: "cipolla", quantity: { value: 1, unit: "pz" } });
    expect(p("1 etto di prosciutto")).toMatchObject({ quantity: { value: 1, unit: "hg" } });
    expect(p("250ml di latte")).toMatchObject({ name: "latte", quantity: { value: 250, unit: "ml" } });
  });

  it("legge frazioni miste, frazioni unicode e intervalli", () => {
    expect(p("1 1/2 tazze di latte")).toMatchObject({ name: "latte", quantity: { value: 1.5, unit: "tazza" } });
    expect(p("½ bicchiere di vino bianco")).toMatchObject({ quantity: { value: 0.5, unit: "bicchiere" } });
    expect(p("1½ kg di farina")).toMatchObject({ quantity: { value: 1.5, unit: "kg" } });
    expect(p("200-250 g di zucchero")).toMatchObject({
      name: "zucchero",
      quantity: { value: 200, unit: "g" },
      note: "da 200 a 250",
    });
  });

  it("legge quanto basta e pizzichi senza inventare quantità", () => {
    expect(p("Sale q.b.")).toEqual({ name: "Sale", quantity: undefined, note: "q.b.", recognized: true });
    expect(p("pepe quanto basta")).toMatchObject({ name: "pepe", quantity: undefined, note: "q.b." });
    expect(p("Basilico a piacere")).toMatchObject({ name: "Basilico", note: "a piacere" });
    expect(p("un pizzico di sale")).toMatchObject({ name: "sale", quantity: { value: 1, unit: "pizzico" } });
    expect(p("un po' di prezzemolo")).toMatchObject({ name: "prezzemolo", note: "un po'" });
    expect(p("Sale")).toEqual({ name: "Sale", quantity: undefined, note: undefined, recognized: false });
  });

  it("tiene preparazioni e precisazioni come nota", () => {
    expect(p("100 g di burro, a temperatura ambiente")).toMatchObject({
      name: "burro",
      note: "a temperatura ambiente",
    });
    expect(p("2 pomodori (maturi)")).toMatchObject({ name: "pomodori", note: "maturi" });
    expect(p("2 spicchi di aglio")).toMatchObject({ name: "aglio", quantity: { value: 2, unit: "pz" }, note: "spicchi" });
    expect(p("1 noce di burro")).toMatchObject({ name: "burro", note: "noce" });
  });

  it("legge il formato nome-poi-quantità e gli elenchi puntati", () => {
    expect(p("Farina 00: 200 g")).toMatchObject({ name: "Farina 00", quantity: { value: 200, unit: "g" } });
    expect(p("Latte - 500 ml")).toMatchObject({ name: "Latte", quantity: { value: 500, unit: "ml" } });
    expect(p("Zucchero 100 g")).toMatchObject({ name: "Zucchero", quantity: { value: 100, unit: "g" } });
    expect(p("Farina 00")).toMatchObject({ name: "Farina 00", quantity: undefined });
    expect(p("- 2 uova")).toMatchObject({ name: "uova", quantity: { value: 2, unit: "pz" } });
    expect(p("• 300 g spaghetti")).toMatchObject({ name: "spaghetti", quantity: { value: 300, unit: "g" } });
  });

  it("legge anche le unità inglesi più comuni", () => {
    expect(p("2 tbsp olive oil")).toMatchObject({ name: "olive oil", quantity: { value: 2, unit: "cucchiaio" } });
    expect(p("1 cup flour")).toMatchObject({ quantity: { value: 1, unit: "tazza" } });
    expect(p("8 oz mascarpone")).toMatchObject({ quantity: { value: 226.8, unit: "g" } });
    expect(p("2 cloves garlic")).toMatchObject({ name: "garlic", quantity: { value: 2, unit: "pz" }, note: "cloves" });
    expect(p("salt, to taste")).toMatchObject({ name: "salt", note: "q.b." });
  });

  it("restituisce null per righe vuote e non lancia mai", () => {
    expect(parseIngredientLine("")).toBeNull();
    expect(parseIngredientLine("  -  ")).toBeNull();
    expect(parseIngredientLine(undefined as unknown as string)).toBeNull();
    expect(() => parseIngredientLine("0/0 ((( ,,, ::: 99999999999999999999 g")).not.toThrow();
    expect(p("200 g")).toMatchObject({ recognized: false, quantity: undefined });
  });
});

describe("durate", () => {
  it("legge ISO 8601", () => {
    expect(parseIsoDuration("PT20M")).toBe(20);
    expect(parseIsoDuration("PT1H30M")).toBe(90);
    expect(parseIsoDuration("PT1.5H")).toBe(90);
    expect(parseIsoDuration("P0DT45M")).toBe(45);
    expect(parseIsoDuration("P1DT2H")).toBe(26 * 60);
    expect(parseIsoDuration("PT90S")).toBe(2);
    expect(parseIsoDuration("pt15m")).toBe(15);
    expect(parseIsoDuration("P1W")).toBe(10080);
  });

  it("scarta ciò che non è una durata sicura", () => {
    for (const v of ["PT0M", "P", "PT", "P1M", "P1Y", "", "abc", null, undefined, {}, "PT99999999H"]) {
      expect(parseIsoDuration(v)).toBeUndefined();
    }
  });

  it("legge il testo italiano e inglese", () => {
    expect(parseDurationText("20 minuti")).toBe(20);
    expect(parseDurationText("1 ora e 30 minuti")).toBe(90);
    expect(parseDurationText("1h30")).toBe(90);
    expect(parseDurationText("2 ore")).toBe(120);
    expect(parseDurationText("mezz'ora")).toBe(30);
    expect(parseDurationText("45 min")).toBe(45);
    expect(parseDurationText("1 hour 15 minutes")).toBe(75);
    expect(parseDurationText("a lungo")).toBeUndefined();
    expect(parseIsoDuration("25 minuti")).toBe(25);
  });

  it("la durata di un passo solo se univoca", () => {
    expect(stepDurationFromText("Cuocere per 10 minuti a fuoco medio.")).toBe(10);
    expect(stepDurationFromText("Cuocere per circa 2 ore.")).toBe(120);
    expect(stepDurationFromText("Cuocere per 10-15 minuti.")).toBeUndefined();
    expect(stepDurationFromText("Cuocere 10 minuti, poi riposare 5 minuti.")).toBeUndefined();
    expect(stepDurationFromText("Mescolare bene.")).toBeUndefined();
  });
});

const PASTED = `Torta della nonna

Per 8 persone
Tempo di preparazione: 30 minuti
Cottura: 1 ora

Ingredienti
- 300 g di farina 00
- 3 uova
- 200 g di zucchero
Per la crema:
- 500 ml di latte
- Scorza di limone
- sale q.b.

Preparazione
1. Mescolare le uova con lo zucchero.
2. Aggiungere la farina e impastare.
3. Infornare a 180 gradi per 40 minuti.

Consigli: servire tiepida.`;

describe("parseRecipeText", () => {
  it("legge titolo, porzioni, tempi, ingredienti e passi", () => {
    const r = parseRecipeText(PASTED);
    expect(r.title).toBe("Torta della nonna");
    expect(r.servings).toBe(8);
    expect(r.times).toEqual({ prepMinutes: 30, cookMinutes: 60 });
    expect(r.structured).toBe(true);
    expect(r.ingredients.map((i) => i.name)).toEqual([
      "farina 00",
      "uova",
      "zucchero",
      "latte",
      "Scorza di limone",
      "sale",
    ]);
    expect(r.ingredients[0]?.quantity).toEqual({ value: 300, unit: "g" });
    expect(r.ingredients[5]?.note).toBe("q.b.");
    expect(r.steps.map((s) => s.text)).toEqual([
      "Mescolare le uova con lo zucchero.",
      "Aggiungere la farina e impastare.",
      "Infornare a 180 gradi per 40 minuti.",
      "Consigli: servire tiepida.",
    ]);
    expect(r.steps[2]?.durationMinutes).toBe(40);
    expect(r.unrecognized).toEqual(["Per la crema:"]);
  });

  it("senza intestazioni riconosce solo ciò che è inequivocabile", () => {
    const r = parseRecipeText(`Frittata veloce
200 g di zucchine
4 uova
Una vecchia ricetta di famiglia tramandata da sempre.
1. Sbattere le uova
2. Cuocere in padella`);
    expect(r.title).toBe("Frittata veloce");
    expect(r.ingredients.map((i) => i.name)).toEqual(["zucchine", "uova"]);
    expect(r.steps.map((s) => s.text)).toEqual(["Sbattere le uova", "Cuocere in padella"]);
    expect(r.unrecognized).toEqual(["Una vecchia ricetta di famiglia tramandata da sempre."]);
    expect(r.structured).toBe(false);
  });

  it("legge porzioni dall'intestazione degli ingredienti e titoli in markdown", () => {
    const r = parseRecipeText("# Risotto ai funghi\n\nIngredienti per 4 persone:\nRiso 320 g\nFunghi: 300 g\n\nProcedimento\nTostare il riso.");
    expect(r.title).toBe("Risotto ai funghi");
    expect(r.servings).toBe(4);
    expect(r.ingredients.map((i) => [i.name, i.quantity?.value])).toEqual([
      ["Riso", 320],
      ["Funghi", 300],
    ]);
    expect(r.steps).toHaveLength(1);
  });

  it("non inventa: testo senza struttura resta testo", () => {
    const r = parseRecipeText("Ciao, ti passo la ricetta domani.\nUn abbraccio.");
    expect(r.ingredients).toEqual([]);
    expect(r.steps).toEqual([]);
    expect(r.title).toBeUndefined();
    expect(r.unrecognized).toEqual(["Ciao, ti passo la ricetta domani.", "Un abbraccio."]);
  });

  it("gestisce input vuoti, enormi o ostili senza lanciare", () => {
    expect(parseRecipeText("")).toMatchObject({ ingredients: [], steps: [], unrecognized: [] });
    expect(parseRecipeText(undefined as unknown as string).steps).toEqual([]);
    const big = "Ingredienti\n" + "100 g di farina\n".repeat(50_000);
    const r = parseRecipeText(big);
    expect(r.ingredients.length).toBeLessThanOrEqual(300);
    expect(() => parseRecipeText("\u0000‮".repeat(1000))).not.toThrow();
  });

  it("la bozza diventa campi validi di un evento", () => {
    const r = parseRecipeText(PASTED);
    const fields = recipeFieldsFromDraft(r);
    expect(fields.servings).toBe(8);
    expect(validateRecipeEvent(recipeEvent("e1", "2026-03-01T10:00:00.000Z", fields))).toEqual([]);
    const empty = recipeFieldsFromDraft({ ingredients: [], steps: [] }, { servings: 2 });
    expect(empty).toMatchObject({ title: "Ricetta senza titolo", servings: 2 });
  });
});
