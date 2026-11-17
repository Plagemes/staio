import { describe, expect, it } from "vitest";
import { PORTIONS_KEY, PORTIONS_MAX, portionKey, readPortion, withPortion } from "./portions";

const AT = (n: number) => `2026-11-${String(1 + (n % 28)).padStart(2, "0")}T10:00:${String(n % 60).padStart(2, "0")}.000Z`;

describe("chiave del nome", () => {
  it("minuscole, senza accenti, spazi singoli", () => {
    expect(portionKey("  Petto   di  POLLO ")).toBe("petto di pollo");
    expect(portionKey("Caffè")).toBe("caffe");
    expect(portionKey("Tè\tverde\n")).toBe("te verde");
    expect(portionKey("   ")).toBe("");
  });

  it("due modi di scrivere lo stesso nome danno la stessa porzione", () => {
    const memory = withPortion({}, "Petto di pollo", { value: 150, unit: "g" }, AT(1));
    expect(readPortion(memory, "petto  di POLLO", "g")).toEqual({ value: 150, unit: "g" });
    expect(readPortion(memory, "Pétto di pollo", "g")).toEqual({ value: 150, unit: "g" });
  });
});

describe("lettura", () => {
  const memory = withPortion({}, "Latte", { value: 200, unit: "ml" }, AT(1));

  it("unità diversa: niente", () => {
    expect(readPortion(memory, "Latte", "ml")).toEqual({ value: 200, unit: "ml" });
    expect(readPortion(memory, "Latte", "g")).toBeUndefined();
    expect(readPortion(memory, "Latte", "pz")).toBeUndefined();
  });

  it("nome mai visto o vuoto: niente", () => {
    expect(readPortion(memory, "Pane", "g")).toBeUndefined();
    expect(readPortion(memory, "  ", "ml")).toBeUndefined();
  });

  it("forma non valida: niente, senza errori", () => {
    for (const broken of [undefined, null, "testo", 12, [], [{ value: 1, unit: "g", at: AT(1) }]]) {
      expect(readPortion(broken, "Latte", "ml")).toBeUndefined();
    }
    const entries = {
      latte: { value: "200", unit: "ml", at: AT(1) },
      pane: { value: 80, unit: "kg", at: AT(1) },
      uova: { value: 0, unit: "pz", at: AT(1) },
      riso: { value: Number.NaN, unit: "g", at: AT(1) },
      mela: { value: 1, unit: "pz" },
      pera: null,
    };
    for (const name of Object.keys(entries)) {
      expect(readPortion(entries, name, "ml")).toBeUndefined();
      expect(readPortion(entries, name, "g")).toBeUndefined();
      expect(readPortion(entries, name, "pz")).toBeUndefined();
    }
  });
});

describe("scrittura", () => {
  it("la chiave dell'impostazione ha la versione", () => {
    expect(PORTIONS_KEY).toBe("portions.v1");
  });

  it("non tocca la memoria di partenza e sostituisce la porzione dello stesso nome", () => {
    const first = withPortion(undefined, "Yogurt", { value: 125, unit: "g" }, AT(1));
    const second = withPortion(first, "yogurt", { value: 250, unit: "g" }, AT(2));
    expect(first).toEqual({ yogurt: { value: 125, unit: "g", at: AT(1) } });
    expect(second).toEqual({ yogurt: { value: 250, unit: "g", at: AT(2) } });
  });

  it("una porzione stimata resta una stima, una misurata no", () => {
    let memory: unknown = withPortion({}, "Piadine", { value: 50, unit: "g", estimated: true }, AT(1));
    expect(memory).toEqual({ piadine: { value: 50, unit: "g", at: AT(1), estimated: true } });
    expect(readPortion(memory, "Piadine", "g")).toEqual({ value: 50, unit: "g", estimated: true });
    // la volta dopo una piadina intera: la stima non resta attaccata
    memory = withPortion(memory, "Piadine", { value: 100, unit: "g", estimated: false }, AT(2));
    expect(memory).toEqual({ piadine: { value: 100, unit: "g", at: AT(2) } });
    expect(readPortion(memory, "Piadine", "g")).toEqual({ value: 100, unit: "g" });
    // una certezza scritta male non si legge
    expect(readPortion({ piadine: { value: 50, unit: "g", at: AT(1), estimated: "sì" } }, "Piadine", "g")).toBeUndefined();
  });

  it("scarta le voci rovinate che trova, tiene le altre", () => {
    const next = withPortion({ pane: { value: 80, unit: "g", at: AT(1) }, rotto: { value: -1, unit: "g", at: AT(1) }, altro: "x" }, "Latte", { value: 200, unit: "ml" }, AT(2));
    expect(Object.keys(next).sort()).toEqual(["latte", "pane"]);
  });

  it("una quantità non valida o un nome vuoto non si ricordano", () => {
    const memory = withPortion({}, "Pane", { value: 80, unit: "g" }, AT(1));
    expect(withPortion(memory, "Pane", { value: 0, unit: "g" }, AT(2))).toEqual(memory);
    expect(withPortion(memory, "Pane", { value: Number.POSITIVE_INFINITY, unit: "g" }, AT(2))).toEqual(memory);
    expect(withPortion(memory, "  ", { value: 50, unit: "g" }, AT(2))).toEqual(memory);
  });

  it("al massimo 300 nomi: esce il meno recente", () => {
    let memory: unknown = {};
    for (let i = 0; i < PORTIONS_MAX; i++) {
      memory = withPortion(memory, `alimento ${i}`, { value: 10 + i, unit: "g" }, `2026-01-01T00:00:00.${String(i).padStart(3, "0")}Z`);
    }
    expect(Object.keys(memory as object)).toHaveLength(300);

    // rinfrescato: «alimento 0» non è più il meno recente
    memory = withPortion(memory, "Alimento 0", { value: 99, unit: "g" }, "2026-02-01T00:00:00.000Z");
    expect(Object.keys(memory as object)).toHaveLength(300);

    memory = withPortion(memory, "nuovo", { value: 1, unit: "pz" }, "2026-02-02T00:00:00.000Z");
    expect(Object.keys(memory as object)).toHaveLength(300);
    expect(readPortion(memory, "alimento 1", "g")).toBeUndefined();
    expect(readPortion(memory, "alimento 0", "g")).toEqual({ value: 99, unit: "g" });
    expect(readPortion(memory, "alimento 2", "g")).toEqual({ value: 12, unit: "g" });
    expect(readPortion(memory, "nuovo", "pz")).toEqual({ value: 1, unit: "pz" });
  });

  it("con un tetto più basso escono i più vecchi, mai quello appena scritto", () => {
    const memory = { a: { value: 1, unit: "g", at: AT(3) }, b: { value: 2, unit: "g", at: AT(1) }, c: { value: 3, unit: "g", at: AT(2) } };
    // l'orologio indietro non fa uscire ciò che si è appena mangiato
    const next = withPortion(memory, "d", { value: 4, unit: "g" }, "2020-01-01T00:00:00.000Z", 2);
    expect(Object.keys(next).sort()).toEqual(["a", "d"]);
  });
});
