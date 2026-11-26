import { describe, expect, it } from "vitest";
import { shoppingListCount } from "./useTodayPlan";

describe("shoppingListCount", () => {
  it("coincide con «Da comprare»: voci con quantità più voci senza quantità", () => {
    expect(shoppingListCount({ items: [{}, {}, {}], noQuantity: [{}] })).toBe(4);
    expect(shoppingListCount({ items: [{}], noQuantity: [] })).toBe(1);
    expect(shoppingListCount({ items: [], noQuantity: [{}] })).toBe(1);
  });
  it("senza lista, zero", () => {
    expect(shoppingListCount(undefined)).toBe(0);
  });
});
