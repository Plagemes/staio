import { describe, expect, it } from "vitest";
import type { AdherenceWeek, DayCheck, NutrientCheck } from "@/core/plan";
import { adherenceView, dayCheckView, daySummaryText, nutrientLine, targetText } from "./verify";

const n = (o: Partial<NutrientCheck>): NutrientCheck => ({
  nutrient: "proteinG",
  target: { min: 90 },
  status: "met",
  value: 95,
  missingShare: 0,
  partial: false,
  ...o,
});

describe("verifica", () => {
  it("scrive gli obiettivi", () => {
    expect(targetText({ min: 90 }, "proteinG")).toBe("almeno 90 g");
    expect(targetText({ max: 2200 }, "energyKcal")).toBe("al massimo 2200 kcal");
    expect(targetText({ min: 1800, max: 2200 }, "energyKcal")).toBe("tra 1800 kcal e 2200 kcal");
  });

  it("con dato parziale non dice un totale: 'almeno' e quota mancante", () => {
    const l = nutrientLine(n({ status: "met", partial: true, value: 95, missingShare: 0.14, shareBy: "weight" }));
    expect(l.value).toBe("almeno 95 g");
    expect(l.statusText).toContain("con i dati che ci sono");
    expect(l.missingText).toBe("Manca il dato per 14% del peso.");
  });

  it("dice 'non determinabile' e 'non calcolabile'", () => {
    expect(nutrientLine(n({ status: "undetermined", partial: true, missingShare: 0.3, shareBy: "count" })).statusText).toMatch(/Non determinabile/);
    const nc = nutrientLine(n({ status: "not_computable", value: undefined, missingShare: 1, partial: true }));
    expect(nc.statusText).toMatch(/Non calcolabile/);
    expect(nc.value).toBe("");
    expect(nc.missingText).toBeUndefined();
  });

  it("spiega i giorni senza obiettivi", () => {
    const day: DayCheck = { date: "2026-11-16", status: "no_targets", entries: 2, notComputableEntries: 0, nutrients: [] };
    expect(dayCheckView(day).note).toMatch(/Scegli il tipo di giornata/);
    expect(dayCheckView({ ...day, dayType: "riposo" }).note).toMatch(/«riposo»/);
    expect(dayCheckView({ ...day, status: "no_plan", entries: 0 }).checked).toBe(false);
  });

  it("riassume il giorno", () => {
    const day: DayCheck = {
      date: "2026-11-16",
      dayType: "riposo",
      status: "checked",
      entries: 3,
      notComputableEntries: 1,
      nutrients: [n({}), n({ nutrient: "fatG", status: "below" }), n({ nutrient: "fiberG", status: "undetermined" })],
    };
    expect(daySummaryText(dayCheckView(day))).toBe("1 su 3 obiettivi rispettati, 1 da rivedere, 1 non determinabile");
  });
});

describe("pianificato contro reale", () => {
  const week: AdherenceWeek = {
    weekStart: "2026-11-09",
    days: [
      {
        date: "2026-11-09",
        entries: [
          { date: "2026-11-09", meal: "lunch", planned: { kind: "food", name: "Pasta", quantity: { value: 80, unit: "g" } }, status: "respected", actual: [] },
          { date: "2026-11-09", meal: "dinner", planned: { kind: "food", name: "Riso", quantity: { value: 80, unit: "g" } }, status: "skipped", actual: [] },
        ],
        extras: [{ name: "Gelato", quantity: { value: 100, unit: "g" }, mealId: "m", from: "diary", meal: "snack" }],
        counts: { respected: 1, substituted: 0, skipped: 1, extra: 1, unverifiable: 0 },
      },
    ],
    excluded: { declared: ["2026-11-10"], gaps: ["2026-11-11", "2026-11-12"], unplanned: [] },
    totals: { respected: 1, substituted: 0, skipped: 1, extra: 1, unverifiable: 0 },
    rate: 0.5,
  };

  it("conta e dichiara i giorni esclusi", () => {
    const v = adherenceView(week, (i) => (i.kind === "food" ? i.name : "x"));
    expect(v.totalsText).toBe("1 rispettata, 0 sostituite, 1 saltata, 1 aggiunta");
    expect(v.rateText).toBe("50% delle voci giudicabili rispettate");
    expect(v.excludedCount).toBe(3);
    expect(v.excludedText).toMatch(/3 giorni esclusi/);
    expect(v.excludedText).toMatch(/Un vuoto non vuol dire/);
    expect(v.days[0].rows.map((r) => r.status)).toEqual(["respected", "skipped", "extra"]);
  });
});
