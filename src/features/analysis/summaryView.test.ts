import { describe, expect, it } from "vitest";
import { customPeriod, reportPeriod } from "@/core/analysis";
import { periodTitle, shiftPeriod, canGoNext, REPORT_KINDS } from "./reportView";
import { comparisonLine, expiredUnresolvedText, quantitiesText, savedText, sectionBasisText, valueLine } from "./summaryView";

describe("anno e intervallo nel rapporto", () => {
  it("la scelta del periodo ha settimana, mese, anno e intervallo", () => {
    expect(REPORT_KINDS.map((k) => k.id)).toEqual(["week", "month", "year", "range"]);
  });
  it("titoli e spostamenti", () => {
    const year = reportPeriod("year", "2028-05-05");
    expect(periodTitle(year)).toBe("2028");
    expect(shiftPeriod(year, -1)).toMatchObject({ from: "2027-01-01", to: "2027-12-31", days: 365 });
    expect(shiftPeriod(year, 1)).toMatchObject({ from: "2029-01-01", to: "2029-12-31" });
    const range = customPeriod("2026-03-01", "2026-03-10");
    expect(range).toBeDefined();
    if (range) {
      expect(shiftPeriod(range, -1)).toMatchObject({ from: "2026-02-19", to: "2026-02-28", days: 10 });
      expect(shiftPeriod(range, 1)).toMatchObject({ from: "2026-03-11", to: "2026-03-20" });
      expect(canGoNext(range, "2026-03-10")).toBe(false);
      expect(canGoNext(range, "2026-03-11")).toBe(true);
    }
  });
});

describe("testi del riepilogo", () => {
  const basis = { periodDays: 30, usedDays: 22, excludedDays: 8, observations: 40 };
  it("la quota di dati è sempre scritta", () => {
    expect(sectionBasisText(basis)).toBe("Su 22 giorni registrati su 30");
    expect(sectionBasisText({ ...basis, usedDays: 1, partial: true, periodDays: 10, throughDate: "2026-03-10" })).toContain("1 giorno registrato su 10 trascorsi");
  });
  it("quantità di unità diverse restano separate", () => {
    expect(quantitiesText([{ unit: "g", value: 1500 }, { unit: "ml", value: 500 }])).toContain(" · ");
  });
  it("il valore dice cosa non è contato e non c'è senza prezzi", () => {
    expect(valueLine({ valueCents: 0, withPrice: 0, withoutPrice: 3 }, "buttato")).toBeUndefined();
    expect(valueLine({ valueCents: 450, withPrice: 2, withoutPrice: 1 }, "buttato")).toMatch(/può essere più alto/);
  });
  it("confronto: differenza con segno, senza giudizio", () => {
    const line = comparisonLine({ id: "waterAvg", current: 1500, previous: 1000, delta: 500 });
    expect(line).toContain("+500 ml");
    expect(comparisonLine({ id: "weightAvg", current: 80, previous: 80, delta: 0 })).toContain("invariato");
  });
  it("scaduto non registrato e salvato", () => {
    expect(expiredUnresolvedText(2)).toMatch(/registralo/);
    expect(savedText({ lots: 1, quantities: [{ unit: "g", value: 500 }], certainty: "label" })).toMatch(/freezer/);
  });
});
