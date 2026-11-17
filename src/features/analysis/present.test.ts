import { describe, expect, it } from "vitest";
import {
  associationControlText,
  basisText,
  freshnessLines,
  formatDecimal,
  formatDuration,
  formatKgPerWeek,
  formatRange,
  formatSigned,
  plural,
  regularityText,
  reliabilityText,
} from "./present";

describe("numeri in italiano", () => {
  it("virgola decimale, niente zeri inutili e niente -0", () => {
    expect(formatDecimal(1.5)).toBe("1,5");
    expect(formatDecimal(2)).toBe("2");
    expect(formatDecimal(-0.04, 1)).toBe("0");
    expect(formatDecimal(2350.4, 0)).toBe("2350");
  });

  it("le differenze hanno sempre il segno, con il vero segno meno", () => {
    expect(formatSigned(0.123, 2)).toBe("+0,12");
    expect(formatSigned(-0.5, 1)).toBe("−0,5");
    expect(formatSigned(0.001, 2)).toBe("0");
  });

  it("l'intervallo si scrive con entrambi gli estremi", () => {
    expect(formatRange(2100, 2600, "kcal")).toBe("tra 2100 e 2600 kcal");
    expect(formatRange(-0.1, 0.25, "kg a settimana", 2)).toBe("tra −0,1 e 0,25 kg a settimana");
    expect(formatKgPerWeek(-0.35)).toBe("−0,35 kg a settimana");
  });

  it("plurali e durate", () => {
    expect(plural(1, "giorno", "giorni")).toBe("1 giorno");
    expect(plural(0, "giorno", "giorni")).toBe("0 giorni");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(600)).toBe("10 h");
    expect(formatDuration(615)).toBe("10 h 15 min");
  });
});

describe("base e affidabilità", () => {
  it("dice i giorni usati su quelli del periodo e quanti sono esclusi", () => {
    const text = basisText(
      { periodDays: 28, usedDays: 20, excludedDays: 8, observations: 24 },
      { used: "Giorni usati", observations: { singular: "osservazione", plural: "osservazioni" } },
    );
    expect(text).toContain("Giorni usati: 20 su 28");
    expect(text).toContain("8 esclusi");
    expect(text).toContain("24 osservazioni");
  });

  it("senza esclusi non parla di esclusi", () => {
    expect(basisText({ periodDays: 7, usedDays: 7, excludedDays: 0, observations: 7 }, { used: "Giorni" })).toBe("Giorni: 7 su 7");
  });

  it("l'affidabilità ha un nome", () => {
    expect(reliabilityText("low")).toBe("Affidabilità bassa");
    expect(reliabilityText("good")).toBe("Affidabilità buona");
  });

  it("la regolarità non è un giudizio medico ma dà il numero", () => {
    expect(regularityText(20)).toContain("20 min");
    expect(regularityText(90)).toContain("1 h 30 min");
  });
});

describe("freschezza", () => {
  it("data dell'ultimo dato e, se datato, un avviso", () => {
    const fresh = { lastDataDate: "2026-03-10", referenceDate: "2026-03-12", daysBehind: 2, toleranceDays: 7, dated: false };
    expect(freshnessLines(fresh, [])).toEqual({ last: "Ultimo dato usato: 10 mar 2026.", other: [] });
    const old = { lastDataDate: "2026-03-01", referenceDate: "2026-03-12", daysBehind: 11, toleranceDays: 7, dated: true };
    const lines = freshnessLines(old, ["x"]);
    expect(lines.dated).toMatch(/Risultato datato: l'ultimo dato è di 11 giorni fa/);
    expect(lines.other).toEqual([]);
  });
});

describe("controllo delle associazioni", () => {
  const control = { nominalFalsePositiveRate: 0.01, method: "holm+permutation" as const, comparisons: 240, permutations: 2000, passedTTest: 3, resolutionLimited: false };
  it("dice quanti confronti, con quale controllo e il limite della garanzia", () => {
    const text = associationControlText(control).join(" ");
    expect(text).toContain("240 confronti");
    expect(text).toMatch(/rimescolati 2000 volte/);
    expect(text).toMatch(/al massimo del 1%/);
    expect(text).toMatch(/giorni sono scambiabili tra loro, cioè senza andamenti nel tempo/);
    expect(text).toMatch(/3 associazioni avevano superato il primo controllo/);
  });
  it("senza permutazioni lo dice; con troppi confronti avverte", () => {
    expect(associationControlText({ ...control, method: "holm", permutations: 0 }).join(" ")).toMatch(/senza la prova di rimescolamento/);
    expect(associationControlText({ ...control, resolutionLimited: true }).join(" ")).toMatch(/non può confermare nessuna associazione/);
  });
});
