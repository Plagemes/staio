import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { draftFromProduct, packsSummary, resolvePieces } from "./directAdd";
import { loadRemembered, rememberChoice, type ChoiceStore } from "./memory";

const g = (value: number) => ({ value, unit: "g" as const });

describe("pezzi nella scheda", () => {
  it("la grammatura di un pezzo si calcola da sola: 200 g / 2 = 100 g", () => {
    expect(resolvePieces(g(200), 2, null, "piadina")).toEqual({ pieces: { count: 2, each: 100, name: "piadina" }, each: 100, agrees: true });
    expect(resolvePieces(g(200), 3, null).pieces).toEqual({ count: 3, each: 66.67 });
  });

  it("la grammatura scritta a mano vale più di quella calcolata", () => {
    expect(resolvePieces(g(200), 2, "100").pieces?.each).toBe(100);
    expect(resolvePieces(g(200), 2, "95 g")).toMatchObject({ each: 95, agrees: false });
  });

  it("pezzi che non tornano: non è un errore, la quantità vale e i pezzi sono una stima", () => {
    const r = resolvePieces(g(200), 2, "120 g");
    expect(r.error).toBeUndefined();
    expect(r.agrees).toBe(false);
  });

  it("un testo illeggibile è un errore; meno di due pezzi o confezione a pezzi: nessun pezzo", () => {
    expect(resolvePieces(g(200), 2, "boh").error).toBeDefined();
    expect(resolvePieces(g(200), 0, null)).toEqual({});
    expect(resolvePieces(g(200), 1, null)).toEqual({});
    expect(resolvePieces({ value: 4, unit: "pz" }, 2, null)).toEqual({});
    expect(resolvePieces(undefined, 2, null)).toEqual({});
  });

  it("il riepilogo distingue confezioni e pezzi", () => {
    const pieces = { count: 2, each: 100, name: "piadina" };
    expect(packsSummary(1, g(200), pieces)).toBe("1 confezione da 200 g · 2 piadine da 100 g");
    expect(packsSummary(3, g(200), pieces)).toBe("3 confezioni da 200 g · 2 piadine da 100 g ciascuna");
    expect(packsSummary(3, g(170))).toBe("3 confezioni da 170 g");
    expect(packsSummary(1, g(200), { count: 2, each: 100 })).toBe("1 confezione da 200 g · 2 pezzi da 100 g");
  });
});

describe("pezzi proposti da Open Food Facts", () => {
  const base: Product = { barcode: "8003170063532", name: "Piadina", fetchedAt: "2026-11-17T08:00:00.000Z", source: "openfoodfacts" };

  it("la bozza porta la proposta e il nome del pezzo", () => {
    const draft = draftFromProduct({ ...base, quantity: { text: "2 x 100 g", value: 200, unit: "g", count: 2 }, piecesHint: { count: 2, each: 100, source: "label" } });
    expect(draft.piecesHint).toEqual({ count: 2, each: 100, source: "label" });
    expect(draft.pieceName).toBe("piadina");
    expect(draft.quantityText).toBe("200 g");
  });

  it("senza proposta la bozza non ha pezzi", () => {
    expect(draftFromProduct(base).piecesHint).toBeUndefined();
  });
});

describe("memoria dei pezzi per codice a barre", () => {
  const memory = (): ChoiceStore => {
    const map = new Map<string, unknown>();
    return { get: async (k) => map.get(k), set: async (k, v) => void map.set(k, v) };
  };
  const product = { barcode: "8003170063532", categories: ["cereals-and-their-products"] };

  it("riproporre i pezzi scelti l'ultima volta", async () => {
    const store = memory();
    await rememberChoice(product, { category: "bread_packaged", location: "dispensa", pieces: { count: 2, each: 100, name: "piadina" } }, store);
    expect(await loadRemembered(product, store)).toEqual({
      kind: "barcode",
      category: "bread_packaged",
      location: "dispensa",
      pieces: { count: 2, each: 100, name: "piadina" },
    });
  });

  it("senza pezzi la volta dopo, non ne restano", async () => {
    const store = memory();
    await rememberChoice(product, { category: "bread_packaged", location: "dispensa", pieces: { count: 2, each: 100 } }, store);
    await rememberChoice(product, { category: "bread_packaged", location: "dispensa" }, store);
    expect(await loadRemembered(product, store)).not.toHaveProperty("pieces");
  });

  it("valori non validi nella memoria vengono ignorati", async () => {
    const store = memory();
    await store.set("barcode.choice.8003170063532", { category: "bread_packaged", location: "dispensa", pieces: { count: 1, each: -3 } });
    expect(await loadRemembered(product, store)).toEqual({ kind: "barcode", category: "bread_packaged", location: "dispensa" });
  });
});
