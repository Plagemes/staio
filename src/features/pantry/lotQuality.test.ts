import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { lotQuality } from "./lotQuality";

const product = (over: Partial<Product> = {}): Product =>
  ({ barcode: "8001234567890", name: "Biscotti", nutrition: { energyKcal: 480, sugarsG: 25, saturatedFatG: 9, saltG: 0.6, fiberG: 3 }, ...over }) as Product;

describe("lotQuality", () => {
  it("senza codice non c'è né riquadro né voce di menu", () => {
    expect(lotQuality(undefined, undefined)).toEqual({});
    expect(lotQuality("", product())).toEqual({});
  });

  it("con la scheda in cache c'è il riquadro e la voce di menu sparisce", () => {
    const p = product();
    const result = lotQuality(p.barcode, p);
    expect(result.glance).toBe(p);
    expect(result.menuHref).toBeUndefined();
  });

  it("senza la scheda in cache resta la voce di menu", () => {
    const result = lotQuality("8001234567890", undefined);
    expect(result.glance).toBeUndefined();
    expect(result.menuHref).toBe("/app/qualita/prodotto?codice=8001234567890");
  });

  it("per un prodotto scritto a mano non c'è niente", () => {
    expect(lotQuality("2991234567890", product({ barcode: "2991234567890", localFromName: true }))).toEqual({});
  });

  it("per un codice interno del negozio non si valuta: resta la voce di menu", () => {
    const result = lotQuality("2012345678903", product({ barcode: "2012345678903" }));
    expect(result.glance).toBeUndefined();
    expect(result.menuHref).toContain("codice=2012345678903");
  });
});
