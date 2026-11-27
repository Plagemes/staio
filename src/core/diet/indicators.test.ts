import { describe, expect, it } from "vitest";
import { frameSufficient, indicatorsOf } from "./indicators";
import { FAKE_TABLES, THRESHOLDS, fakeFrame, tally } from "./test-helpers";
import type { Indicator, IndicatorId, WeekFrame } from "./types";

type Base = Omit<WeekFrame, "indicators">;

function ind(frame: Base, id: IndicatorId): Indicator {
  const found = indicatorsOf(frame, 2000, THRESHOLDS, FAKE_TABLES).find((i) => i.id === id);
  if (!found) throw new Error(`manca ${id}`);
  return found;
}

function withRow(frame: Base, row: keyof Base["rowTallies"], t: Partial<ReturnType<typeof tally>>): Base {
  return { ...frame, rowTallies: { ...frame.rowTallies, [row]: tally(t) } };
}

const closed = fakeFrame();
const inProgress = fakeFrame({ inProgress: true, daysElapsed: 4, daysWithData: 4, completeDays: 4 });

describe("indicatorsOf: stati", () => {
  it("dentro, sotto e sopra in una settimana chiusa e completa", () => {
    expect(ind(withRow(closed, "legumes", { servings: 3, occasions: 3 }), "group:legumes")).toMatchObject({
      status: "within",
      value: 3,
      unit: "servingsPerWeek",
      target: { min: 2, max: 4 },
    });
    expect(ind(withRow(closed, "legumes", { servings: 1, occasions: 1 }), "group:legumes").status).toBe("below");
    expect(ind(withRow(closed, "legumes", { servings: 5, occasions: 5 }), "group:legumes").status).toBe("above");
  });

  it("un minimo senza tetto raggiunto è «dentro» anche con dati parziali", () => {
    const f = withRow({ ...closed, daysWithData: 5, completeDays: 5 }, "fish", { servings: 2 });
    expect(ind(f, "group:fish").status).toBe("within");
  });

  it("«sopra» si dice anche nella settimana in corso e con pochi giorni", () => {
    const few = fakeFrame({ inProgress: true, daysElapsed: 2, daysWithData: 2, completeDays: 2 });
    const i = ind(withRow(few, "redMeat", { servings: 2, occasions: 2 }), "group:redMeat");
    expect(i.status).toBe("above");
    expect(i.lowerBound).toBe(true);
  });

  it("«sopra» si dice anche con copertura bassa", () => {
    const low = fakeFrame({ coverage: { ...closed.coverage, share: 0.4 } });
    expect(ind(withRow(low, "redMeat", { servings: 3 }), "group:redMeat").status).toBe("above");
    expect(ind(withRow(low, "fish", { servings: 0 }), "group:fish")).toMatchObject({
      status: "insufficient",
      insufficient: "low_coverage",
    });
  });

  it("«almeno» al posto di «sotto» nella settimana in corso", () => {
    const i = ind(withRow(inProgress, "legumes", { servings: 1 }), "group:legumes");
    expect(i).toMatchObject({ status: "atLeast", value: 1, lowerBound: true });
  });

  it("«almeno» al posto di «sotto» con meno di 6 giorni o copertura sotto 0,8", () => {
    const fiveDays = fakeFrame({ daysWithData: 5, completeDays: 5 });
    expect(ind(withRow(fiveDays, "legumes", { servings: 1 }), "group:legumes").status).toBe("atLeast");
    const cov = fakeFrame({ coverage: { ...closed.coverage, share: 0.75 } });
    expect(ind(withRow(cov, "legumes", { servings: 1 }), "group:legumes").status).toBe("atLeast");
    const sixDays = fakeFrame({ daysWithData: 6, completeDays: 6, coverage: { ...closed.coverage, share: 0.8 } });
    expect(ind(withRow(sixDays, "legumes", { servings: 1 }), "group:legumes").status).toBe("below");
  });

  it("nell'intervallo ma senza le condizioni per concludere: «almeno»", () => {
    expect(ind(withRow(inProgress, "legumes", { servings: 3 }), "group:legumes").status).toBe("atLeast");
    expect(ind(withRow(inProgress, "redMeat", { servings: 1 }), "group:redMeat").status).toBe("atLeast");
    expect(ind(withRow(closed, "redMeat", { servings: 1 }), "group:redMeat").status).toBe("within");
  });

  it("dati insufficienti: nessun giorno, pochi giorni", () => {
    const none = fakeFrame({ daysWithData: 0, completeDays: 0, coverage: { ...closed.coverage, lines: 0, share: 0 } });
    expect(ind(none, "group:fish")).toMatchObject({ status: "insufficient", insufficient: "no_data" });
    const three = fakeFrame({ daysWithData: 3, completeDays: 3 });
    expect(ind(withRow(three, "fish", { servings: 1 }), "group:fish")).toMatchObject({
      status: "insufficient",
      insufficient: "few_days",
    });
  });

  it("occasionale e sconsigliato: si conta in volte, nessun giudizio", () => {
    const f = withRow(withRow(closed, "processedMeat", { occasions: 4, servings: 5 }), "alcohol", { occasions: 2 });
    expect(ind(f, "group:processedMeat")).toMatchObject({
      status: "occasional",
      value: 4,
      unit: "count",
      target: { kind: "occasional", source: "app" },
    });
    expect(ind(f, "group:alcohol").status).toBe("occasional");
  });

  it("per giorno: la media sui giorni con dati; «sopra» con dati parziali solo se non insufficiente", () => {
    const f = withRow({ ...closed, daysWithData: 4, completeDays: 4 }, "sugar", { servings: 12 });
    expect(ind(f, "group:sugar")).toMatchObject({ value: 3, unit: "servingsPerDay", status: "above" });
    const few = withRow({ ...closed, daysWithData: 2, completeDays: 2 }, "sugar", { servings: 12 });
    expect(ind(few, "group:sugar").status).toBe("insufficient");
  });

  it("verdura e frutta in grammi al giorno, minimo provato", () => {
    const f = {
      ...closed,
      tallies: {
        ...closed.tallies,
        vegetables: tally({ grams: 2100, servings: 21 }),
        fruit: tally({ grams: 1400, servings: 14 }),
      },
    };
    expect(ind(f, "vegFruit")).toMatchObject({ value: 500, unit: "gramsPerDay", status: "within" });
  });

  describe("«sotto» mai su un minimo che le soglie non misurano", () => {
    // settimana chiusa, 7 giorni, copertura 0,95: si potrebbe concludere
    const seven = fakeFrame({ coverage: { ...closed.coverage, share: 0.95 } });
    const incomplete = fakeFrame({ completeDays: 5 });

    it("grammi al giorno: frutta in pezzi senza grammi dà «almeno», non «sotto»", () => {
      const f = {
        ...seven,
        tallies: {
          ...seven.tallies,
          vegetables: tally({ servings: 21, grams: 700, gramsKnown: false, occasions: 21 }),
          fruit: tally({ servings: 14, grams: 0, gramsKnown: false, occasions: 14 }),
        },
      };
      expect(ind(f, "vegFruit")).toMatchObject({ value: 100, lowerBound: true, status: "atLeast" });
      const known = { ...f, tallies: { ...f.tallies, vegetables: tally({ grams: 700 }), fruit: tally({ grams: 0 }) } };
      expect(ind(known, "vegFruit").status).toBe("below");
    });

    it("grammi al giorno con giorni incompleti", () => {
      const f = { ...incomplete, tallies: { ...incomplete.tallies, vegetables: tally({ grams: 700 }) } };
      expect(ind(f, "vegFruit").status).toBe("atLeast");
    });

    it("porzioni al giorno con giorni incompleti", () => {
      expect(ind(withRow(incomplete, "vegetables", { servings: 7 }), "group:vegetables")).toMatchObject({
        value: 1,
        status: "atLeast",
      });
      expect(ind(withRow(closed, "vegetables", { servings: 7 }), "group:vegetables").status).toBe("below");
    });

    it("porzioni a settimana con giorni incompleti: né «sotto» né «dentro» un intervallo", () => {
      expect(ind(withRow(incomplete, "legumes", { servings: 1 }), "group:legumes").status).toBe("atLeast");
      expect(ind(withRow(incomplete, "legumes", { servings: 3 }), "group:legumes").status).toBe("atLeast");
      expect(ind(withRow(incomplete, "redMeat", { servings: 1 }), "group:redMeat").status).toBe("atLeast");
      // «sopra» resta: il minimo supera già il tetto
      expect(ind(withRow(incomplete, "legumes", { servings: 5 }), "group:legumes").status).toBe("above");
    });

    it("quota minima con giorni incompleti", () => {
      const tallies = { ...closed.tallies, wholeGrains: tally({ servings: 2 }), refinedGrains: tally({ servings: 6 }) };
      expect(ind({ ...incomplete, tallies }, "wholeGrainShare")).toMatchObject({ value: 0.25, status: "atLeast" });
      expect(ind({ ...closed, tallies }, "wholeGrainShare").status).toBe("below");
    });
  });

  it("quota integrale come rapporto; senza cereali non c'è valore", () => {
    const f = {
      ...closed,
      tallies: { ...closed.tallies, wholeGrains: tally({ servings: 2 }), refinedGrains: tally({ servings: 6 }) },
    };
    expect(ind(f, "wholeGrainShare")).toMatchObject({ value: 0.25, status: "below", lowerBound: false });
    expect(ind(closed, "wholeGrainShare")).toMatchObject({ status: "insufficient", insufficient: "no_data" });
  });

  it("sale: solo con abbastanza giorni completi; parziale non è mai «dentro»", () => {
    expect(ind(closed, "salt")).toMatchObject({ value: 4, status: "within", coverage: 1 });
    const partial = fakeFrame({ salt: { completeDays: 7, missingShare: 0.1, partial: true, average: 4, certainty: "label" } });
    expect(ind(partial, "salt").lowerBound).toBe(true);
    const fewComplete = fakeFrame({ completeDays: 3, salt: { completeDays: 3, missingShare: 0, partial: false, average: 7 } });
    expect(ind(fewComplete, "salt")).toMatchObject({ status: "insufficient", insufficient: "few_complete_days" });
    const high = fakeFrame({ salt: { completeDays: 7, missingShare: 0.3, partial: true, average: 7 } });
    expect(ind(high, "salt").status).toBe("above");
  });

  it("fibre: minimo raggiunto «dentro», sotto solo se si può concludere", () => {
    expect(ind(closed, "fiber").status).toBe("within");
    const low = fakeFrame({ fiber: { completeDays: 7, missingShare: 0.1, partial: true, average: 15 } });
    expect(ind(low, "fiber").status).toBe("below");
    const lowCov = fakeFrame({ fiber: { completeDays: 7, missingShare: 0.25, partial: true, average: 15 } });
    expect(ind(lowCov, "fiber").status).toBe("atLeast");
  });

  it("zuccheri liberi: stima per difetto, mai «dentro»", () => {
    const i = ind(closed, "freeSugars");
    expect(i).toMatchObject({ status: "atLeast", lowerBound: true, value: 4 });
    const high = fakeFrame({ freeSugars: { grams: 70, percentEnergy: 14, lowerBound: true, certainty: "estimated" } });
    expect(ind(high, "freeSugars").status).toBe("above");
  });

  it("molto lavorati e varietà: nessuna soglia, solo il valore", () => {
    expect(ind(closed, "processedShare")).toMatchObject({ status: "noTarget", value: 0.2, unit: "share" });
    expect(ind(closed, "processedShare").target).toBeUndefined();
    const lowCov = fakeFrame({ processed: { ...closed.processed, coverage: 0.5 } });
    expect(ind(lowCov, "processedShare")).toMatchObject({ status: "insufficient", insufficient: "low_coverage" });
    expect(ind(closed, "plantVariety")).toMatchObject({ status: "noTarget", value: 12, unit: "count" });
  });

  it("una riga senza indicazione a quel livello non ha soglia", () => {
    const tables = { ...FAKE_TABLES, targetFor: () => undefined };
    const i = indicatorsOf(withRow(closed, "fish", { servings: 1 }), 2000, THRESHOLDS, tables).find(
      (x) => x.id === "group:fish",
    );
    expect(i?.status).toBe("noTarget");
  });

  it("frameSufficient", () => {
    expect(frameSufficient(closed, THRESHOLDS)).toBe(true);
    expect(frameSufficient({ ...closed, daysWithData: 3 }, THRESHOLDS)).toBe(false);
    expect(frameSufficient({ ...closed, coverage: { ...closed.coverage, share: 0.6 } }, THRESHOLDS)).toBe(false);
  });

  it("le tabelle vere si caricano e danno un indicatore per riga", () => {
    const real = indicatorsOf(closed, 2000, THRESHOLDS);
    expect(real.some((i) => i.id === "group:legumes")).toBe(true);
    expect(real.some((i) => i.id === "processedShare")).toBe(true);
  });
});
