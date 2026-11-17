import { describe, expect, it } from "vitest";
import { convert, normalize } from "./convert";
import type { Quantity, Result } from "./types";

function val(r: Result<Quantity>): Quantity {
  if (!r.ok) throw new Error(`atteso ok, ricevuto ${r.error.code}`);
  return r.value;
}

function code(r: Result<Quantity>): string {
  return r.ok ? "ok" : r.error.code;
}

describe("convert nella stessa dimensione", () => {
  it("massa", () => {
    expect(val(convert({ value: 1.5, unit: "kg" }, "g"))).toEqual({ value: 1500, unit: "g" });
    expect(val(convert({ value: 250, unit: "g" }, "kg"))).toEqual({ value: 0.25, unit: "kg" });
    expect(val(convert({ value: 500, unit: "mg" }, "g"))).toEqual({ value: 0.5, unit: "g" });
  });

  it("etto = 100 g", () => {
    expect(val(convert({ value: 1, unit: "hg" }, "g")).value).toBe(100);
    expect(val(convert({ value: 3, unit: "hg" }, "kg")).value).toBe(0.3);
  });

  it("volume e misure di cucina", () => {
    expect(val(convert({ value: 0.5, unit: "l" }, "ml")).value).toBe(500);
    expect(val(convert({ value: 2, unit: "dl" }, "cl")).value).toBe(20);
    expect(val(convert({ value: 2, unit: "cucchiaio" }, "ml")).value).toBe(30);
    expect(val(convert({ value: 1, unit: "cucchiaio" }, "cucchiaino")).value).toBe(3);
    expect(val(convert({ value: 1, unit: "tazza" }, "ml")).value).toBe(240);
    expect(val(convert({ value: 1, unit: "bicchiere" }, "dl")).value).toBe(2);
  });

  it("elimina gli artefatti della virgola mobile", () => {
    expect(val(convert({ value: 0.1, unit: "kg" }, "g")).value).toBe(100);
    expect(val(convert({ value: 0.3, unit: "l" }, "ml")).value).toBe(300);
    expect(val(convert({ value: 1.1, unit: "kg" }, "hg")).value).toBe(11);
    expect(val(convert({ value: 0.07, unit: "l" }, "cl")).value).toBe(7);
  });

  it("stessa unità restituisce la quantità pulita", () => {
    expect(val(convert({ value: 0.1 + 0.2, unit: "g" }, "g")).value).toBe(0.3);
  });
});

describe("normalize", () => {
  it("porta all'unità base", () => {
    expect(val(normalize({ value: 1.5, unit: "kg" }))).toEqual({ value: 1500, unit: "g" });
    expect(val(normalize({ value: 2, unit: "dl" }))).toEqual({ value: 200, unit: "ml" });
    expect(val(normalize({ value: 3, unit: "pz" }))).toEqual({ value: 3, unit: "pz" });
    expect(val(normalize({ value: 2, unit: "cucchiaio" }))).toEqual({ value: 30, unit: "ml" });
  });

  it("confezione usa la dimensione passata", () => {
    const packageSize: Quantity = { value: 500, unit: "g" };
    expect(val(normalize({ value: 2, unit: "confezione" }, { packageSize }))).toEqual({
      value: 1000,
      unit: "g",
    });
  });
});

describe("conversioni tra dimensioni", () => {
  it("massa e volume con la densità", () => {
    expect(val(convert({ value: 200, unit: "ml" }, "g", { density: 0.92 })).value).toBe(184);
    expect(val(convert({ value: 184, unit: "g" }, "ml", { density: 0.92 })).value).toBe(200);
    expect(val(convert({ value: 1, unit: "cucchiaio" }, "g", { density: 0.8 })).value).toBe(12);
  });

  it("pezzi e massa con il peso unitario", () => {
    expect(val(convert({ value: 6, unit: "pz" }, "g", { unitWeight: 60 })).value).toBe(360);
    expect(val(convert({ value: 0.5, unit: "kg" }, "pz", { unitWeight: 125 })).value).toBe(4);
  });

  it("pezzi e volume passano per massa: servono entrambi i dati", () => {
    const ctx = { unitWeight: 50, density: 1 };
    expect(val(convert({ value: 4, unit: "pz" }, "ml", ctx)).value).toBe(200);
    expect(code(convert({ value: 4, unit: "pz" }, "ml", { unitWeight: 50 }))).toBe(
      "missing_density",
    );
    expect(code(convert({ value: 4, unit: "pz" }, "ml", { density: 1 }))).toBe(
      "missing_unit_weight",
    );
  });

  it("confezione verso e dalla base", () => {
    const packageSize: Quantity = { value: 250, unit: "g" };
    expect(val(convert({ value: 2, unit: "confezione" }, "g", { packageSize })).value).toBe(500);
    expect(val(convert({ value: 1, unit: "kg" }, "confezione", { packageSize })).value).toBe(4);
    const liquid: Quantity = { value: 1, unit: "l" };
    expect(
      val(convert({ value: 3, unit: "confezione" }, "ml", { packageSize: liquid })).value,
    ).toBe(3000);
  });
});

describe("errori previsti", () => {
  it("dati mancanti", () => {
    expect(code(convert({ value: 1, unit: "l" }, "g"))).toBe("missing_density");
    expect(code(convert({ value: 1, unit: "g" }, "pz"))).toBe("missing_unit_weight");
    expect(code(convert({ value: 1, unit: "confezione" }, "g"))).toBe("missing_package_size");
    expect(code(convert({ value: 1, unit: "g" }, "confezione"))).toBe("missing_package_size");
    expect(code(normalize({ value: 1, unit: "confezione" }))).toBe("missing_package_size");
  });

  it("pizzico non convertibile", () => {
    expect(code(convert({ value: 1, unit: "pizzico" }, "g"))).toBe("not_convertible");
    expect(code(convert({ value: 1, unit: "g" }, "pizzico"))).toBe("not_convertible");
    expect(code(normalize({ value: 1, unit: "pizzico" }))).toBe("not_convertible");
    expect(val(convert({ value: 2, unit: "pizzico" }, "pizzico")).value).toBe(2);
  });

  it("valori non validi", () => {
    expect(code(convert({ value: Number.NaN, unit: "g" }, "kg"))).toBe("invalid_value");
    expect(code(convert({ value: Infinity, unit: "g" }, "g"))).toBe("invalid_value");
    expect(code(convert({ value: 1, unit: "ml" }, "g", { density: 0 }))).toBe("invalid_value");
    expect(code(convert({ value: 1, unit: "pz" }, "g", { unitWeight: -5 }))).toBe(
      "invalid_value",
    );
    expect(
      code(
        convert({ value: 1, unit: "g" }, "confezione", {
          packageSize: { value: 0, unit: "g" },
        }),
      ),
    ).toBe("invalid_value");
  });
});
