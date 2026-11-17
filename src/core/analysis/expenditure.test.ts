import { describe, expect, it } from "vitest";
import { estimateExpenditure } from "./expenditure";
import { analyze, day, noise, rng, shuffled, weighIn, dateOf } from "./test-helpers";

/** Giorni con energia fissa e peso in calo regolare con rumore. */
function scenario(opts: { kcal?: number; slope?: number; sd?: number; days?: number; weighEvery?: number } = {}) {
  const { kcal = 2200, slope = -0.05, sd = 0.2, days = 28, weighEvery = 1 } = opts;
  const random = rng(7);
  const events: unknown[] = [];
  for (let i = 0; i < days; i++) {
    events.push(...day(i, { kcal }));
    if (i % weighEvery === 0) events.push(weighIn(i, 80 + slope * i + noise(random, sd)));
  }
  return events;
}

describe("estimateExpenditure", () => {
  it("ricostruisce il dispendio dal bilancio e lo racchiude in un intervallo", () => {
    const { diary, intakeDays } = analyze(scenario());
    const r = estimateExpenditure(diary, intakeDays);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    // 2200 assunte e 0,05 kg al giorno persi a 7700 kcal/kg: circa 2585.
    expect(r.expenditureKcal).toBeGreaterThan(2450);
    expect(r.expenditureKcal).toBeLessThan(2720);
    expect(r.interval.low).toBeLessThan(r.expenditureKcal);
    expect(r.interval.high).toBeGreaterThan(r.expenditureKcal);
    expect(2585).toBeGreaterThanOrEqual(r.interval.low);
    expect(2585).toBeLessThanOrEqual(r.interval.high);
    expect(r.meanIntakeKcal).toBe(2200);
    expect(r.weightTrendKgPerWeek).toBeCloseTo(-0.35, 1);
    expect(r.basis).toMatchObject({ periodDays: 28, usedDays: 28, excludedDays: 0, observations: 28 });
    expect(r.assumptions.length).toBeGreaterThan(0);
    expect(r.smoothedWeights.length).toBe(28);
  });

  it("il parametro dell'equivalente energetico cambia il risultato in modo dichiarato", () => {
    const { diary, intakeDays } = analyze(scenario());
    const a = estimateExpenditure(diary, intakeDays);
    const b = estimateExpenditure(diary, intakeDays, { energyPerKgKcal: 6000 });
    if (a.status !== "ok" || b.status !== "ok") throw new Error("atteso ok");
    expect(b.expenditureKcal).toBeLessThan(a.expenditureKcal);
    expect(b.energyPerKgKcal).toBe(6000);
  });

  it("dati insufficienti: pochi giorni completi", () => {
    const { diary, intakeDays } = analyze(scenario({ days: 10 }));
    const r = estimateExpenditure(diary, intakeDays);
    expect(r.status).toBe("insufficient");
    if (r.status === "insufficient") {
      expect(r.reasons).toContain("few_complete_days");
      expect(r.message).toMatch(/^Dati insufficienti/);
      expect(r).not.toHaveProperty("expenditureKcal");
    }
  });

  it("dati insufficienti: poche pesate", () => {
    const { diary, intakeDays } = analyze(scenario({ weighEvery: 7 }));
    const r = estimateExpenditure(diary, intakeDays);
    expect(r.status).toBe("insufficient");
    if (r.status === "insufficient") expect(r.reasons).toContain("few_weigh_ins");
  });

  it("nessun dato", () => {
    const { diary } = analyze([]);
    const r = estimateExpenditure(diary, []);
    expect(r.status === "insufficient" && r.reasons).toEqual(["no_data"]);
  });

  it("i giorni con vuoti sono esclusi e contati", () => {
    const events: unknown[] = [];
    const random = rng(3);
    for (let i = 0; i < 28; i++) {
      events.push(...day(i, i % 4 === 3 ? { kcal: 5000, skip: ["dinner"] } : { kcal: 2200 }));
      events.push(weighIn(i, 80 - 0.05 * i + noise(random, 0.2)));
    }
    const { diary, intakeDays } = analyze(events);
    const r = estimateExpenditure(diary, intakeDays);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.basis.usedDays).toBe(21);
    expect(r.basis.excludedDays).toBe(7);
    expect(r.exclusions.incompleteDays).toBe(7);
    expect(r.meanIntakeKcal).toBe(2200);
  });

  it("con energia parziale (quota mancante sopra soglia) non calcola", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      events.push(...day(i, { kcal: 1500, lunchItems: [{ name: "Dolce misterioso", grams: 400 }] }));
      events.push(weighIn(i, 80));
    }
    const { diary, intakeDays } = analyze(events);
    const r = estimateExpenditure(diary, intakeDays);
    expect(r.status).toBe("insufficient");
    if (r.status === "insufficient") {
      expect(r.reasons).toContain("partial_energy");
      expect(r.exclusions.partialEnergyDays).toBe(28);
    }
    // Con una soglia più larga la stessa serie diventa calcolabile.
    const loose = estimateExpenditure(diary, intakeDays, { maxEnergyMissingShare: 0.9 });
    expect(loose.status).toBe("ok");
  });

  it("una serie rumorosa dà un intervallo più largo di una regolare", () => {
    const calm = analyze(scenario({ sd: 0.1 }));
    const noisy = analyze(scenario({ sd: 1.2 }));
    const a = estimateExpenditure(calm.diary, calm.intakeDays);
    const b = estimateExpenditure(noisy.diary, noisy.intakeDays);
    if (a.status !== "ok" || b.status !== "ok") throw new Error("atteso ok");
    expect(b.interval.high - b.interval.low).toBeGreaterThan(a.interval.high - a.interval.low);
    expect(b.reliability === "low" || b.reliability === "moderate").toBe(true);
  });

  it("un bilancio incoerente non diventa un numero", () => {
    const { diary, intakeDays } = analyze(scenario({ kcal: 300, slope: 0 }));
    const r = estimateExpenditure(diary, intakeDays);
    expect(r.status === "insufficient" && r.reasons).toEqual(["implausible_estimate"]);
  });

  it("non dipende dall'ordine degli eventi", () => {
    const events = scenario();
    const a = analyze(events);
    const b = analyze(shuffled(events, rng(99)));
    expect(estimateExpenditure(b.diary, b.intakeDays)).toEqual(estimateExpenditure(a.diary, a.intakeDays));
  });

  it("la finestra è quella richiesta", () => {
    const { diary, intakeDays } = analyze(scenario({ days: 40 }));
    const r = estimateExpenditure(diary, intakeDays, { to: dateOf(34), windowDays: 21 });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.window).toEqual({ from: dateOf(14), to: dateOf(34) });
    expect(r.basis.periodDays).toBe(21);
  });

  it("dice l'ultima data usata e non presenta come attuale un risultato vecchio", () => {
    const { diary, intakeDays } = analyze(scenario());
    const fresh = estimateExpenditure(diary, intakeDays, { today: dateOf(29) });
    if (fresh.status !== "ok") throw new Error("atteso ok");
    expect(fresh.basis.lastDataDate).toBe(dateOf(27));
    expect(fresh.freshness).toMatchObject({ lastDataDate: dateOf(27), referenceDate: dateOf(29), daysBehind: 2, dated: false });
    expect(fresh.warnings).toEqual([]);

    // Quattro settimane di pausa: la stima c'è ma è datata e lo dice.
    const old = estimateExpenditure(diary, intakeDays, { today: dateOf(27 + 28) });
    if (old.status !== "ok") throw new Error("atteso ok");
    expect(old.freshness).toMatchObject({ daysBehind: 28, dated: true });
    expect(old.warnings[0]).toMatch(/datato.*ultimo dato è del 2026-03-29/);

    // Anche con `to` esplicito si confronta l'ultimo dato con la fine richiesta.
    const toOnly = estimateExpenditure(diary, intakeDays, { to: dateOf(27 + 20), windowDays: 48, minUsedShare: 0.5 });
    expect(toOnly.status === "ok" && toOnly.freshness.dated).toBe(true);

    // Senza `today` né `to` la freschezza non è verificabile: non si dichiara né attuale né datata.
    const unknown = estimateExpenditure(diary, intakeDays);
    if (unknown.status !== "ok") throw new Error("atteso ok");
    expect(unknown.freshness.referenceDate).toBeUndefined();
    expect(unknown.freshness.dated).toBe(false);
  });

  it("anche l'esito insufficiente porta la data dell'ultimo dato", () => {
    const { diary, intakeDays } = analyze(scenario({ days: 10 }));
    const r = estimateExpenditure(diary, intakeDays);
    expect(r.status === "insufficient" && r.basis.lastDataDate).toBe(dateOf(9));
  });

  it("troppi giorni con vuoti nella finestra: low_used_share, da solo", () => {
    // 15 giorni completi su 28 (54%): sopra il minimo di giorni (14) ma sotto la quota minima (60%).
    const random = rng(41);
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      events.push(...day(i, i < 15 ? { kcal: 2200 } : { skip: ["dinner"] }));
      events.push(weighIn(i, 80 - 0.05 * i + noise(random, 0.2)));
    }
    const { diary, intakeDays } = analyze(events);
    const r = estimateExpenditure(diary, intakeDays);
    expect(r.status === "insufficient" && r.reasons).toEqual(["low_used_share"]);
    expect(estimateExpenditure(diary, intakeDays, { minUsedShare: 0.5 }).status).toBe("ok");
  });

  it("pesate concentrate in pochi giorni: short_weight_span, da solo", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      events.push(...day(i, { kcal: 2200 }));
      if (i < 10) events.push(weighIn(i, 80 - 0.05 * i));
    }
    const { diary, intakeDays } = analyze(events);
    const r = estimateExpenditure(diary, intakeDays);
    expect(r.status === "insufficient" && r.reasons).toEqual(["short_weight_span"]);
  });
});
