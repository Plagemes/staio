import { describe, expect, it } from "vitest";
import { add, compare, scale, subtract } from "./arithmetic";
import type { Quantity, Result } from "./types";

function val<T>(r: Result<T>): T {
  if (!r.ok) throw new Error(`atteso ok, ricevuto ${r.error.code}`);
  return r.value;
}

function code<T>(r: Result<T>): string {
  return r.ok ? "ok" : r.error.code;
}

const q = (value: number, unit: Quantity["unit"]): Quantity => ({ value, unit });

describe("add e subtract", () => {
  it("somma con unità diverse, risultato nell'unità del primo", () => {
    expect(val(add(q(1, "kg"), q(500, "g")))).toEqual(q(1.5, "kg"));
    expect(val(add(q(500, "g"), q(1, "hg")))).toEqual(q(600, "g"));
  });

  it("evita gli artefatti in virgola mobile", () => {
    expect(val(add(q(0.1, "g"), q(0.2, "g"))).value).toBe(0.3);
    expect(val(subtract(q(0.3, "kg"), q(100, "g"))).value).toBe(0.2);
  });

  it("sottrazione può dare un risultato negativo", () => {
    expect(val(subtract(q(100, "g"), q(250, "g")))).toEqual(q(-150, "g"));
  });

  it("stessa unità non convertibile funziona", () => {
    expect(val(add(q(1, "pizzico"), q(2, "pizzico")))).toEqual(q(3, "pizzico"));
    expect(val(add(q(1, "confezione"), q(2, "confezione")))).toEqual(q(3, "confezione"));
  });

  it("dimensioni diverse sono un errore", () => {
    expect(code(add(q(1, "kg"), q(1, "l")))).toBe("incompatible_dimensions");
    expect(code(subtract(q(1, "pz"), q(1, "g")))).toBe("incompatible_dimensions");
    expect(code(add(q(1, "pizzico"), q(1, "g")))).toBe("not_convertible");
  });
});

describe("scale", () => {
  it("moltiplica per un fattore", () => {
    expect(val(scale(q(250, "g"), 2))).toEqual(q(500, "g"));
    expect(val(scale(q(0.1, "kg"), 3)).value).toBe(0.3);
  });

  it("fattore non finito è un errore", () => {
    expect(code(scale(q(1, "g"), Number.NaN))).toBe("invalid_value");
  });
});

describe("compare", () => {
  it("ordina tra unità diverse", () => {
    expect(val(compare(q(1, "kg"), q(999, "g")))).toBe(1);
    expect(val(compare(q(1, "dl"), q(0.5, "l")))).toBe(-1);
  });

  it("uguaglianza tollerante", () => {
    expect(val(compare(q(1, "kg"), q(1000, "g")))).toBe(0);
    expect(val(compare(q(0.3, "g"), q(0.1 + 0.2, "g")))).toBe(0);
  });

  it("dimensioni diverse sono un errore", () => {
    expect(code(compare(q(1, "g"), q(1, "ml")))).toBe("incompatible_dimensions");
  });
});
