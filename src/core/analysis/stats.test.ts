import { describe, expect, it } from "vitest";
import { hashSeed, holmAdjust, lag1Autocorrelation, linearFit, permutationTest, seededGenerator, tCritical, twoSidedP, welch } from "./stats";

describe("distribuzione t", () => {
  // Valori critici bilaterali al 95% da tavole standard.
  it.each([
    [1, 12.706],
    [2, 4.303],
    [3, 3.182],
    [5, 2.571],
    [10, 2.228],
    [30, 2.042],
  ])("valore critico con %i gradi di libertà", (df, expected) => {
    expect(tCritical(0.95, df)).toBeCloseTo(expected, 2);
  });

  it("il valore p torna sul valore critico", () => {
    expect(twoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
    expect(twoSidedP(0, 10)).toBeCloseTo(1, 10);
  });

  it("con molti gradi di libertà si avvicina alla normale", () => {
    expect(tCritical(0.95, 5000)).toBeCloseTo(1.96, 1);
  });
});

describe("welch", () => {
  it("richiede almeno due valori per gruppo", () => {
    expect(welch([1], [1, 2])).toBeUndefined();
  });

  it("gruppi identici: differenza nulla, intervallo attorno allo zero", () => {
    const r = welch([1, 2, 3, 4], [1, 2, 3, 4]);
    expect(r?.difference).toBe(0);
    expect(r?.low).toBeLessThan(0);
    expect(r?.high).toBeGreaterThan(0);
    expect(r?.p).toBeCloseTo(1, 6);
  });

  it("gruppi costanti e diversi: p nulla; costanti e uguali: p uno", () => {
    expect(welch([3, 3, 3], [4, 4, 4])?.p).toBe(0);
    expect(welch([3, 3, 3], [3, 3, 3])?.p).toBe(1);
  });
});

describe("correzione di Holm", () => {
  it("corregge per il numero di confronti e resta monotona", () => {
    const adjusted = holmAdjust([0.01, 0.04, 0.03]);
    expect(adjusted[0]).toBeCloseTo(0.03, 10);
    expect(adjusted[1]).toBeCloseTo(0.06, 10);
    expect(adjusted[2]).toBeCloseTo(0.06, 10);
  });
  it("non supera 1", () => {
    expect(holmAdjust([0.9, 0.8])).toEqual([1, 1]);
  });
});

describe("retta", () => {
  it("retta esatta: pendenza e residui nulli", () => {
    const fit = linearFit([0, 1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 })));
    expect(fit?.slope).toBeCloseTo(2, 10);
    expect(fit?.residualSd).toBeCloseTo(0, 10);
  });
  it("meno di tre punti: nessuna retta", () => {
    expect(linearFit([{ x: 0, y: 1 }, { x: 1, y: 2 }])).toBeUndefined();
  });
  it("residui a onde allargano l'incertezza rispetto a residui alternati", () => {
    const xs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const wave = xs.map((x) => ({ x, y: x * 0.1 + Math.sin(x / 1.6) }));
    const alt = xs.map((x) => ({ x, y: x * 0.1 + (x % 2 === 0 ? 0.7 : -0.7) }));
    expect(linearFit(wave)!.inflation).toBeGreaterThan(linearFit(alt)!.inflation);
  });
});

describe("prova di permutazione", () => {
  const draw = seededGenerator(5);
  const score = () => 1 + Math.floor(draw() * 5);

  it("è deterministica: stesso seme, stesso risultato", () => {
    const a = [1, 2, 2, 3, 5, 4, 4, 5];
    const b = [1, 2, 3, 3, 2, 1, 4, 2, 3, 3];
    expect(permutationTest(a, b, 2000, 2000, hashSeed("x"))).toEqual(permutationTest(a, b, 2000, 2000, hashSeed("x")));
    expect(hashSeed("a|mood|0")).not.toBe(hashSeed("a|mood|1"));
  });

  it("gruppi nettamente separati: p minima possibile", () => {
    const r = permutationTest([5, 5, 4, 5, 4, 5, 5, 4], [1, 2, 1, 2, 1, 1, 2, 1, 2, 1], 5000, 5000, 1);
    expect(r.p).toBeCloseTo(1 / 5001, 6);
    expect(r.exceedances).toBe(0);
  });

  it("si ferma presto quando le eccedenze superano il tetto", () => {
    const r = permutationTest([1, 2, 3, 4], [1, 2, 3, 4], 5000, 3, 1);
    expect(r.stoppedEarly).toBe(true);
    expect(r.p).toBeUndefined();
  });

  it("su dati senza differenza il valore p è circa uniforme, anche con gruppi piccoli e sbilanciati", () => {
    let below05 = 0;
    const N = 300;
    for (let k = 0; k < N; k++) {
      const a = Array.from({ length: 8 }, score);
      const b = Array.from({ length: 30 }, score);
      const p = permutationTest(a, b, 400, 400, k + 1).p as number;
      if (p <= 0.05) below05++;
    }
    // Atteso 15 su 300 (sd 3,8).
    expect(below05).toBeLessThanOrEqual(26);
  });
});

describe("autocorrelazione di ordine 1", () => {
  it("conta solo le coppie di giorni adiacenti nel calendario", () => {
    const xs = [0, 1, 2, 5, 6, 9, 10, 11];
    const r = lag1Autocorrelation(xs.map((x, i) => ({ x, e: i % 2 === 0 ? 1 : -1 })));
    expect(r.pairs).toBe(5);
  });

  it("senza giorni adiacenti o con troppe poche coppie non stima nulla (rho 0)", () => {
    const sparse = lag1Autocorrelation([0, 2, 4, 6, 8, 10].map((x) => ({ x, e: x })));
    expect(sparse).toMatchObject({ pairs: 0, rho: 0, inflation: 1 });
    const few = lag1Autocorrelation([0, 1, 2].map((x) => ({ x, e: x })));
    expect(few.pairs).toBe(2);
    expect(few.rho).toBe(0);
  });

  it("una serie persistente ha rho alto, una alternata rho nullo (limitato a zero)", () => {
    const smooth = lag1Autocorrelation(Array.from({ length: 30 }, (_, x) => ({ x, e: Math.sin(x / 4) })));
    expect(smooth.rho).toBeGreaterThan(0.7);
    expect(smooth.inflation).toBeGreaterThan(5);
    const alt = lag1Autocorrelation(Array.from({ length: 30 }, (_, x) => ({ x, e: x % 2 === 0 ? 1 : -1 })));
    expect(alt.rho).toBe(0);
  });

  it("un buco nella serie non crea coppie false", () => {
    const first = Array.from({ length: 10 }, (_, x) => ({ x, e: Math.sin(x) }));
    const second = Array.from({ length: 10 }, (_, x) => ({ x: x + 40, e: Math.sin(x) }));
    expect(lag1Autocorrelation([...first, ...second]).pairs).toBe(18);
  });

  it("la retta dichiara le coppie usate", () => {
    const pts = [0, 1, 2, 3, 6, 7, 8, 9].map((x) => ({ x, y: x * 0.2 + (x % 3) * 0.3 }));
    expect(linearFit(pts)?.autocorrelationPairs).toBe(6);
  });

  it("welch con numerosità efficace minore dà un intervallo più largo", () => {
    const a = [3, 4, 3, 5, 4, 4, 5, 3, 4, 5];
    const b = [2, 3, 3, 2, 4, 3, 2, 3, 3, 2];
    const plain = welch(a, b)!;
    const eff = welch(a, b, 0.95, { a: 4, b: 4 })!;
    expect(eff.high - eff.low).toBeGreaterThan(plain.high - plain.low);
    expect(eff.p).toBeGreaterThan(plain.p);
    expect(eff.difference).toBe(plain.difference);
  });
});
