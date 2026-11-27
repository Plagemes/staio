import { describe, expect, it } from "vitest";
import type { ImpactMetric, ImpactReport, MetricImpact } from "@/core/quality";
import type { DietImpactView } from "../quality/consumption";
import { qualityCardView } from "./qualityCardText";

const metric = (m: ImpactMetric, over: Partial<MetricImpact> = {}): MetricImpact => ({
  metric: m,
  unit: m === "ultraProcessed" ? "occasions" : "g",
  totalPerWeek: 0,
  entriesWithData: 0,
  entriesTotal: 0,
  complete: true,
  contributors: [],
  ...over,
});

function view(productLines: number, report: Partial<ImpactReport> = {}, ultra: Partial<MetricImpact> = {}): DietImpactView {
  return {
    summary: { entries: [], windowDays: 14, from: "2026-11-14", to: "2026-11-27", productLines, unusableLines: 0, restrictedLines: 0, otherLines: 0 },
    report: {
      metrics: {
        sugars: metric("sugars"),
        salt: metric("salt"),
        saturatedFat: metric("saturatedFat"),
        ultraProcessed: metric("ultraProcessed", ultra),
      },
      changes: [],
      excluded: [],
      ...report,
    },
  };
}

describe("qualityCardView", () => {
  it("non c'è senza dati o senza consumi di prodotti", () => {
    expect(qualityCardView(undefined)).toBeNull();
    expect(qualityCardView(view(0))).toBeNull();
  });

  it("dice i prodotti molto lavorati e quello che pesa di più", () => {
    const v = view(
      6,
      { changes: [{ barcode: "1", name: "Merendine", effects: [{ metric: "sugars", perWeek: 40, share: 0.32 }] }] },
      { entriesWithData: 6, entriesTotal: 6, totalPerWeek: 3, complete: true },
    );
    expect(qualityCardView(v)?.lines).toEqual([
      "Prodotti molto lavorati: 3 consumi a settimana, in media sugli ultimi 14 giorni.",
      "Pesa di più: Merendine, 32% del totale di zuccheri.",
    ]);
  });

  it("senza il dato sui molto lavorati conta i consumi e non inventa altro", () => {
    expect(qualityCardView(view(1))?.lines).toEqual(["1 consumo di prodotti con codice a barre negli ultimi 14 giorni."]);
  });

  it("dichiara un totale parziale con «almeno»", () => {
    const v = view(5, {}, { entriesWithData: 3, entriesTotal: 5, totalPerWeek: 2, complete: false });
    expect(qualityCardView(v)?.lines[0]).toContain("almeno 2 consumi a settimana");
  });
});
