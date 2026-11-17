import { describe, expect, it } from "vitest";
import { analyze, dateOf, day, moodOn, noise, rng, weighIn } from "@/core/analysis/test-helpers";
import { computeAnalysis, computeAssociations } from "./compute";
import { buildWeightProjectionChart } from "./charts";
import {
  associationControlText,
  associationsInsufficient,
  expenditureInsufficient,
  freshnessLines,
  projectionInsufficient,
  timingInsufficient,
} from "./present";

function rich(days = 30) {
  const random = rng(11);
  const events: unknown[] = [];
  for (let i = 0; i < days; i++) {
    events.push(...day(i, { kcal: 2200 }));
    events.push(weighIn(i, 80 - 0.05 * i + noise(random, 0.2)));
    events.push(moodOn(i, 3 + (i % 3)));
  }
  return events;
}

describe("computeAnalysis", () => {
  it("con un mese di dati dà stime con intervallo e base", () => {
    const { diary, intakeDays } = analyze(rich());
    const a = computeAnalysis(diary, intakeDays, dateOf(29));
    expect(a.expenditure.status).toBe("ok");
    expect(a.projection.status).toBe("ok");
    expect(a.timing.status).toBe("ok");
    if (a.expenditure.status === "ok") {
      expect(a.expenditure.interval.low).toBeLessThan(a.expenditure.expenditureKcal);
      expect(a.expenditure.basis.usedDays).toBeGreaterThanOrEqual(14);
    }
    if (a.expenditure.status === "ok") {
      expect(a.expenditure.freshness.dated).toBe(false);
      expect(a.expenditure.freshness.lastDataDate).toBe(dateOf(29));
    }
    expect(a.weights.length).toBeGreaterThan(20);
    expect(a.weightSpanDays).toBeGreaterThan(14);
    expect(a.daysSinceLastWeighIn).toBe(0);
  });

  it("senza dati sufficienti restituisce esiti insufficienti con il perché e cosa manca", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 3; i++) events.push(...day(i), weighIn(i, 80));
    const { diary, intakeDays } = analyze(events);
    const a = computeAnalysis(diary, intakeDays, dateOf(2));
    expect(a.expenditure.status).toBe("insufficient");
    expect(a.projection.status).toBe("insufficient");
    expect(a.timing.status).toBe("insufficient");
    const associations = computeAssociations(diary, intakeDays, dateOf(2));
    expect(associations.status).toBe("insufficient");

    if (a.expenditure.status === "insufficient") {
      const v = expenditureInsufficient(a.expenditure, { weightSpanDays: a.expenditureWeightSpanDays });
      expect(v.reasons.join(" ")).toMatch(/3 tracciati per intero/);
      expect(v.missing.join(" ")).toMatch(/Mancano ancora 11 giorni/);
      expect(v.missing.join(" ")).toMatch(/Mancano ancora 5 pesate/);
    }
    if (a.projection.status === "insufficient") {
      const v = projectionInsufficient(a.projection, { weightSpanDays: a.weightSpanDays, daysSinceLastWeighIn: a.daysSinceLastWeighIn });
      expect(v.missing.join(" ")).toMatch(/Mancano ancora 5 pesate/);
      expect(v.reasons.join(" ")).toMatch(/3 pesate/);
    }
    if (a.timing.status === "insufficient") {
      const v = timingInsufficient(a.timing);
      expect(v.reasons[0]).toMatch(/3 giorni/);
      expect(v.missing[0]).toMatch(/Mancano ancora 4 giorni/);
    }
    if (associations.status === "insufficient") {
      const v = associationsInsufficient(associations);
      expect(v.missing[0]).toMatch(/Mancano ancora 11 giorni/);
    }
  });

  it("senza nessun dato non rompe e non dà zeri", () => {
    const { diary, intakeDays } = analyze([]);
    const a = computeAnalysis(diary, intakeDays, "2026-03-10");
    expect(a.expenditure.status).toBe("insufficient");
    expect(a.weights).toEqual([]);
    expect(buildWeightProjectionChart({ weights: a.weights, average: a.average })).toBeUndefined();
    if (a.projection.status === "insufficient") {
      const v = projectionInsufficient(a.projection, { weightSpanDays: 0 });
      expect(v.reasons[0]).toMatch(/0 pesate/);
      expect(v.missing[0]).toMatch(/Mancano ancora 8 pesate/);
    }
  });

  it("pesate vecchie: la proiezione non parte", () => {
    const { diary, intakeDays } = analyze(rich(30));
    const a = computeAnalysis(diary, intakeDays, dateOf(44));
    expect(a.projection.status).toBe("insufficient");
    if (a.projection.status === "insufficient") {
      expect(a.projection.reasons).toContain("stale_data");
      const v = projectionInsufficient(a.projection, { weightSpanDays: a.weightSpanDays, daysSinceLastWeighIn: a.daysSinceLastWeighIn });
      expect(v.reasons.join(" ")).toMatch(/giorni fa/);
    }
  });

  it("un risultato con l'ultimo dato vecchio è datato e lo dice", () => {
    const { diary, intakeDays } = analyze(rich(30));
    // l'ultimo dato è del giorno 29; oggi è il giorno 38
    const a = computeAnalysis(diary, intakeDays, dateOf(38));
    expect(a.expenditure.status).toBe("ok");
    if (a.expenditure.status !== "ok") return;
    expect(a.expenditure.freshness.dated).toBe(true);
    expect(a.expenditure.freshness.daysBehind).toBe(9);
    const lines = freshnessLines(a.expenditure.freshness, a.expenditure.warnings);
    expect(lines.dated).toMatch(/Risultato datato/);
    expect(lines.dated).toMatch(/9 giorni fa/);
    expect(lines.last).toMatch(/Ultimo dato usato/);
  });

  it("le associazioni dichiarano confronti e controllo, e che la garanzia vale per giorni scambiabili", () => {
    const { diary, intakeDays } = analyze(rich(60));
    const r = computeAssociations(diary, intakeDays, dateOf(59));
    if (r.status !== "ok") return;
    const text = associationControlText(r.control).join(" ");
    expect(text).toContain(`${r.control.comparisons} confronti`);
    expect(text).toMatch(/senza andamenti nel tempo/);
    expect(text).toMatch(/al massimo del \d+%/);
  });
});
