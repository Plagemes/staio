import { describe, expect, it } from "vitest";
import { itemKey, proposeLocation, readItemDefault, suggestNames, withItemDefault, type ItemDefault } from "./itemDefaults";

const T1 = "2026-11-01T10:00:00.000Z";
const T2 = "2026-11-02T10:00:00.000Z";
const T3 = "2026-11-03T10:00:00.000Z";

describe("itemKey", () => {
  it("toglie maiuscole, accenti e spazi doppi", () => {
    expect(itemKey("  Caffè   Macinato ")).toBe("caffe macinato");
    expect(itemKey("PANE")).toBe(itemKey("pane"));
  });
});

describe("readItemDefault", () => {
  const memory = { pane: { name: "Pane", category: "bread_fresh", location: "dispensa", quantityText: "500 g", at: T1 } };

  it("trova il nome anche scritto in un altro modo", () => {
    expect(readItemDefault(memory, " PANE ")).toEqual({ name: "Pane", category: "bread_fresh", location: "dispensa", quantityText: "500 g", at: T1 });
  });

  it("non trova un nome mai usato", () => {
    expect(readItemDefault(memory, "latte")).toBeUndefined();
    expect(readItemDefault(memory, "")).toBeUndefined();
  });

  it("una memoria rovinata vale come vuota", () => {
    for (const bad of [undefined, null, 5, "testo", [], [{ name: "pane" }], { pane: 3 }, { pane: { name: 4, at: T1 } }, { pane: { name: "Pane" } }]) {
      expect(readItemDefault(bad, "pane")).toBeUndefined();
    }
  });

  it("scarta i campi facoltativi con la forma sbagliata, non la voce", () => {
    const damaged = { pane: { name: "Pane", category: "inventata", location: "cantina", quantityText: 7, at: T1 } };
    expect(readItemDefault(damaged, "pane")).toEqual({ name: "Pane", at: T1 });
  });

  it("non confonde i nomi con le proprietà degli oggetti", () => {
    expect(readItemDefault({}, "constructor")).toBeUndefined();
    expect(readItemDefault({}, "__proto__")).toBeUndefined();
  });
});

describe("withItemDefault", () => {
  it("aggiunge il nome con l'istante e sostituisce la scelta precedente", () => {
    const first = withItemDefault(undefined, { name: "Pane", category: "bread_fresh", location: "frigo", quantityText: "1 kg" }, T1);
    const next = withItemDefault(first, { name: "pane", category: "bread_fresh", location: "dispensa" }, T2);
    expect(Object.keys(next)).toEqual(["pane"]);
    expect(next.pane).toEqual({ name: "pane", category: "bread_fresh", location: "dispensa", at: T2 });
  });

  it("riparte da una memoria rovinata", () => {
    const next = withItemDefault({ pane: 3, latte: { name: "Latte", at: T1 } }, { name: "Uova" }, T2);
    expect(Object.keys(next).sort()).toEqual(["latte", "uova"]);
  });

  it("tiene al massimo il numero di nomi chiesto e fa uscire il meno recente", () => {
    let memory: Record<string, ItemDefault> = {};
    memory = withItemDefault(memory, { name: "A" }, T1, 3);
    memory = withItemDefault(memory, { name: "B" }, T2, 3);
    memory = withItemDefault(memory, { name: "C" }, T3, 3);
    memory = withItemDefault(memory, { name: "D" }, "2026-11-04T10:00:00.000Z", 3);
    expect(Object.keys(memory).sort()).toEqual(["b", "c", "d"]);
  });

  it("rinfrescare un nome lo salva dall'uscita", () => {
    let memory: Record<string, ItemDefault> = {};
    memory = withItemDefault(memory, { name: "A" }, T1, 2);
    memory = withItemDefault(memory, { name: "B" }, T2, 2);
    memory = withItemDefault(memory, { name: "A" }, T3, 2);
    memory = withItemDefault(memory, { name: "C" }, "2026-11-04T10:00:00.000Z", 2);
    expect(Object.keys(memory).sort()).toEqual(["a", "c"]);
  });

  it("a parità di istante resta la voce nuova", () => {
    let memory: Record<string, ItemDefault> = {};
    memory = withItemDefault(memory, { name: "A" }, T1, 1);
    memory = withItemDefault(memory, { name: "B" }, T1, 1);
    expect(Object.keys(memory)).toEqual(["b"]);
  });

  it("il tetto di default è 300", () => {
    let memory: Record<string, ItemDefault> = {};
    for (let i = 0; i < 305; i++) memory = withItemDefault(memory, { name: `alimento ${i}` }, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString());
    expect(Object.keys(memory)).toHaveLength(300);
    expect(memory["alimento 0"]).toBeUndefined();
    expect(memory["alimento 304"]).toBeDefined();
  });

  it("un nome vuoto non entra", () => {
    expect(withItemDefault({}, { name: "   " }, T1)).toEqual({});
  });
});

describe("suggestNames", () => {
  const memory = {
    "latte intero": { name: "Latte intero", at: T1 },
    "pane al latte": { name: "Pane al latte", at: T3 },
    caffe: { name: "Caffè", at: T2 },
    "latte di soia": { name: "Latte di soia", at: T2 },
  };

  it("propone i nomi che contengono il testo, i più recenti prima", () => {
    expect(suggestNames(memory, "latte", 5)).toEqual(["Pane al latte", "Latte di soia", "Latte intero"]);
  });

  it("non guarda accenti né maiuscole", () => {
    expect(suggestNames(memory, "CAFFE", 5)).toEqual(["Caffè"]);
    expect(suggestNames(memory, "caffè", 5)).toEqual(["Caffè"]);
  });

  it("rispetta il limite", () => {
    expect(suggestNames(memory, "latte", 2)).toEqual(["Pane al latte", "Latte di soia"]);
    expect(suggestNames(memory, "latte", 0)).toEqual([]);
  });

  it("senza testo o con una memoria rovinata non propone niente", () => {
    expect(suggestNames(memory, "  ", 5)).toEqual([]);
    expect(suggestNames(null, "latte", 5)).toEqual([]);
    expect(suggestNames({ latte: 1 }, "latte", 5)).toEqual([]);
  });
});

describe("proposeLocation", () => {
  it("vince la scelta fatta nel modulo", () => {
    expect(proposeLocation({ chosen: "freezer", remembered: "dispensa", category: "milk_fresh" })).toEqual({ location: "freezer", from: "chosen" });
  });

  it("poi la memoria per il nome", () => {
    expect(proposeLocation({ chosen: null, remembered: "dispensa", category: "milk_fresh" })).toEqual({ location: "dispensa", from: "memory" });
  });

  it("poi la regola per categoria", () => {
    const frozen = proposeLocation({ chosen: null, category: "frozen_foods" });
    expect(frozen).toEqual({ location: "freezer", from: "category" });
    expect(proposeLocation({ chosen: null, category: "bread_fresh" })).toEqual({ location: "dispensa", from: "category" });
  });

  it("infine il frigo", () => {
    expect(proposeLocation({ chosen: null })).toEqual({ location: "frigo", from: "default" });
    expect(proposeLocation({ chosen: null, category: "" })).toEqual({ location: "frigo", from: "default" });
  });

  it("una categoria non valida non conta", () => {
    expect(proposeLocation({ chosen: null, category: "non_esiste" })).toEqual({ location: "frigo", from: "default" });
    expect(proposeLocation({ chosen: null, category: "constructor" })).toEqual({ location: "frigo", from: "default" });
  });
});
