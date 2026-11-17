import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import type { DayIntake, IntakeLine } from "@/core/nutrition";
import { withNutrients } from "@/core/quality/test-helpers";
import { buildDietImpact, consumptionEntries, restrictedExcludedText, trackedWindow } from "./consumption";

const TODAY = "2026-11-17";

function resolved(ref: string | undefined, value: number, unit: "g" | "ml" | "pz", selection: "product" | "name" = "product"): IntakeLine {
  return {
    status: "ok",
    kind: "pantry",
    label: ref ?? "x",
    quantity: { value, unit },
    quantityCertainty: "label",
    eventId: "e",
    composition: { name: "n", ...(ref !== undefined ? { ref } : {}), origin: "label", selection },
    nutrients: {},
    certainty: "label",
  } as unknown as IntakeLine;
}

const unresolvedPantry = {
  status: "unresolved",
  kind: "pantry",
  label: "x",
  quantity: { value: 1, unit: "pz" },
  quantityCertainty: "label",
  eventId: "e",
  reason: "no_composition",
} as unknown as IntakeLine;

function day(date: string, lines: IntakeLine[]): DayIntake {
  return { date, complete: true, reasons: [], meals: [], standalone: lines, drinks: [], totals: {}, unresolved: [] } as unknown as DayIntake;
}

const biscuits = withNutrients("B1", { sugars: 30, salt: 0.5, saturatedFat: 8 }, { name: "Biscotti", nova: 4 });
const products = new Map<string, Product>([["B1", biscuits]]);

describe("trackedWindow", () => {
  it("parte dal primo giorno con consumi, tra 7 e 28 giorni", () => {
    expect(trackedWindow([day("2026-11-10", [resolved("B1", 50, "g")])], TODAY).windowDays).toBe(8);
    expect(trackedWindow([day("2026-11-16", [resolved("B1", 50, "g")])], TODAY).windowDays).toBe(7);
    expect(trackedWindow([day("2026-08-01", [resolved("B1", 50, "g")])], TODAY)).toEqual({ from: "2026-10-21", to: TODAY, windowDays: 28 });
  });
  it("senza consumi usa sette giorni", () => {
    expect(trackedWindow([], TODAY).windowDays).toBe(7);
  });
  it("i giorni senza voci non spostano l'inizio", () => {
    expect(trackedWindow([day("2026-11-01", []), day("2026-11-14", [resolved("B1", 50, "g")])], TODAY).windowDays).toBe(7);
  });
});

describe("consumptionEntries", () => {
  it("usa i consumi legati a un prodotto e conta il resto a parte", () => {
    const s = consumptionEntries(
      [
        day("2026-11-11", [
          resolved("B1", 50, "g"),
          resolved("B1", 30, "pz"),
          resolved("ZZ", 50, "g"),
          resolved(undefined, 100, "g", "name"),
          unresolvedPantry,
        ]),
      ],
      products,
      TODAY,
    );
    expect(s.windowDays).toBe(7);
    expect(s.productLines).toBe(1);
    expect(s.unusableLines).toBe(3);
    expect(s.otherLines).toBe(1);
    expect(s.entries[0]).toMatchObject({ amount: 50, unit: "g", timesPerWeek: 1 });
  });

  it("scarta i giorni fuori dalla finestra e quelli futuri", () => {
    const s = consumptionEntries([day("2026-12-01", [resolved("B1", 50, "g")]), day("2026-11-17", [resolved("B1", 50, "g")])], products, TODAY);
    expect(s.productLines).toBe(1);
  });
});

describe("buildDietImpact", () => {
  it("calcola zuccheri a settimana: 50 g di biscotti al 30% una volta in sette giorni = 15 g", () => {
    const { report } = buildDietImpact([day("2026-11-12", [resolved("B1", 50, "g")])], products, TODAY);
    expect(report.metrics.sugars.totalPerWeek).toBe(15);
    expect(report.metrics.sugars.complete).toBe(true);
    expect(report.metrics.ultraProcessed.totalPerWeek).toBe(1);
    expect(report.changes[0].barcode).toBe("B1");
  });
  it("senza consumi non produce totali né cambi", () => {
    const { report, summary } = buildDietImpact([], products, TODAY);
    expect(summary.entries).toHaveLength(0);
    expect(report.changes).toHaveLength(0);
    expect(report.metrics.sugars.entriesTotal).toBe(0);
  });
});

describe("codici interni e locali nei consumi", () => {
  const shop = withNutrients("2012345000000", { sugars: 50 }, { name: "Dolce del banco", nova: 4 });
  const home = withNutrients("2990000012345", { sugars: 10 }, { name: "Torta di casa", source: "manual", localFromName: true });
  const map = new Map<string, Product>([
    ["2012345000000", shop],
    ["2990000012345", home],
  ]);
  const days = [day(TODAY, [resolved("2012345000000", 100, "g"), resolved("2990000012345", 100, "g")])];

  it("esclude le schede di codici interni del negozio e le conta a parte", () => {
    const s = consumptionEntries(days, map, TODAY);
    expect(s.entries.map((e) => e.product.barcode)).toEqual(["2990000012345"]);
    expect(s.restrictedLines).toBe(1);
  });
  it("non le mette tra i prodotti che pesano di più", () => {
    const view = buildDietImpact(days, map, TODAY);
    const names = Object.values(view.report.metrics).flatMap((m) => m.contributors.map((c) => c.barcode));
    expect(names).not.toContain("2012345000000");
  });
  it("dice quanti restano fuori", () => {
    expect(restrictedExcludedText(0)).toBe("");
    expect(restrictedExcludedText(2)).toContain("2 consumi restano fuori");
  });
});
