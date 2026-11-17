import { describe, expect, it } from "vitest";
import type { ProteinSpread, VarietyReport, VarietyWindow } from "@/core/nutrition";
import { absentText, monotonyText, spreadView, varietyView } from "./weekView";

const win = (over: Partial<VarietyWindow> = {}): VarietyWindow => ({
  from: "2026-03-04",
  to: "2026-03-10",
  daysWithData: 5,
  completeDays: 5,
  count: 12,
  byGroup: { vegetables: [], fruit: [], legumes: [], wholeGrains: [], nutsSeeds: [], herbs: [] },
  unrecognizedLines: 0,
  partial: false,
  ...over,
});
const report = (cur: Partial<VarietyWindow>, prev: Partial<VarietyWindow> = {}): VarietyReport => ({
  current: win(cur),
  previous: win(prev),
  absent: [],
  monotony: [],
});

describe("frasi della varietà", () => {
  it("nessun dato: sezione vuota, non «zero vegetali»", () => {
    expect(varietyView(report({ daysWithData: 0, count: 0, completeDays: 0 })).empty).toBe(true);
  });

  it("dati completi: numero secco e confronto con la settimana prima", () => {
    const v = varietyView(report({}, { count: 9 }));
    expect(v).toMatchObject({ headline: "12", trend: "La settimana prima: 9." });
    expect(v.caveat).toBeUndefined();
  });

  it("dati parziali: «almeno» e motivo", () => {
    const v = varietyView(report({ completeDays: 3, unrecognizedLines: 2, partial: true }, { daysWithData: 0, count: 0 }));
    expect(v.headline).toBe("almeno 12");
    expect(v.trend).toContain("non ci sono dati");
    expect(v.caveat).toContain("giorni sono incompleti");
    expect(v.caveat).toContain("2 voci non sono state riconosciute");
  });

  it("gruppo assente e monotonia", () => {
    expect(absentText({ group: "legumes", daysSince: 9 })).toBe("Niente legumi da 9 giorni");
    expect(absentText({ group: "herbs" })).toBe("Niente erbe nei dati registrati");
    expect(monotonyText({ key: "mela", name: "Mela", meals: 5, totalMeals: 8 })).toContain("5 pasti su 8");
  });
});

const spread = (over: Partial<ProteinSpread>): ProteinSpread => ({
  from: "2026-03-04",
  to: "2026-03-10",
  daysWithData: 3,
  completeDays: 3,
  moments: [
    { moment: "breakfast", days: 3, partial: false, grams: 10, share: 0.2 },
    { moment: "lunch", days: 3, partial: false, grams: 15, share: 0.2 },
    { moment: "dinner", days: 3, partial: false, grams: 60, share: 0.6 },
    { moment: "other", days: 3, partial: false, grams: 0, share: 0 },
  ],
  top: "dinner",
  topIsMajority: true,
  partial: false,
  ...over,
});

describe("frasi delle proteine", () => {
  it("descrive senza consigliare", () => {
    expect(spreadView(spread({})).summary).toBe("In media la maggior parte delle proteine è a cena (60%).");
    expect(spreadView(spread({ topIsMajority: false })).summary).toContain("Nessun momento prevale");
  });

  it("senza giorni completi dice perché, senza inventare zeri", () => {
    const v = spreadView(spread({ completeDays: 0, top: undefined, daysWithData: 2 }));
    expect(v.empty).toBe(true);
    expect(v.coverage).toContain("Nessun giorno completo");
    expect(spreadView(spread({ completeDays: 0, top: undefined, daysWithData: 0 })).coverage).toContain("Nessun giorno con dati");
  });

  it("segnala il dato parziale", () => {
    expect(spreadView(spread({ partial: true })).caveat).toContain("minimo");
  });
});
