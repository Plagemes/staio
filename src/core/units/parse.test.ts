import { describe, expect, it } from "vitest";
import { parseQuantity } from "./parse";

function parsed(input: string): { value: number; unit: string; rest: string } {
  const r = parseQuantity(input);
  if (!r.ok) throw new Error(`atteso ok, ricevuto ${r.error.code}`);
  return { value: r.value.quantity.value, unit: r.value.quantity.unit, rest: r.value.rest };
}

describe("parseQuantity", () => {
  it("numeri con virgola e attaccati all'unità", () => {
    expect(parsed("1,5 kg")).toEqual({ value: 1.5, unit: "kg", rest: "" });
    expect(parsed("250g")).toEqual({ value: 250, unit: "g", rest: "" });
    expect(parsed("1.5 l")).toEqual({ value: 1.5, unit: "l", rest: "" });
    expect(parsed("  2   cucchiai ")).toEqual({ value: 2, unit: "cucchiaio", rest: "" });
  });

  it("parole numeriche", () => {
    expect(parsed("mezzo litro")).toEqual({ value: 0.5, unit: "l", rest: "" });
    expect(parsed("un etto")).toEqual({ value: 1, unit: "hg", rest: "" });
    expect(parsed("Una tazza")).toEqual({ value: 1, unit: "tazza", rest: "" });
    expect(parsed("due bicchieri")).toEqual({ value: 2, unit: "bicchiere", rest: "" });
  });

  it("frazioni", () => {
    expect(parsed("1/2 kg")).toEqual({ value: 0.5, unit: "kg", rest: "" });
  });

  it("testo residuo", () => {
    expect(parsed("6 uova")).toEqual({ value: 6, unit: "pz", rest: "uova" });
    expect(parsed("3 pz")).toEqual({ value: 3, unit: "pz", rest: "" });
    expect(parsed("2 cucchiai di olio")).toEqual({ value: 2, unit: "cucchiaio", rest: "olio" });
    expect(parsed("un etto di prosciutto")).toEqual({
      value: 1,
      unit: "hg",
      rest: "prosciutto",
    });
    expect(parsed("1 l latte")).toEqual({ value: 1, unit: "l", rest: "latte" });
    expect(parsed("mezzo avocado")).toEqual({ value: 0.5, unit: "pz", rest: "avocado" });
    expect(parsed("1 g gambero")).toEqual({ value: 1, unit: "g", rest: "gambero" });
    expect(parsed("2 d'olio")).toEqual({ value: 2, unit: "pz", rest: "d'olio" });
  });

  it("alias", () => {
    const cases: [string, string][] = [
      ["100 gr", "g"],
      ["100 grammi", "g"],
      ["2 litri", "l"],
      ["2 etti", "hg"],
      ["2 pezzi", "pz"],
      ["3 cucchiaini", "cucchiaino"],
      ["2 tazze", "tazza"],
      ["4 bicchieri", "bicchiere"],
      ["1 chilo", "kg"],
      ["5 ml", "ml"],
      ["3 dl", "dl"],
      ["3 cl", "cl"],
      ["500 mg", "mg"],
      ["1 pizzico di sale", "pizzico"],
      ["2 confezioni", "confezione"],
      ["1 conf. di pasta", "confezione"],
      ["100 gr.", "g"],
    ];
    for (const [input, unit] of cases) expect(parsed(input).unit).toBe(unit);
  });

  it("errori tipizzati", () => {
    const code = (s: string): string => {
      const r = parseQuantity(s);
      return r.ok ? "ok" : r.error.code;
    };
    expect(code("")).toBe("empty");
    expect(code("   ")).toBe("empty");
    expect(code("sale q.b.")).toBe("no_quantity");
    expect(code("pasta")).toBe("no_quantity");
    expect(code("1/0 kg")).toBe("invalid_number");
  });
});
