import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { product } from "@/core/quality/test-helpers";
import { qualityFlags } from "./storeQuality";

const bad = product("8000000000011", { name: "Merendina", nova: 4, nutriScore: "e" });
const good = product("8000000000028", { name: "Mele", nova: 1, nutriScore: "a" });
const empty = product("8000000000035", { name: "Ignoto" });
const catalog = (...list: Product[]) => new Map(list.map((p) => [p.barcode, p]));

describe("qualityFlags", () => {
  it("segna solo le voci con codice, prodotto in cache e un punto a sfavore", () => {
    const flags = qualityFlags(
      [
        { id: "a|pz", barcode: bad.barcode },
        { id: "b|pz", barcode: good.barcode },
        { id: "c|pz", barcode: empty.barcode },
        { id: "d|pz" },
        { id: "e|pz", barcode: "9999999999999" },
      ],
      catalog(bad, good, empty),
    );
    expect([...flags]).toEqual([["a|pz", bad.barcode]]);
  });

  it("senza prodotti in cache non segna niente", () => {
    expect(qualityFlags([{ id: "a|pz", barcode: bad.barcode }], undefined).size).toBe(0);
  });

  it("un codice interno del negozio non si valuta", () => {
    const internal = product("2000000000017", { name: "Pane", nova: 4, nutriScore: "e" });
    expect(qualityFlags([{ id: "a|pz", barcode: internal.barcode }], catalog(internal)).size).toBe(0);
  });
});
