import { describe, expect, it } from "vitest";
import { projectWeight } from "./projection";
import { analyze, noise, rng, shuffled, weighIn, dateOf } from "./test-helpers";

function weights(n: number, slope: number, sd: number, seed = 5): unknown[] {
  const random = rng(seed);
  return Array.from({ length: n }, (_, i) => weighIn(i, 80 + slope * i + noise(random, sd)));
}

describe("projectWeight", () => {
  it("proietta la tendenza con una banda che si allarga", () => {
    const { diary } = analyze(weights(28, -0.05, 0.25));
    const r = projectWeight(diary);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.trendKgPerWeek).toBeCloseTo(-0.35, 1);
    expect(r.trendDistinguishableFromFlat).toBe(true);
    const widths = r.points.map((p) => p.trendHighKg - p.trendLowKg);
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    const last = r.points[r.points.length - 1];
    expect(last.daysAhead).toBe(28);
    expect(last.date).toBe(dateOf(27 + 28));
    expect(last.expectedKg).toBeLessThan(r.points[0].expectedKg);
    // La banda di una singola pesata contiene quella della tendenza.
    expect(last.dailyHighKg - last.dailyLowKg).toBeGreaterThan(last.trendHighKg - last.trendLowKg);
    expect(r.basis).toMatchObject({ periodDays: 28, usedDays: 28, observations: 28 });
    expect(r.assumptions.length).toBeGreaterThan(0);
  });

  it("non va mai oltre l'orizzonte massimo", () => {
    const { diary } = analyze(weights(28, -0.05, 0.25));
    const r = projectWeight(diary, { horizonDays: 400, maxHorizonDays: 56 });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.horizonDays).toBe(56);
    expect(r.horizonClamped).toBe(true);
    expect(Math.max(...r.points.map((p) => p.daysAhead))).toBe(56);
    expect(r.reliability).toBe("low");
  });

  it("dati insufficienti con poche pesate", () => {
    const { diary } = analyze(weights(5, -0.05, 0.1));
    const r = projectWeight(diary);
    expect(r.status).toBe("insufficient");
    if (r.status === "insufficient") {
      expect(r.reasons).toContain("few_weigh_ins");
      expect(r).not.toHaveProperty("points");
    }
  });

  it("dati insufficienti con pesate concentrate in pochi giorni", () => {
    const { diary } = analyze(weights(10, -0.05, 0.1));
    const r = projectWeight(diary);
    expect(r.status === "insufficient" && r.reasons).toEqual(["short_weight_span"]);
  });

  it("una tendenza troppo rumorosa non si proietta", () => {
    const { diary } = analyze(weights(28, 0, 3.5));
    const r = projectWeight(diary);
    expect(r.status === "insufficient" && r.reasons).toEqual(["noisy_trend"]);
  });

  it("pesate vecchie rispetto a oggi", () => {
    const { diary } = analyze(weights(28, -0.05, 0.2));
    const r = projectWeight(diary, { asOf: dateOf(27 + 30) });
    // Da solo: le pesate bastano, è solo troppo vecchia l'ultima.
    expect(r.status === "insufficient" && r.reasons).toEqual(["stale_data"]);
    expect(r.status === "insufficient" && r.basis.lastDataDate).toBe(dateOf(27));
    // Entro la tolleranza o senza data di riferimento si proietta.
    expect(projectWeight(diary, { asOf: dateOf(27 + 10) }).status).toBe("ok");
    expect(projectWeight(diary).status).toBe("ok");
  });

  it("un peso stabile non risulta in calo", () => {
    const { diary } = analyze(weights(28, 0, 0.4, 11));
    const r = projectWeight(diary);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.trendInterval.low).toBeLessThan(0);
    expect(r.trendInterval.high).toBeGreaterThan(0);
    expect(r.trendDistinguishableFromFlat).toBe(false);
  });

  it("non dipende dall'ordine degli eventi", () => {
    const events = weights(28, -0.05, 0.25);
    const a = projectWeight(analyze(events).diary);
    const b = projectWeight(analyze(shuffled(events, rng(2))).diary);
    expect(b).toEqual(a);
  });

  it("nessuna pesata", () => {
    const r = projectWeight(analyze([]).diary);
    expect(r.status === "insufficient" && r.reasons).toEqual(["no_data"]);
  });
});
