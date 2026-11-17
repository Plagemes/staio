import { describe, expect, it } from "vitest";
import { confirmIngredient, deriveConfirmations } from "../allergens";
import { checkConstraints, derivePlan, getWeek, type ExpandRef } from "./index";
import { recipe, structureEv, weekEv } from "./test-helpers";

const T = "2026-03-01T10:00:00.000Z";
const day = "2026-03-09";

function setup(structure: Parameters<typeof structureEv>[2]) {
  const state = derivePlan([structureEv("s", T, structure), weekEv("w", T, day, [recipe(day, "lunch", "panino")])]);
  return { structure: state.structure, week: getWeek(state, day) };
}

const expand = (names: string[]): ExpandRef => () => names.map((name) => ({ name, quantity: { value: 50, unit: "g" as const } }));

const confirmFor = (name: string, allergens: string[], excludedFoods: string[] = []) => {
  const r = confirmIngredient({ name }, { allergens, excludedFoods }, { deviceId: "A", now: () => "2026-03-05T09:00:00.000Z", idGenerator: () => `c-${name}` });
  if (!r.ok) throw new Error(r.reason);
  return deriveConfirmations([r.event]).byKey;
};

// alimento senza dati (né `allergensOf` né collegamenti): il piano può solo dire «non so»
const noData = { allergensOf: () => undefined, linkOf: () => undefined };

describe("alimento senza dati e conferma (avviso «non so cosa contiene»)", () => {
  it("con la conferma che copre tutto ciò che è dichiarato, l'avviso non c'è e l'ingrediente è tra i confermati", () => {
    const { structure, week } = setup({ allergens: ["glutine"] });
    const r = checkConstraints(structure, week, { expand: expand(["pasta senza glutine"]), ...noData, confirmations: confirmFor("pasta senza glutine", ["glutine"]) });
    expect(r.unverified).toEqual([]);
    expect(r.verified).toBe(true);
    expect(r.confirmed).toHaveLength(1);
  });

  it("un allergene dichiarato dopo la conferma fa tornare l'avviso", () => {
    const { structure, week } = setup({ allergens: ["glutine", "latte"] });
    const r = checkConstraints(structure, week, { expand: expand(["pasta senza glutine"]), ...noData, confirmations: confirmFor("pasta senza glutine", ["glutine"]) });
    expect(r.unverified.map((u) => u.code)).toEqual(["unknown_allergens"]);
    expect(r.verified).toBe(false);
  });

  it("una nuova esclusione dichiarata dopo la conferma fa tornare l'avviso", () => {
    const { structure, week } = setup({ allergens: ["glutine"], excludedFoods: ["funghi"] });
    const r = checkConstraints(structure, week, { expand: expand(["pasta senza glutine"]), ...noData, confirmations: confirmFor("pasta senza glutine", ["glutine"]) });
    expect(r.unverified.map((u) => u.code)).toEqual(["unknown_allergens"]);
    expect(r.verified).toBe(false);
  });
});
