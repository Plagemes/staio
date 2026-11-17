import { describe, expect, it } from "vitest";
import { assessItem, assessRecipe, confirmability, confirmIngredient, FINDING_REASON_TEXT } from "./index";

const CYR_A = "а"; // «а» cirillica, uguale alla «a» latina
const latte = `l${CYR_A}tte`;
const CRIT = { allergens: ["latte"], excludedFoods: [] as string[] };
const reasons = (name: string) => assessItem({ name }, ["latte"]).findings.map((f) => f.reason);

describe("parole con alfabeti mescolati", () => {
  it("restano incerte con un motivo proprio, e il motivo dice di riscrivere", () => {
    const a = assessItem({ name: latte }, ["latte"]);
    expect(a.verdict).toBe("uncertain");
    expect(a.findings[0]).toMatchObject({ verdict: "uncertain", reason: "mixed_script" });
    expect(FINDING_REASON_TEXT.mixed_script).toBe("testo con caratteri di alfabeti diversi: riscrivilo");
  });

  it("anche nel nome del prodotto, nei collegati e nella nota", () => {
    for (const subject of [
      { name: "riso", productName: `Cr${CYR_A}ma` },
      { name: "riso", linkedNames: [`Cr${CYR_A}ma`] },
      { name: "riso", note: `con ${latte}` },
    ]) {
      expect(assessItem(subject, ["latte"]).findings.map((f) => f.reason)).toContain("mixed_script");
    }
  });

  it("non si può confermare: rifiutata a monte e ignorata dal motore", () => {
    expect(confirmability({ name: latte }, CRIT)).toEqual({ ok: false, reason: "mixed_script" });
    expect(confirmIngredient({ name: latte }, CRIT, { deviceId: "A" })).toEqual({ ok: false, reason: "mixed_script" });
    // una conferma costruita a mano sullo stesso testo non conta
    const key = JSON.stringify([latte.toLowerCase(), "", "", [], "", []]);
    const fake = new Map([
      [key, { key, ingredient: latte, allergens: ["latte"], excludedFoods: [] as string[], confirmedAt: "2026-11-01T00:00:00.000Z", eventId: "x", eventIds: ["x"], deviceId: "A" }],
    ]);
    expect(assessItem({ name: latte }, ["latte"], { confirmations: fake, excludedFoods: [] }).verdict).toBe("uncertain");
    expect(assessRecipe({ ingredients: [{ name: latte }] }, { allergens: ["latte"], confirmations: fake, excludedFoods: [] }).verdict).toBe("uncertain");
  });

  it("un contains trovato resta contains", () => {
    expect(assessItem({ name: `burro ${latte}` }, ["latte"]).verdict).toBe("contains");
  });

  it("i testi normali non cambiano: latini, di un solo altro alfabeto, accentati, giapponesi misti", () => {
    for (const name of ["prosciutto cotto", "crème fraîche", "Молоко", "牛奶", "ぎゅうにゅう", "牛乳ミルク", "straße", "bœuf", "riso"]) {
      expect(reasons(name), name).not.toContain("mixed_script");
    }
  });

  it("giapponese con «ー», µ/μ come prefisso di unità e simboli comuni non sono alfabeti mescolati", () => {
    const samples = [
      "醤油ラーメン",
      "ラーメン",
      "lievito 7 µg",
      "acido folico 200µg",
      "vitamina D3 25 μg",
      "vitamina B12 2,5 µg",
      "retinolo 800 µg RE",
      "caffè",
      "perché",
      "½ cucchiaio",
      "180°",
      "n° 5",
      "1ª scelta",
      "mele \u{1F34E}",
      "M&M's",
      "7UP",
      "ﬁori",
      "ＡＢＣ",
      "œuf",
      "smør",
    ];
    for (const name of samples) expect(reasons(name), name).not.toContain("mixed_script");
  });

  it("una parola che mescola davvero greco e latino resta bloccata, anche accanto a µ", () => {
    for (const name of ["μriso", "xμg", "μgatto", "lαtte", `salsa l${CYR_A}tte 5 µg`]) {
      expect(reasons(name), name).toContain("mixed_script");
    }
  });
});
