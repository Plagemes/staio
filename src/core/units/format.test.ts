import { describe, expect, it } from "vitest";
import { formatQuantity } from "./format";
import type { Unit } from "./types";

const f = (value: number, unit: Unit, estimated = false): string =>
  formatQuantity({ value, unit }, { estimated });

describe("formatQuantity", () => {
  it("sceglie l'unità sensata per la massa", () => {
    expect(f(1500, "g")).toBe("1,5 kg");
    expect(f(250, "g")).toBe("250 g");
    expect(f(1, "kg")).toBe("1 kg");
    expect(f(0.25, "kg")).toBe("250 g");
    expect(f(1, "hg")).toBe("100 g");
    expect(f(0.5, "g")).toBe("500 mg");
    expect(f(2.5, "g")).toBe("2,5 g");
  });

  it("sceglie l'unità sensata per il volume", () => {
    expect(f(600, "ml")).toBe("0,6 l");
    expect(f(250, "ml")).toBe("250 ml");
    expect(f(1.25, "l")).toBe("1,25 l");
    expect(f(2, "dl")).toBe("200 ml");
  });

  it("pezzi e unità non metriche", () => {
    expect(f(4, "pz")).toBe("4 pz");
    expect(f(1.5, "pz")).toBe("1,5 pz");
    expect(f(1, "cucchiaio")).toBe("1 cucchiaio");
    expect(f(2, "cucchiaio")).toBe("2 cucchiai");
    expect(f(1.5, "tazza")).toBe("1,5 tazze");
    expect(f(1, "pizzico")).toBe("1 pizzico");
    expect(f(3, "confezione")).toBe("3 confezioni");
  });

  it("arrotonda in modo ragionevole", () => {
    expect(f(333.333, "g")).toBe("333 g");
    expect(f(1234.5, "g")).toBe("1,23 kg");
    expect(f(999.6, "g")).toBe("1 kg");
    expect(f(0.9996, "g")).toBe("1 g");
    expect(f(1.005, "kg")).toBe("1,01 kg");
    expect(f(0.1 + 0.2, "pz")).toBe("0,3 pz");
  });

  it("prefisso di stima", () => {
    expect(f(150, "g", true)).toBe("~150 g");
    expect(f(2, "pz", true)).toBe("~2 pz");
  });

  it("zero e valori non finiti", () => {
    expect(f(0, "g")).toBe("0 g");
    expect(f(Number.NaN, "g")).toBe("?");
  });
});
