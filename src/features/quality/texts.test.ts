import { describe, expect, it } from "vitest";
import { assessProduct, dimensionOf, type Alternative, type MetricImpact } from "@/core/quality";
import { product, withNutrients } from "@/core/quality/test-helpers";
import { alternativeSentences, changeEffectText, metricCoverageText, metricTotalText, notAssessableText, num, priceLine, shortReason, sharePercent } from "./texts";

describe("texts", () => {
  it("num usa la virgola e toglie gli zeri inutili", () => {
    expect(num(2.5)).toBe("2,5");
    expect(num(3, 2)).toBe("3");
  });

  it("shortReason dichiara che le soglie sono dello schema britannico volontario", () => {
    const a = assessProduct(withNutrients("A", { sugars: 30 }, { name: "x" }));
    expect(shortReason(dimensionOf(a, "sugars")!)).toMatch(/britannico, schema volontario/);
  });

  it("shortReason di un dato mancante è la spiegazione e non finge un valore", () => {
    const a = assessProduct(product("A"));
    expect(shortReason(dimensionOf(a, "sugars")!)).toMatch(/non riporta/);
  });

  it("shortReason di Nutri-Score e NOVA dice che il raggruppamento è una scelta di presentazione", () => {
    const a = assessProduct(product("A", { nutriScore: "c", nova: 3 }));
    expect(shortReason(dimensionOf(a, "nutriScore")!)).toMatch(/presentazione/);
    expect(shortReason(dimensionOf(a, "nova")!)).toMatch(/presentazione/);
  });

  it("gli additivi senza giudizio si elencano senza allarmi", () => {
    const a = assessProduct(product("A", { additives: ["E330", "E412"] }));
    expect(shortReason(dimensionOf(a, "additives")!)).toMatch(/2 additivi dichiarati, senza un giudizio fondato/);
  });

  it("notAssessableText dice quante dimensioni non si possono valutare", () => {
    expect(notAssessableText(assessProduct(product("A")))).toMatch(/Nessuna delle 7/);
    const partial = assessProduct(withNutrients("A", { sugars: 1, fat: 1, saturatedFat: 1, salt: 0.1 }, { nutriScore: "a", nova: 1 }));
    expect(notAssessableText(partial)).toBe("1 dimensione non valutabile su 7: mancano i dati o una fonte per giudicarle.");
  });

  it("metricTotalText scrive 'almeno' se il totale è parziale", () => {
    const base: MetricImpact = { metric: "sugars", unit: "g", totalPerWeek: 120, entriesWithData: 2, entriesTotal: 3, complete: false, contributors: [] };
    expect(metricTotalText(base)).toBe("almeno 120 g a settimana");
    expect(metricTotalText({ ...base, complete: true, entriesWithData: 3 })).toBe("120 g a settimana");
    expect(metricCoverageText(base)).toMatch(/per 1 manca/);
    expect(metricTotalText({ ...base, entriesTotal: 0, entriesWithData: 0 })).toBe("Nessun dato");
  });

  it("changeEffectText dice quanto in meno e la quota del totale", () => {
    expect(changeEffectText("sugars", 15, 0.5)).toBe("15 g in meno a settimana di zuccheri, il 50% del totale che risulta dai tuoi consumi");
    expect(changeEffectText("ultraProcessed", 2, 0.25)).toMatch(/^2 consumi in meno a settimana di prodotti molto lavorati/);
  });

  it("sharePercent non arrotonda a niente", () => {
    expect(sharePercent(0.004)).toBe("meno dell'1%");
    expect(sharePercent(0.456)).toBe("46%");
  });

  it("priceLine copre prezzo assente, non confrontabile e differenza", () => {
    const alt = { unitPrice: { cents: 500, per: "kg" }, priceDifferenceCents: -100 } as unknown as Alternative;
    expect(priceLine(alt, { cents: 600, per: "kg" })).toBe("Prezzo osservato: 5 € al kg, 1 € in meno al kg del prodotto di partenza.");
    expect(priceLine({ unitPrice: { cents: 500, per: "kg" } } as unknown as Alternative, undefined)).toMatch(/non ho un prezzo con cui confrontarlo/);
    expect(priceLine({} as unknown as Alternative, undefined)).toMatch(/non ho acquisti registrati/);
  });

  describe("alternativeSentences", () => {
    const base = { before: "35 g per 100 g", after: "5 g per 100 g", alsoBetter: [], same: [], notComparable: [] } as unknown as Alternative;

    it("scrive 'senza peggiorare' solo se la logica dice che nessuna dimensione è peggiore o non confrontabile", () => {
      const clean = { ...base, worseOn: [], notComparableOn: [] } as Alternative;
      expect(alternativeSentences(clean, "Zuccheri")[0]).toBe("Zuccheri: da 35 g per 100 g a 5 g per 100 g, senza peggiorare le altre dimensioni.");
    });

    it("con dimensioni non confrontabili non afferma niente e le elenca con il motivo", () => {
      const alt = {
        ...base,
        notComparable: ["salt", "additives"],
        worseOn: [],
        notComparableOn: [
          { dimension: "salt", label: "Sale", reason: "dato mancante nel candidato" },
          { dimension: "additives", label: "Additivi", reason: "il candidato non riporta gli additivi" },
        ],
      } as unknown as Alternative;
      const text = alternativeSentences(alt, "Zuccheri").join(" ");
      expect(text).not.toMatch(/senza peggiorare/);
      expect(text).toMatch(/sale \(dato mancante nel candidato\)/);
      expect(text).toMatch(/non posso dire che non peggiori/);
    });

    it("se la logica non ha popolato le voci non si afferma niente", () => {
      expect(alternativeSentences(base, "Zuccheri").join(" ")).not.toMatch(/senza peggiorare/);
    });

    it("elenca le peggiorie e le differenze descrittive come sole informazioni", () => {
      const alt = {
        ...base,
        worseOn: [{ dimension: "fat", label: "Grassi", reason: "da 2 g a 9 g" }],
        notComparableOn: [],
        descriptive: [{ dimension: "additives", label: "Additivi", text: "da 1 a 8 additivi senza giudizio" }],
      } as unknown as Alternative;
      const s = alternativeSentences(alt, "Zuccheri");
      expect(s.join(" ")).not.toMatch(/senza peggiorare/);
      expect(s).toContain("Peggiora: grassi (da 2 g a 9 g).");
      expect(s).toContain("Solo descrittivo, senza giudizio: additivi, da 1 a 8 additivi senza giudizio.");
    });
  });
});
