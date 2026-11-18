import { describe, expect, it } from "vitest";
import {
  EXPERIMENT_MEASURES,
  InvalidExperimentEventError,
  compareExperiment,
  createExperiment,
  deriveExperiments,
  isExperimentEvent,
  validateExperimentEvent,
  type ExperimentBody,
} from "./experiments";
import { voidOf } from "../diary/test-helpers";
import { analyze, dateOf, day, moodOn, noise, rng, shuffled, symptomOn, weighIn } from "./test-helpers";

const body: ExperimentBody = {
  experimentId: "senza-latte",
  title: "Due settimane senza latte",
  change: "Niente latte né yogurt",
  startDate: dateOf(14),
  endDate: dateOf(27),
  measures: ["mood", "symptomDigestion"],
  excludedFoods: ["latte"],
};

let n = 0;
const make = (over: Partial<ExperimentBody> = {}, recordedAt = "2026-03-01T10:00:00.000Z") =>
  createExperiment(
    { ...body, ...over },
    {
      deviceId: "dev-a",
      now: () => recordedAt,
      idGenerator: () => `exp-${++n}`,
    },
  );

describe("validateExperimentEvent", () => {
  it("accetta un evento creato dal costruttore", () => {
    const e = make();
    expect(e.type).toBe("experiment");
    expect(validateExperimentEvent(e)).toEqual([]);
    expect(isExperimentEvent(e)).toBe(true);
  });

  it("segnala i campi mancanti e non validi senza lanciare", () => {
    const e = make();
    const bad = (patch: Record<string, unknown>) => validateExperimentEvent({ ...e, ...patch });
    expect(bad({ title: undefined })).toContainEqual({ path: "title", code: "required" });
    expect(bad({ change: " " })).toContainEqual({ path: "change", code: "invalid_type" });
    expect(bad({ startDate: "2026-02-30" })).toContainEqual({ path: "startDate", code: "invalid_date" });
    expect(bad({ endDate: dateOf(1) })).toContainEqual({ path: "endDate", code: "invalid_value" });
    expect(bad({ endDate: "2030-01-01" })).toContainEqual({ path: "endDate", code: "invalid_value" });
    expect(bad({ measures: [] })).toContainEqual({ path: "measures", code: "required" });
    expect(bad({ measures: ["mood", "mood"] })).toContainEqual({ path: "measures.1", code: "invalid_value" });
    expect(bad({ measures: ["cuore"] })).toContainEqual({ path: "measures.0", code: "invalid_value" });
    expect(bad({ declaredAdherence: 1.5 })).toContainEqual({ path: "declaredAdherence", code: "invalid_value" });
    expect(bad({ excludedFoods: [""] })).toContainEqual({ path: "excludedFoods.0", code: "invalid_type" });
    expect(bad({ type: "meal" })).toContainEqual({ path: "type", code: "invalid_value" });
    expect(validateExperimentEvent(null)).toEqual([{ path: "", code: "not_an_object" }]);
    expect(validateExperimentEvent({ ...e, id: undefined })).toContainEqual({ path: "id", code: "required" });
  });

  it("il costruttore rifiuta dati non validi", () => {
    expect(() => make({ measures: [] })).toThrow(InvalidExperimentEventError);
  });

  it("le misure ammesse comprendono umore, sintomi, peso ed energia", () => {
    expect(EXPERIMENT_MEASURES).toEqual(
      expect.arrayContaining(["mood", "symptomDigestion", "weight", "energyIntake"]),
    );
  });
});

describe("deriveExperiments", () => {
  it("vale l'ultima versione per recordedAt, e archived ritira l'esperimento", () => {
    const v1 = make({}, "2026-03-01T10:00:00.000Z");
    const v2 = make({ title: "Titolo nuovo" }, "2026-03-02T10:00:00.000Z");
    const other = make({ experimentId: "altro", startDate: dateOf(1), endDate: dateOf(3) });
    const gone = make({ experimentId: "ritirato" });
    const retired = make({ experimentId: "ritirato", archived: true }, "2026-03-03T10:00:00.000Z");
    const state = deriveExperiments([v1, v2, other, gone, retired]);
    expect(state.experiments.map((e) => [e.experimentId, e.title])).toEqual([
      ["altro", other.title],
      ["senza-latte", "Titolo nuovo"],
    ]);
    expect(state.archivedIds).toEqual(["ritirato"]);
    // I dati dell'esperimento ritirato restano consultabili.
    expect(state.archived).toHaveLength(1);
    expect(state.archived[0]).toMatchObject({
      experimentId: "ritirato",
      title: body.title,
      change: body.change,
      startDate: body.startDate,
      endDate: body.endDate,
      measures: body.measures,
      excludedFoods: body.excludedFoods,
    });
  });

  it("un void annulla l'evento; un evento non valido è un'anomalia; gli altri eventi sono ignorati", () => {
    const e = make();
    const bad = { ...make({ experimentId: "x" }), measures: [] };
    const events = [e, bad, voidOf("v1", "2026-03-05T10:00:00.000Z", e.id), ...day(0)];
    const state = deriveExperiments(events);
    expect(state.experiments).toEqual([]);
    expect(state.voidedEventIds).toEqual([e.id]);
    expect(state.anomalies.map((a) => a.code)).toEqual(["invalid_event"]);
  });

  it("non dipende dall'ordine né dai duplicati", () => {
    const events = [
      make({}, "2026-03-01T10:00:00.000Z"),
      make({ title: "B" }, "2026-03-02T10:00:00.000Z"),
      make({ experimentId: "z" }),
    ];
    const a = deriveExperiments(events);
    const b = deriveExperiments(shuffled([...events, ...events], rng(8)));
    expect(b).toEqual(a);
  });
});

/** 28 giorni: riferimento nei giorni 0-13, esperimento nei giorni 14-27. */
function series(opts: { refMood: number; expMood: number; sd?: number; dinnerWithMilk?: boolean; seed?: number }) {
  const random = rng(opts.seed ?? 21);
  const events: unknown[] = [];
  for (let i = 0; i < 28; i++) {
    const inExp = i >= 14;
    const milk = !inExp || opts.dinnerWithMilk === true;
    events.push(...day(i, { lunchItems: milk ? [{ name: "Latte intero", grams: 200 }] : [] }));
    const base = inExp ? opts.expMood : opts.refMood;
    events.push(moodOn(i, Math.min(5, Math.max(1, Math.round(base + noise(random, opts.sd ?? 0.6))))));
  }
  return events;
}

describe("compareExperiment", () => {
  const experiment = deriveExperiments([make()]).experiments[0];

  it("differenza chiara: distinguibile, con periodo di riferimento della stessa durata", () => {
    const { diary, intakeDays } = analyze(series({ refMood: 2.5, expMood: 4 }));
    const r = compareExperiment(experiment, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.periods.experiment).toMatchObject({ from: dateOf(14), to: dateOf(27), days: 14, completeDays: 14 });
    expect(r.periods.reference).toMatchObject({ from: dateOf(0), to: dateOf(13), days: 14, completeDays: 14 });
    const mood = r.measures.find((m) => m.measure === "mood");
    expect(mood?.status).toBe("compared");
    if (mood?.status !== "compared") return;
    expect(mood.verdict).toBe("distinguishable");
    expect(mood.direction).toBe("higher");
    expect(mood.difference).toBeGreaterThan(0.8);
    expect(mood.interval.low).toBeGreaterThan(0);
    expect(mood.reference.n).toBe(14);
    expect(mood.experiment.n).toBe(14);
    expect(mood.differenceInUsualSds).toBeGreaterThan(1);
    expect(mood.summary).toMatch(/distinguibile dalla variabilità abituale/);
  });

  it("senza differenza: non distinguibile dalla variabilità abituale", () => {
    const { diary, intakeDays } = analyze(series({ refMood: 3, expMood: 3, sd: 0.9, seed: 5 }));
    const r = compareExperiment(experiment, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    const mood = r.measures[0];
    if (mood.status !== "compared") throw new Error("atteso compared");
    expect(mood.verdict).toBe("not_distinguishable");
    expect(mood.direction).toBeUndefined();
    expect(mood.interval.low).toBeLessThan(0);
    expect(mood.interval.high).toBeGreaterThan(0);
    expect(mood.summary).toMatch(/non si distingue/);
  });

  it("i testi non parlano di cause, diagnosi o carenze", () => {
    const { diary, intakeDays } = analyze(series({ refMood: 2.5, expMood: 4 }));
    const r = compareExperiment(experiment, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    const text = [...r.caveats, ...r.measures.flatMap((m) => (m.status === "compared" ? [m.summary] : [m.message]))].join(" ");
    expect(text).not.toMatch(/caus|diagnos|carenz|deficien|malatt/i);
  });

  it("aderenza misurata sui pasti: giorni senza gli alimenti esclusi", () => {
    // Nell'esperimento il latte compare in 7 giorni su 14.
    const random = rng(2);
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      const milk = i < 14 || i % 2 === 0;
      events.push(...day(i, { lunchItems: milk ? [{ name: "Latte intero", grams: 200 }] : [] }));
      events.push(moodOn(i, i < 14 ? 3 : Math.round(3 + noise(random, 0.4))));
    }
    const { diary, intakeDays } = analyze(events);
    const r = compareExperiment(experiment, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.adherence.measured).toMatchObject({ daysChecked: 14, daysAdherent: 7, share: 0.5 });
    expect(r.adherence.measured?.referenceDaysWithFood).toBe(14);
    expect(r.adherence.lowAdherence).toBe(true);
    for (const m of r.measures) if (m.status === "compared") expect(m.reliability).toBe("low");
  });

  it("con piena aderenza l'aderenza misurata è uno", () => {
    const { diary, intakeDays } = analyze(series({ refMood: 3, expMood: 3 }));
    const r = compareExperiment(experiment, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.adherence.measured?.share).toBe(1);
    expect(r.adherence.lowAdherence).toBe(false);
  });

  it("l'aderenza dichiarata bassa abbassa l'affidabilità", () => {
    const exp = { ...experiment, declaredAdherence: 0.4 };
    const { diary, intakeDays } = analyze(series({ refMood: 2.5, expMood: 4 }));
    const r = compareExperiment(exp, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.adherence.declared).toBe(0.4);
    expect(r.adherence.lowAdherence).toBe(true);
  });

  it("segnala se il periodo di riferimento non conteneva gli alimenti esclusi", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      events.push(...day(i));
      events.push(moodOn(i, 3));
    }
    const { diary, intakeDays } = analyze(events);
    const r = compareExperiment(experiment, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.caveats.join(" ")).toMatch(/non compaiono/);
  });

  it("giorni con vuoti esclusi e contati; osservazioni insufficienti senza numero", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      // Quasi tutto il periodo di riferimento ha vuoti.
      events.push(...day(i, i < 12 ? { skip: ["dinner"] } : {}));
      events.push(moodOn(i, 3));
    }
    const { diary, intakeDays } = analyze(events);
    const r = compareExperiment(experiment, { diary, intakeDays });
    expect(r.status).toBe("insufficient");
    if (r.status !== "insufficient") return;
    expect(r.reasons).toEqual(["no_measure_computable"]);
    expect(r.periods?.reference).toMatchObject({ completeDays: 2, excludedDays: 12 });
    const m = r.measures?.[0];
    expect(m?.status).toBe("insufficient");
    expect(m && "message" in m ? m.message : "").toMatch(/Dati insufficienti/);
    expect(m).not.toHaveProperty("difference");
    // Aderenza e avvertenze si calcolano comunque, anche senza un confronto.
    expect(r.adherence?.measured).toMatchObject({ daysChecked: 14, daysAdherent: 14, share: 1 });
    expect(r.adherence?.excludedFoods).toEqual(["latte"]);
    expect(r.caveats?.length).toBeGreaterThanOrEqual(2);
  });

  it("esperimento non ancora iniziato o ancora in corso", () => {
    const { diary, intakeDays } = analyze(series({ refMood: 3, expMood: 3 }));
    const notStarted = compareExperiment(experiment, { diary, intakeDays }, { asOf: dateOf(10) });
    expect(notStarted.status === "insufficient" && notStarted.reasons).toEqual(["not_started"]);
    if (notStarted.status !== "insufficient") throw new Error("atteso insufficiente");
    expect(notStarted.adherence).toMatchObject({ excludedFoods: ["latte"], lowAdherence: false });
    expect(notStarted.caveats?.join(" ")).toMatch(/non è ancora iniziato/);
    const declaredLow = compareExperiment({ ...experiment, declaredAdherence: 0.3 }, { diary, intakeDays }, { asOf: dateOf(10) });
    expect(declaredLow.status === "insufficient" && declaredLow.adherence?.lowAdherence).toBe(true);

    // A metà esperimento (7 giorni) il riferimento è lungo 7 giorni.
    const ongoing = compareExperiment(experiment, { diary, intakeDays }, { asOf: dateOf(20), minObservations: 5 });
    if (ongoing.status !== "ok") throw new Error("atteso ok");
    expect(ongoing.ongoing).toBe(true);
    expect(ongoing.periods.experiment.days).toBe(7);
    expect(ongoing.periods.reference).toMatchObject({ from: dateOf(7), to: dateOf(13) });
  });

  it("peso: confronta la variazione in kg a settimana e non conta i giorni con vuoti", () => {
    const random = rng(13);
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      // Giorni con vuoti: il peso conta comunque, perché non dipende dai pasti.
      events.push(...day(i, i % 3 === 0 ? { skip: ["dinner"] } : {}));
      const kg = i < 14 ? 80 + noise(random, 0.15) : 80 - 0.08 * (i - 14) + noise(random, 0.15);
      events.push(weighIn(i, kg));
    }
    const { diary, intakeDays } = analyze(events);
    const exp = { ...experiment, measures: ["weight" as const] };
    const r = compareExperiment(exp, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    const w = r.measures[0];
    if (w.status !== "compared") throw new Error("atteso compared");
    expect(w.unit).toBe("kg a settimana");
    expect(w.experiment.mean).toBeLessThan(-0.3);
    expect(Math.abs(w.reference.mean)).toBeLessThan(0.3);
    expect(w.verdict).toBe("distinguishable");
    expect(w.direction).toBe("lower");
  });

  it("peso con pesate in pochi giorni: dati insufficienti per periodo breve", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      events.push(...day(i));
      // Sei pesate in sei giorni consecutivi alla fine di ciascun periodo.
      if ((i >= 8 && i <= 13) || i >= 22) events.push(weighIn(i, 80 - 0.01 * i));
    }
    const { diary, intakeDays } = analyze(events);
    const r = compareExperiment({ ...experiment, measures: ["weight"] }, { diary, intakeDays });
    expect(r.status).toBe("insufficient");
    const m = r.status === "insufficient" ? r.measures?.[0] : undefined;
    expect(m?.status === "insufficient" && m.reasons).toEqual(["short_weight_span"]);
  });

  it("energia assunta: media dei giorni completi con energia nota", () => {
    const random = rng(17);
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) events.push(...day(i, { kcal: (i < 14 ? 2200 : 1800) + noise(random, 80) }));
    const { diary, intakeDays } = analyze(events);
    const exp = { ...experiment, measures: ["energyIntake" as const], excludedFoods: [] };
    const r = compareExperiment(exp, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    const m = r.measures[0];
    if (m.status !== "compared") throw new Error("atteso compared");
    expect(m.difference).toBeLessThan(-300);
    expect(m.verdict).toBe("distinguishable");
    expect(r.adherence.measured).toBeUndefined();
  });

  it("non dipende dall'ordine degli eventi", () => {
    const events = series({ refMood: 2.5, expMood: 4 });
    const a = analyze(events);
    const b = analyze(shuffled(events, rng(6)));
    expect(compareExperiment(experiment, b)).toEqual(compareExperiment(experiment, a));
  });

  it("a esperimento in corso il risultato è provvisorio e non dichiara distinguibile", () => {
    const { diary, intakeDays } = analyze(series({ refMood: 2.5, expMood: 4 }));
    const r = compareExperiment(experiment, { diary, intakeDays }, { asOf: dateOf(24), minObservations: 5 });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.ongoing).toBe(true);
    expect(r.provisional).toBe(true);
    const m = r.measures[0];
    if (m.status !== "compared") throw new Error("atteso compared");
    expect(m.provisional).toBe(true);
    expect(m.verdict).toBe("provisional");
    expect(m.direction).toBeUndefined();
    expect(m.pValue).toBeUndefined();
    expect(m.adjustedPValue).toBeUndefined();
    // Differenza e intervallo ci sono, come provvisori.
    expect(m.difference).toBeGreaterThan(0.5);
    expect(m.interval.low).toBeLessThan(m.interval.high);
    expect(m.summary).toMatch(/provvisorio/);
    expect(m.summary).toMatch(/non si dichiara/);
    expect(m.reliability).toBe("low");
    expect(r.caveats.join(" ")).toMatch(/provvisorie/);

    // A esperimento concluso lo stesso confronto dichiara il verdetto.
    const done = compareExperiment(experiment, { diary, intakeDays }, { asOf: dateOf(30) });
    if (done.status !== "ok") throw new Error("atteso ok");
    expect(done.provisional).toBe(false);
    expect(done.measures[0].status === "compared" && done.measures[0].verdict).toBe("distinguishable");
  });

  it("dichiara quante misure sono state confrontate e con quale correzione", () => {
    const { diary, intakeDays } = analyze(series({ refMood: 2.5, expMood: 4 }));
    // Solo l'umore ha dati: le altre misure sono insufficienti e non entrano nella famiglia.
    const exp = { ...experiment, measures: ["mood" as const, "symptomSleep" as const, "weight" as const] };
    const r = compareExperiment(exp, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.multiplicity).toEqual({ measuresRequested: 3, measuresCompared: 1, correction: "holm", alpha: 0.05 });
    const mood = r.measures[0];
    if (mood.status !== "compared") throw new Error("atteso compared");
    expect(mood.adjustedPValue).toBe(mood.pValue);
  });

  it("il valore p corretto non è mai minore di quello grezzo e il più piccolo si moltiplica per le misure", () => {
    const events: unknown[] = [];
    const random = rng(61);
    for (let i = 0; i < 28; i++) {
      events.push(...day(i));
      const shift = i >= 14 ? 0.7 : 0;
      events.push(moodOn(i, clamp15(3 + shift + noise(random, 0.8))));
      events.push(symptomOn(i, "sleep", clamp15(3 + noise(random, 0.8))));
      events.push(symptomOn(i, "digestion", clamp15(3 + noise(random, 0.8))));
    }
    const { diary, intakeDays } = analyze(events);
    const exp = { ...experiment, measures: ["mood" as const, "symptomSleep" as const, "symptomDigestion" as const] };
    const r = compareExperiment(exp, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.multiplicity.measuresCompared).toBe(3);
    for (const m of r.measures) {
      if (m.status !== "compared") throw new Error("atteso compared");
      expect(m.adjustedPValue as number).toBeGreaterThanOrEqual(m.pValue as number);
    }
    const smallest = Math.min(...r.measures.map((m) => (m.status === "compared" ? (m.pValue as number) : 1)));
    const best = r.measures.find((m) => m.status === "compared" && m.pValue === smallest);
    expect(best?.status === "compared" && best.adjustedPValue).toBeCloseTo(Math.min(1, smallest * 3), 10);
  });

  it("serie autocorrelate: la numerosità efficace è minore del numero di giorni", () => {
    const random = rng(33);
    const events: unknown[] = [];
    let level = 3;
    for (let i = 0; i < 28; i++) {
      events.push(...day(i));
      // Umore che persiste da un giorno all'altro (AR(1)), senza differenza vera tra i periodi.
      level = 3 + 0.8 * (level - 3) + noise(random, 0.5);
      events.push(moodOn(i, clamp15(level)));
    }
    const { diary, intakeDays } = analyze(events);
    const r = compareExperiment({ ...experiment, excludedFoods: [] }, { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    const m = r.measures[0];
    if (m.status !== "compared") throw new Error("atteso compared");
    expect(m.autocorrelation.applied).toBe(true);
    expect(m.autocorrelation.experiment.pairs).toBe(13);
    expect(m.autocorrelation.reference.pairs).toBe(13);
    expect(m.autocorrelation.experiment.rho).toBeGreaterThan(0.2);
    expect(m.autocorrelation.experiment.effectiveN).toBeLessThan(m.experiment.n);
  });

  it(
    "falsi distinguibile con 7 misure senza alcun effetto: entro il tasso dichiarato",
    () => {
      const all = ["mood", "symptomDigestion", "symptomEnergy", "symptomSleep", "symptomOther", "weight", "energyIntake"] as const;
      const exp = { ...experiment, measures: [...all], excludedFoods: [] as string[] };
      const N = 200;
      let corrected = 0;
      let uncorrected = 0;
      for (let seed = 0; seed < N; seed++) {
        const random = rng(3000 + seed);
        const events: unknown[] = [];
        for (let i = 0; i < 28; i++) {
          events.push(...day(i, { kcal: 2000 + noise(random, 150) }));
          events.push(moodOn(i, 1 + Math.floor(random() * 5)));
          events.push(weighIn(i, 80 + noise(random, 0.3)));
          for (const kind of ["digestion", "energy", "sleep", "other"] as const) {
            events.push(symptomOn(i, kind, 1 + Math.floor(random() * 5)));
          }
        }
        const { diary, intakeDays } = analyze(events);
        const r = compareExperiment(exp, { diary, intakeDays });
        if (r.status !== "ok") throw new Error("atteso ok");
        expect(r.multiplicity.measuresCompared).toBe(7);
        const compared = r.measures.filter((m) => m.status === "compared");
        if (compared.some((m) => m.status === "compared" && m.verdict === "distinguishable")) corrected++;
        // Senza correzione: almeno una misura con p grezzo sotto la soglia.
        if (compared.some((m) => m.status === "compared" && (m.pValue as number) <= 0.05)) uncorrected++;
      }
      // Dichiarato: al più 5% dei registri (attesi 10 su 200, sd 3: limite al 99% = 18).
      expect(corrected).toBeLessThanOrEqual(18);
      // Senza correzione sarebbe circa 1 - 0,95^7 = 30%: la prova distingue le due situazioni.
      expect(uncorrected).toBeGreaterThanOrEqual(40);
    },
    120_000,
  );
});

const clamp15 = (v: number): number => Math.min(5, Math.max(1, Math.round(v)));

describe("compareExperiment: pasti fuori casa stimati", () => {
  /** 28 giorni completi con umore; nei giorni indicati il pranzo è una stima fuori casa da 800 kcal. */
  function log(outOn: (i: number) => boolean) {
    const events: unknown[] = [];
    for (let i = 0; i < 28; i++) {
      events.push(...day(i, { kcal: i < 14 ? 2200 : 1900, ...(outOn(i) ? { outOfHome: { kind: "lunch" as const, kcal: 800 } } : {}) }));
      events.push(moodOn(i, 3 + (i % 2)));
    }
    return analyze(events);
  }
  const experiment = (over: Partial<ExperimentBody>) => deriveExperiments([make(over)]).experiments[0];

  it("energia assunta: i giorni in cui la stima pesa non entrano nel confronto, e l'avvertenza dice quanti", () => {
    const { diary, intakeDays } = log((i) => i === 3 || i === 20 || i === 21);
    const r = compareExperiment(experiment({ measures: ["energyIntake"], excludedFoods: [] }), { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    const energy = r.measures[0];
    if (energy.status !== "compared") throw new Error("atteso un confronto");
    expect(energy.reference.n).toBe(13);
    expect(energy.experiment.n).toBe(12);
    expect(energy.reference.mean).toBeCloseTo(2200, 0);
    expect(energy.experiment.mean).toBeCloseTo(1900, 0);
    expect(r.caveats).toContain(
      "Energia assunta: 3 giorni con un pasto fuori casa stimato non entrano nel confronto, perché l'energia di quei giorni è in buona parte un valore generico.",
    );
  });

  it("aderenza: «Fuori casa» non è un alimento, e i giorni con una stima sono dichiarati", () => {
    const { diary, intakeDays } = log((i) => i === 15 || i === 16);
    const r = compareExperiment(experiment({ excludedFoods: ["casa"] }), { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    // la parola «casa» sta nel nome della stima: non deve valere come alimento escluso mangiato
    expect(r.adherence.measured).toMatchObject({ daysChecked: 14, daysAdherent: 14 });
    expect(r.caveats).toContain(
      "In 2 giorni dell'esperimento c'è un pasto fuori casa stimato: di quel pasto non si conoscono gli alimenti, quindi l'aderenza misurata può essere più alta del vero.",
    );
  });

  it("senza pasti fuori casa non c'è nessuna avvertenza in più", () => {
    const { diary, intakeDays } = log(() => false);
    const r = compareExperiment(experiment({ measures: ["energyIntake", "mood"] }), { diary, intakeDays });
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.caveats.join(" ")).not.toMatch(/fuori casa/);
  });
});
