import { describe, expect, it } from "vitest";
import { assessProduct } from "@/core/quality";
import { product, withNutrients } from "@/core/quality/test-helpers";
import { compareTable } from "./compare";

const a = withNutrients("A", { sugars: 30, fat: 2, saturatedFat: 1, salt: 0.1 }, { name: "Uno", nutriScore: "d", nova: 4, additives: ["E330"] });
const b = product("B", { name: "Due" });

describe("compareTable", () => {
  it("una riga per dimensione e una cella per prodotto, con il dato mancante come non valutabile", () => {
    const t = compareTable([a, b].map((p) => ({ product: p, assessment: assessProduct(p) })));
    expect(t.products.map((p) => p.name)).toEqual(["Uno", "Due"]);
    const sugars = t.rows.find((r) => r.id === "sugars");
    expect(sugars?.cells[0]).toEqual({ outcome: "unfavorable", kind: "graded", text: "30 g / 100 g" });
    expect(sugars?.cells[1]).toEqual({ outcome: "not_assessable", kind: "graded", text: "" });
    expect(t.rows.find((r) => r.id === "nova")?.cells[0].text).toBe("NOVA 4");
    expect(t.rows.find((r) => r.id === "additives")?.cells[0].text).toBe("1 additivo");
  });
  it("senza prodotti: tabella vuota", () => {
    expect(compareTable([])).toEqual({ products: [], rows: [] });
  });
});
