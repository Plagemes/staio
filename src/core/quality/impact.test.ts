import { describe, expect, it } from "vitest";
import { dietImpact, type ConsumptionEntry } from "./impact";
import { product, withNutrients } from "./test-helpers";

const cola = withNutrients("100", { sugars: 10, salt: 0, saturatedFat: 0 }, { name: "Bibita", per: "100ml", nova: 4 });
const biscuits = withNutrients("200", { sugars: 30, salt: 1, saturatedFat: 10 }, { name: "Biscotti", nova: 4 });
const bread = withNutrients("300", { sugars: 2, salt: 1.5, saturatedFat: 0.5 }, { name: "Pane", nova: 3 });
const apple = withNutrients("400", { sugars: 10 }, { name: "Mela", nova: 1 });

const entry = (p: ConsumptionEntry["product"], amount: number, unit: "g" | "ml", timesPerWeek: number): ConsumptionEntry => ({
  product: p,
  amount,
  unit,
  timesPerWeek,
});

const entries = [
  entry(cola, 330, "ml", 7), // zuccheri 33 x 7 = 231 g
  entry(biscuits, 50, "g", 7), // zuccheri 15 x 7 = 105, sale 0.5 x 7 = 3.5, saturi 5 x 7 = 35
  entry(bread, 100, "g", 7), // zuccheri 14, sale 10.5, saturi 3.5
  entry(apple, 150, "g", 7), // zuccheri 105; sale e saturi non noti
];

describe("dietImpact", () => {
  const report = dietImpact(entries);

  it("totali e contributori degli zuccheri, in ordine", () => {
    const m = report.metrics.sugars;
    expect(m.totalPerWeek).toBe(455);
    expect(m.complete).toBe(true);
    expect(m.contributors.map((c) => c.name)).toEqual(["Bibita", "Biscotti", "Mela", "Pane"]);
    expect(m.contributors[0]).toMatchObject({ perWeek: 231, share: 0.51 });
  });

  it("un dato mancante non vale zero: totale parziale dichiarato", () => {
    const salt = report.metrics.salt;
    expect(salt.entriesWithData).toBe(3);
    expect(salt.entriesTotal).toBe(4);
    expect(salt.complete).toBe(false);
    expect(salt.totalPerWeek).toBe(14);
    expect(salt.contributors.map((c) => c.name)).toEqual(["Pane", "Biscotti"]);
  });

  it("grassi saturi", () => {
    expect(report.metrics.saturatedFat.totalPerWeek).toBe(38.5);
    expect(report.metrics.saturatedFat.contributors[0].name).toBe("Biscotti");
  });

  it("prodotti molto lavorati: consumi a settimana e prodotti distinti", () => {
    const u = report.metrics.ultraProcessed;
    expect(u).toMatchObject({ unit: "occasions", totalPerWeek: 14, distinctProducts: 2, complete: true });
  });

  it("NOVA mancante: il prodotto non è contato come poco lavorato", () => {
    const r = dietImpact([entry(withNutrients("500", { sugars: 1 }), 100, "g", 3)]);
    expect(r.metrics.ultraProcessed.complete).toBe(false);
    expect(r.metrics.ultraProcessed.entriesWithData).toBe(0);
  });

  it("i cambi che spostano di più, con l'effetto su ogni totale", () => {
    expect(report.changes).toHaveLength(3);
    // Biscotti: 91% dei grassi saturi; Pane: 75% del sale; Bibita: 51% degli zuccheri
    expect(report.changes.map((c) => c.name)).toEqual(["Biscotti", "Pane", "Bibita"]);
    expect(report.changes[0].effects.find((e) => e.metric === "saturatedFat")).toMatchObject({ perWeek: 35, share: 0.91 });
    expect(report.changes[2].effects.find((e) => e.metric === "sugars")).toMatchObject({ perWeek: 231, share: 0.51 });
    expect(dietImpact(entries, { maxChanges: 1 }).changes).toHaveLength(1);
  });

  it("unità diversa da quella dei valori (g contro 100 ml): il nutriente non è calcolato", () => {
    const r = dietImpact([entry(cola, 330, "g", 7)]);
    expect(r.metrics.sugars.entriesWithData).toBe(0);
    expect(r.metrics.sugars.totalPerWeek).toBe(0);
    expect(r.changes.find((c) => c.effects.some((e) => e.metric === "sugars"))).toBeUndefined();
  });

  it("quantità o frequenza non valide sono scartate e segnalate", () => {
    const r = dietImpact([entry(bread, 0, "g", 7), entry(bread, 100, "g", -1), entry(bread, 100, "g", 1)]);
    expect(r.excluded).toHaveLength(2);
    expect(r.metrics.salt.entriesTotal).toBe(1);
  });

  it("lo stesso prodotto in più voci si somma", () => {
    const r = dietImpact([entry(bread, 100, "g", 3), entry(bread, 50, "g", 2)]);
    expect(r.metrics.salt.contributors).toHaveLength(1);
    expect(r.metrics.salt.totalPerWeek).toBe(6);
  });

  it("nessun consumo: totali a zero, nessun cambio", () => {
    const r = dietImpact([]);
    expect(r.changes).toEqual([]);
    expect(r.metrics.sugars).toMatchObject({ totalPerWeek: 0, complete: true, contributors: [] });
  });

  it("prodotto senza nutrienti: non contribuisce e rende il totale parziale", () => {
    const r = dietImpact([entry(product("600"), 100, "g", 1), entry(bread, 100, "g", 1)]);
    expect(r.metrics.salt.complete).toBe(false);
  });
});
