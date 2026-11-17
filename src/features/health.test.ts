import { describe, expect, it } from "vitest";
import { createSupplement, createWeight, deriveDiary } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import {
  alcoholGrams,
  averageChange,
  buildWeightChart,
  DRINK_PRESETS,
  formatKg,
  formatMl,
  parseWaterAmount,
  parseWaterGoal,
  parseWeightKg,
  recentSupplementNames,
} from "./health";

const TODAY = "2026-11-16";
const weight = (date: string, kg: number): AnyEvent =>
  createWeight({ kg }, { deviceId: "d", at: `${date}T09:00:00.000Z`, now: () => `${date}T09:00:00.000Z` });
const supplement = (date: string, name: string): AnyEvent =>
  createSupplement({ name }, { deviceId: "d", at: `${date}T09:00:00.000Z`, now: () => `${date}T09:00:00.000Z` });

describe("acqua", () => {
  it("quantità scritte a mano", () => {
    expect(parseWaterAmount("300")).toEqual({ ok: true, value: 300 });
    expect(parseWaterAmount("0,5 l")).toEqual({ ok: true, value: 500 });
    expect(parseWaterAmount("250 ml")).toEqual({ ok: true, value: 250 });
  });

  it("rifiuta il resto con una spiegazione", () => {
    for (const bad of ["", "tanta", "2 g", "5", "20 l"]) {
      const r = parseWaterAmount(bad);
      expect(r.ok, bad).toBe(false);
    }
  });

  it("l'obiettivo: un numero piccolo vale come litri", () => {
    expect(parseWaterGoal("2")).toEqual({ ok: true, value: 2000 });
    expect(parseWaterGoal("2,5 l")).toEqual({ ok: true, value: 2500 });
    expect(parseWaterGoal("1800")).toEqual({ ok: true, value: 1800 });
    expect(parseWaterGoal("100").ok).toBe(false);
    expect(parseWaterGoal("30 l").ok).toBe(false);
  });

  it("formato", () => {
    expect(formatMl(200)).toBe("200 ml");
    expect(formatMl(1400)).toBe("1,4 l");
  });
});

describe("peso", () => {
  it("legge i chili con la virgola", () => {
    expect(parseWeightKg("71,4")).toEqual({ ok: true, value: 71.4 });
    expect(parseWeightKg("71.4 kg")).toEqual({ ok: true, value: 71.4 });
    expect(parseWeightKg("70")).toEqual({ ok: true, value: 70 });
  });

  it("rifiuta valori impossibili", () => {
    for (const bad of ["", "abc", "0", "600", "71,456", "-3"]) expect(parseWeightKg(bad).ok, bad).toBe(false);
  });

  it("formato", () => {
    expect(formatKg(71.44)).toBe("71,4 kg");
    expect(formatKg(70)).toBe("70,0 kg");
  });
});

describe("grafico del peso", () => {
  it("senza pesate: niente punti", () => {
    const chart = buildWeightChart(deriveDiary([]), TODAY);
    expect(chart).toMatchObject({ count: 0, enough: false, dots: [], average: [] });
    expect(chart.last).toBeUndefined();
  });

  it("pochi dati: i punti ci sono ma non si dichiara un andamento", () => {
    const chart = buildWeightChart(deriveDiary([weight("2026-11-10", 71), weight("2026-11-14", 70.8)]), TODAY);
    expect(chart.count).toBe(2);
    expect(chart.enough).toBe(false);
    expect(averageChange(chart)).toBeUndefined();
  });

  it("con abbastanza dati: coordinate dentro l'area e media mobile", () => {
    const events = [
      weight("2026-10-20", 72),
      weight("2026-10-27", 71.6),
      weight("2026-11-03", 71.2),
      weight("2026-11-10", 71),
      weight("2026-11-16", 70.6),
    ];
    const chart = buildWeightChart(deriveDiary(events), TODAY);
    expect(chart.enough).toBe(true);
    expect(chart.dots).toHaveLength(5);
    for (const p of [...chart.dots, ...chart.average]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(chart.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(chart.height);
    }
    // pesi più bassi stanno più in basso (y maggiore), giorni più recenti più a destra
    expect(chart.dots[4].y).toBeGreaterThan(chart.dots[0].y);
    expect(chart.dots[4].x).toBeGreaterThan(chart.dots[0].x);
    expect(chart.lastAverage?.samples).toBe(2);
    expect(averageChange(chart)).toBeLessThan(0);
  });

  it("fuori dai 30 giorni non conta", () => {
    const chart = buildWeightChart(deriveDiary([weight("2026-09-01", 75), weight("2026-11-15", 70)]), TODAY);
    expect(chart.count).toBe(1);
  });

  it("una scala mai più stretta di un chilo", () => {
    const events = [weight("2026-11-01", 70), weight("2026-11-08", 70.1), weight("2026-11-15", 70.05)];
    const chart = buildWeightChart(deriveDiary(events), TODAY);
    expect(chart.yMax - chart.yMin).toBeGreaterThanOrEqual(1);
  });
});

describe("bevande e integratori", () => {
  it("l'alcol dalla gradazione", () => {
    expect(alcoholGrams(330, 5)).toBe(13);
    expect(alcoholGrams(150, 12)).toBe(14.2);
    const beer = DRINK_PRESETS.find((p) => p.id === "beer");
    expect(beer?.alcoholG).toBe(13);
    expect(beer?.caffeineMg).toBeUndefined();
  });

  it("integratori recenti, dal più frequente", () => {
    const events = [
      supplement("2026-11-14", "Vitamina D"),
      supplement("2026-11-15", "Magnesio"),
      supplement("2026-11-16", "vitamina d"),
      supplement("2026-09-01", "Ferro"),
    ];
    expect(recentSupplementNames(deriveDiary(events), TODAY)).toEqual(["Vitamina D", "Magnesio"]);
  });
});
