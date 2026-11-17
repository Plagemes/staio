import { describe, expect, it } from "vitest";
import { product } from "@/core/quality/test-helpers";
import { buildCandidates } from "./candidates";
import { displayProductCode, isDoubtfulProduct } from "./codes";
import { listEntryFor } from "./listEntry";

const LOCAL = product("2990000012345", { source: "manual", localFromName: true });
const STORE_299 = product("2990000099999", { source: "manual" });

describe("codici nelle schermate di qualità", () => {
  it("un codice locale lo dice la scheda, non il prefisso", () => {
    expect(displayProductCode(LOCAL)).not.toContain("2990000012345");
    expect(displayProductCode(STORE_299)).toBe("2990000099999");
    expect(displayProductCode(product("8076800195057"))).toBe("8076800195057");
  });
  it("la voce di lista senza nome non usa il codice di una scheda locale", () => {
    expect(listEntryFor(LOCAL).product).not.toContain("2990000012345");
    expect(listEntryFor(STORE_299).product).toContain("2990000099999");
  });
  it("una scheda per un codice interno del negozio è dubbia, di Open Food Facts o scritta dall'utente", () => {
    expect(isDoubtfulProduct(product("2012345000000"))).toBe(true);
    expect(isDoubtfulProduct(product("2012345000000", { source: "manual" }))).toBe(true);
    expect(isDoubtfulProduct(STORE_299)).toBe(true);
    expect(isDoubtfulProduct(LOCAL)).toBe(false);
    expect(isDoubtfulProduct(product("8076800195057"))).toBe(false);
  });
  it("una scheda dubbia non diventa un'alternativa candidata", () => {
    const list = buildCandidates([product("2012345000000"), STORE_299, LOCAL, product("8076800195057")], []);
    expect(list.map((c) => c.product.barcode)).toEqual(["2990000012345", "8076800195057"]);
  });
});
