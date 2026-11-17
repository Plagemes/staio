import { describe, expect, it } from "vitest";
import { withNutrients } from "@/core/quality/test-helpers";
import { alternativesView } from "./alternatives";

const CATS = ["snacks", "biscuits"];
const N = { fat: 2, saturatedFat: 1, salt: 0.2 };
const ref = { product: withNutrients("R", { ...N, sugars: 30 }, { name: "Base", categories: CATS, nutriScore: "d", nova: 4 }) };
const better = { product: withNutrients("C", { ...N, sugars: 4 }, { name: "Meglio", categories: CATS, nutriScore: "d", nova: 4 }) };

describe("alternativesView", () => {
  it("raggruppa per dimensione le alternative migliori tra i candidati", () => {
    const v = alternativesView(ref, [ref, better]);
    expect(v.status).toBe("ok");
    expect(v.groups.map((g) => g.dimension)).toEqual(["sugars"]);
    expect(v.groups[0].alternatives[0].product.barcode).toBe("C");
  });
  it("senza candidati migliori lo dice e non inventa nulla", () => {
    const v = alternativesView(ref, [ref]);
    expect(v.status).toBe("none");
    expect(v.groups).toEqual([]);
    expect(v.reason).toMatch(/Tra i prodotti che conosci/);
  });
  it("senza categorie spiega perché non cerca", () => {
    const v = alternativesView({ product: withNutrients("R", { sugars: 30 }, { nutriScore: "d" }) }, [better]);
    expect(v.status).toBe("no_category");
    expect(v.reason).toMatch(/categorie/);
  });
  it("se il prodotto è favorevole ovunque non cerca", () => {
    const good = { product: withNutrients("G", { fat: 1, saturatedFat: 0.5, sugars: 1, salt: 0.1 }, { categories: CATS, nutriScore: "a", nova: 1 }) };
    expect(alternativesView(good, [better]).status).toBe("nothing_to_improve");
  });
});
