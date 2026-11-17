import { describe, expect, it } from "vitest";
import { product } from "@/core/quality/test-helpers";
import { listEntryFor } from "./listEntry";

describe("listEntryFor", () => {
  it("nome e marca, una confezione", () => {
    expect(listEntryFor(product("A", { name: "Biscotti", brand: "Mulino" }))).toEqual({ product: "Biscotti Mulino", quantity: { value: 1, unit: "pz" } });
  });
  it("non ripete la marca già nel nome", () => {
    expect(listEntryFor(product("A", { name: "Biscotti Mulino", brand: "Mulino" })).product).toBe("Biscotti Mulino");
  });
  it("senza nome usa il codice", () => {
    expect(listEntryFor(product("123")).product).toBe("Prodotto 123");
  });
});
