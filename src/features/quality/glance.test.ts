import { describe, expect, it } from "vitest";
import { product, withNutrients } from "@/core/quality/test-helpers";
import { GLANCE_MAX, qualityGlance } from "./glance";

// Valori finti: soglie del semaforo per 100 g: grassi 3 / 17,5, saturi 1,5 / 5, zuccheri 5 / 22,5, sale 0,3 / 1,5.
const BARCODE = "8001234567890";

describe("qualityGlance", () => {
  it("un codice interno di negozio non si valuta", () => {
    expect(qualityGlance(withNutrients("2001234567890", { fat: 20 }))).toBeNull();
  });

  it("un prodotto scritto a mano non si valuta: la scheda completa non lo valuta", () => {
    expect(qualityGlance(withNutrients("2001234567890", { fat: 20 }, { localFromName: true }))).toBeNull();
  });

  it("senza dati: nessun chip e una riga che dice che mancano", () => {
    expect(qualityGlance(product(BARCODE))).toEqual({ chips: [], line: "Mancano i dati per dare un esito.", hidden: 0 });
  });

  it("un solo punto a sfavore: riga al singolare, senza parti a zero", () => {
    const view = qualityGlance(withNutrients(BARCODE, { fat: 20 }));
    expect(view?.line).toBe("1 punto a sfavore.");
    expect(view?.chips).toEqual([{ id: "fat", label: "Grassi", outcome: "unfavorable" }]);
    expect(view?.hidden).toBe(0);
  });

  it("la riga nomina solo le parti con almeno un esito", () => {
    const view = qualityGlance(withNutrients(BARCODE, { sugars: 3, salt: 0.1 }));
    expect(view?.line).toBe("2 punti a favore.");
    expect(view?.line).not.toMatch(/\b0\b/);
  });

  it("ordine: prima le sfavorevoli, poi le intermedie, poi le favorevoli; a parità l'ordine delle dimensioni", () => {
    const view = qualityGlance({ ...withNutrients(BARCODE, { fat: 20, saturatedFat: 2, sugars: 3 }), nutriScore: "a" });
    expect(view?.chips.map((c) => [c.id, c.outcome])).toEqual([
      ["fat", "unfavorable"],
      ["saturatedFat", "intermediate"],
      ["sugars", "favorable"],
      ["nutriScore", "favorable"],
    ]);
    expect(view?.line).toBe("1 punto a sfavore, 1 punto intermedio, 2 punti a favore.");
  });

  it("al massimo quattro chip; il resto è in `hidden`", () => {
    const view = qualityGlance({
      ...withNutrients(BARCODE, { fat: 20, saturatedFat: 2, sugars: 3, salt: 0.1 }),
      nutriScore: "d",
      nova: 3,
    });
    expect(GLANCE_MAX).toBe(4);
    expect(view?.chips).toHaveLength(4);
    expect(view?.chips.map((c) => c.id)).toEqual(["fat", "nutriScore", "saturatedFat", "nova"]);
    expect(view?.hidden).toBe(2);
    expect(view?.line).toBe("2 punti a sfavore, 2 punti intermedi, 2 punti a favore.");
  });

  it("con esattamente quattro dimensioni valutate non resta nulla nascosto", () => {
    const view = qualityGlance(withNutrients(BARCODE, { fat: 20, saturatedFat: 2, sugars: 3, salt: 0.1 }));
    expect(view?.chips).toHaveLength(4);
    expect(view?.hidden).toBe(0);
  });

  it("le etichette sono accorciate: «Lavorazione» al posto di «Grado di lavorazione (NOVA)»", () => {
    const view = qualityGlance({ ...product(BARCODE), nova: 4 });
    expect(view?.chips).toEqual([{ id: "nova", label: "Lavorazione", outcome: "unfavorable" }]);
  });

  it("le dimensioni non valutabili e i valori descrittivi non diventano chip", () => {
    const view = qualityGlance({ ...product(BARCODE), additives: ["en:e330"] });
    expect(view).toEqual({ chips: [], line: "Mancano i dati per dare un esito.", hidden: 0 });
  });
});
