import { describe, expect, it } from "vitest";
import { apportion, shownForAverage, shownParts, toUnits } from "./apportion";

/** Generatore deterministico (mulberry32): le prove a proprietà si ripetono uguali. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomValues(next: () => number): number[] {
  const n = 1 + Math.floor(next() * 12);
  return Array.from({ length: n }, () => {
    const kind = next();
    // valori grandi, piccoli e minuscoli, come energia, sale e vitamine
    if (kind < 0.15) return 0;
    if (kind < 0.4) return next() * 0.2;
    if (kind < 0.7) return next() * 30;
    return next() * 900;
  });
}

describe("ripartire gli arrotondamenti: le righe fanno il totale mostrato", () => {
  it("arrotonda come Intl.NumberFormat", () => {
    expect(toUnits(0.15, 1)).toBe(1);
    expect(toUnits(2.5, 0)).toBe(3);
    expect(toUnits(1082.4, 0)).toBe(1082);
    expect(toUnits(0.47, 1)).toBe(5);
  });

  it("i resti più grandi prendono le unità che mancano", () => {
    // arrotondate una per una farebbero 981
    expect(apportion([326.53, 326.53, 326.54], 980, 0)).toEqual([327, 326, 327]);
    expect(apportion([0.26, 0.17, 0.04], 5, 1)).toEqual([3, 2, 0]);
  });

  it("proprietà: per insiemi casuali, la somma delle righe è il totale mostrato e nessuna riga si sposta di un'unità o più", () => {
    const next = random(20261118);
    for (let run = 0; run < 2000; run++) {
      const values = randomValues(next);
      const digits = Math.floor(next() * 3);
      const total = values.reduce((s, v) => s + v, 0);
      const shown = shownParts(values, total, digits);
      const scale = 10 ** digits;
      expect(shown.parts.reduce((s, p) => s + p.units, 0)).toBe(shown.total);
      shown.parts.forEach((p, i) => {
        expect(Math.abs(p.units - values[i] * scale)).toBeLessThan(1 + 1e-9);
        // una riga positiva non diventa zero: o ha un numero o dice «meno di»
        if (values[i] > 0) expect(p.units > 0 || p.under).toBe(true);
        if (values[i] === 0) expect(p).toEqual({ units: 0, under: false });
      });
    }
  });

  it("proprietà: la media delle righe di una media è la media mostrata", () => {
    const next = random(7);
    for (let run = 0; run < 2000; run++) {
      const values = randomValues(next).map((v) => v + 1);
      const digits = Math.floor(next() * 3);
      const average = values.reduce((s, v) => s + v, 0) / values.length;
      const shown = shownForAverage(values, average, digits);
      expect(shown.parts.reduce((s, p) => s + p.units, 0)).toBe(shown.average * values.length);
      shown.parts.forEach((p, i) => expect(Math.abs(p.units - values[i] * 10 ** digits)).toBeLessThan(2));
    }
  });
});
