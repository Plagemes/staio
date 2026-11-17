import { describe, expect, it } from "vitest";
import { projectWeight } from "@/core/analysis";
import { weightMovingAverage, weightSeries } from "@/core/diary";
import { analyze, dateOf, noise, rng, weighIn } from "@/core/analysis/test-helpers";
import { buildIntervalPlot, buildWeightProjectionChart, niceRange } from "./charts";

function scenario() {
  const random = rng(3);
  const events: unknown[] = [];
  for (let i = 0; i < 28; i++) events.push(weighIn(i, 80 - 0.05 * i + noise(random, 0.2)));
  const { diary } = analyze(events);
  const projection = projectWeight(diary, { to: dateOf(27) });
  return { diary, projection };
}

describe("buildWeightProjectionChart", () => {
  it("disegna pesate, media, linea attesa e due bande che si allargano", () => {
    const { diary, projection } = scenario();
    expect(projection.status).toBe("ok");
    if (projection.status !== "ok") return;
    const chart = buildWeightProjectionChart({
      weights: weightSeries(diary),
      average: weightMovingAverage(diary, { windowDays: 7 }),
      projection,
    });
    expect(chart).toBeDefined();
    if (!chart) return;
    expect(chart.dots).toHaveLength(28);
    expect(chart.expected).toHaveLength(projection.points.length);
    // poligono chiuso: andata sul bordo alto e ritorno sul basso
    expect(chart.trendBand).toHaveLength(projection.points.length * 2);
    expect(chart.dailyBand).toHaveLength(projection.points.length * 2);

    const n = projection.points.length;
    const widthAt = (band: typeof chart.trendBand, i: number) => band[2 * n - 1 - i].y - band[i].y;
    expect(widthAt(chart.trendBand, n - 1)).toBeGreaterThan(widthAt(chart.trendBand, 0));
    // la banda di una singola pesata contiene sempre quella della tendenza
    expect(widthAt(chart.dailyBand, 0)).toBeGreaterThan(widthAt(chart.trendBand, 0));
  });

  it("tutti i punti stanno dentro l'area del grafico", () => {
    const { diary, projection } = scenario();
    if (projection.status !== "ok") throw new Error("atteso ok");
    const chart = buildWeightProjectionChart({ weights: weightSeries(diary), average: [], projection });
    if (!chart) throw new Error("atteso un grafico");
    const all = [...chart.dots, ...chart.expected, ...chart.trendBand, ...chart.dailyBand];
    for (const p of all) {
      expect(p.x).toBeGreaterThanOrEqual(chart.plotLeft - 0.001);
      expect(p.x).toBeLessThanOrEqual(chart.plotRight + 0.001);
      expect(p.y).toBeGreaterThanOrEqual(chart.plotTop - 0.001);
      expect(p.y).toBeLessThanOrEqual(chart.plotBottom + 0.001);
    }
    expect(chart.splitX).toBeCloseTo(chart.dots[chart.dots.length - 1].x, 5);
  });

  it("l'alternativa testuale dà valore centrale e intervalli insieme", () => {
    const { diary, projection } = scenario();
    if (projection.status !== "ok") throw new Error("atteso ok");
    const chart = buildWeightProjectionChart({ weights: weightSeries(diary), average: [], projection });
    expect(chart?.description).toMatch(/Tendenza osservata/);
    expect(chart?.description).toMatch(/intervallo da/);
    expect(chart?.description).toMatch(/banda della tendenza tra/);
    expect(chart?.description).toMatch(/proiezione, non una previsione/);
    expect(chart?.table).toHaveLength(projection.points.length);
  });

  it("senza proiezione mostra solo le pesate e lo dice", () => {
    const { diary } = scenario();
    const chart = buildWeightProjectionChart({ weights: weightSeries(diary).slice(0, 3), average: [] });
    expect(chart?.expected).toEqual([]);
    expect(chart?.trendBand).toEqual([]);
    expect(chart?.splitX).toBeUndefined();
    expect(chart?.description).toMatch(/Nessuna proiezione: dati insufficienti/);
  });

  it("una sola pesata non rompe la scala", () => {
    const chart = buildWeightProjectionChart({ weights: [{ date: "2026-03-02", kg: 70, certainty: "measured" }], average: [] });
    expect(chart?.dots).toHaveLength(1);
    expect(Number.isFinite(chart?.dots[0].x)).toBe(true);
    expect(Number.isFinite(chart?.dots[0].y)).toBe(true);
  });

  it("niente pesate: niente grafico", () => {
    expect(buildWeightProjectionChart({ weights: [], average: [] })).toBeUndefined();
  });
});

describe("niceRange", () => {
  it("non scende mai sotto due chili di scala", () => {
    const r = niceRange(70.1, 70.3);
    expect(r.hi - r.lo).toBeGreaterThanOrEqual(2);
    expect(r.lo).toBeLessThanOrEqual(70.1);
    expect(r.hi).toBeGreaterThanOrEqual(70.3);
  });
});

describe("buildIntervalPlot", () => {
  it("l'intervallo che attraversa lo zero si vede e si dice", () => {
    const p = buildIntervalPlot(0.1, -0.3, 0.5, "punti", 2);
    expect(p.includesZero).toBe(true);
    expect(p.lowX).toBeLessThan(p.zeroX);
    expect(p.highX).toBeGreaterThan(p.zeroX);
    expect(p.description).toMatch(/comprende lo zero/);
    expect(p.description).toMatch(/da −0,3 a \+0,5/);
  });

  it("l'intervallo tutto da una parte esclude lo zero", () => {
    const p = buildIntervalPlot(0.4, 0.2, 0.6, "punti", 2);
    expect(p.includesZero).toBe(false);
    expect(p.zeroX).toBeLessThan(p.lowX);
    expect(p.description).toMatch(/non comprende lo zero/);
  });

  it("la scala comprende sempre lo zero e tutti i punti", () => {
    const p = buildIntervalPlot(-5, -8, -2, "kcal", 0, 300);
    for (const x of [p.zeroX, p.lowX, p.highX, p.valueX]) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(300);
    }
    expect(p.valueX).toBeLessThan(p.zeroX);
  });
});
