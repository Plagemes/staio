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

const expand = (ingredients: { name: string; note?: string }[]): ExpandRef => () =>
  ingredients.map((i) => ({ ...i, quantity: { value: 50, unit: "g" as const } }));

const confirmFor = (item: { name: string; note?: string }, allergens: string[], excludedFoods: string[] = []) => {
  const r = confirmIngredient(item, { allergens, excludedFoods }, { deviceId: "A", now: () => "2026-03-05T09:00:00.000Z", idGenerator: () => `c-${item.name}` });
  if (!r.ok) throw new Error(r.reason);
  return r.event;
};

const knownLink = () => ({ names: [] as string[] });

describe("conferme dell'utente nel controllo del piano", () => {
  it("senza conferma l'ingrediente incerto resta tra i dubbi", () => {
    const { structure, week } = setup({ allergens: ["glutine"] });
    const r = checkConstraints(structure, week, { expand: expand([{ name: "Prosciutto cotto" }]), allergensOf: () => [], linkOf: knownLink });
    expect(r.verified).toBe(false);
    expect(r.unverified.map((u) => u.code)).toEqual(["uncertain_allergens"]);
    expect(r.confirmed).toBeUndefined();
  });

  it("con la conferma esce dai dubbi ma finisce in `confirmed`, con data e allergeni", () => {
    const { structure, week } = setup({ allergens: ["glutine"] });
    const confirmations = deriveConfirmations([confirmFor({ name: "Prosciutto cotto" }, ["glutine"])]).byKey;
    const r = checkConstraints(structure, week, { expand: expand([{ name: "Prosciutto cotto" }]), allergensOf: () => [], linkOf: knownLink, confirmations });
    expect(r.ok).toBe(true);
    expect(r.unverified).toEqual([]);
    expect(r.confirmed).toEqual([
      expect.objectContaining({ date: day, meal: "lunch", terms: ["glutine"], confirmedAt: "2026-03-05T09:00:00.000Z", via: { kind: "recipe", id: "panino" } }),
    ]);
  });

  it("un nuovo allergene dichiarato dopo la conferma torna incerto per quello", () => {
    const { structure, week } = setup({ allergens: ["glutine", "uova"] });
    const confirmations = deriveConfirmations([confirmFor({ name: "Prosciutto cotto" }, ["glutine"])]).byKey;
    const r = checkConstraints(structure, week, { expand: expand([{ name: "Prosciutto cotto" }]), allergensOf: () => [], linkOf: knownLink, confirmations });
    expect(r.unverified).toHaveLength(1);
    expect(r.unverified[0]?.terms).toEqual(["uova"]);
    expect(r.confirmed?.[0]?.terms).toEqual(["glutine"]);
  });

  it("un allergene trovato resta una violazione, anche con una conferma costruita a mano", () => {
    const { structure, week } = setup({ allergens: ["glutine"] });
    const fake = new Map([
      [
        JSON.stringify(["farina 00", "", "", [], "", []]),
        { key: JSON.stringify(["farina 00", "", "", [], "", []]), ingredient: "Farina 00", allergens: ["glutine"], excludedFoods: [], confirmedAt: T, eventId: "x", eventIds: ["x"], deviceId: "A" },
      ],
    ]);
    const r = checkConstraints(structure, week, { expand: expand([{ name: "Farina 00" }]), allergensOf: () => [], linkOf: knownLink, confirmations: fake });
    expect(r.ok).toBe(false);
    expect(r.violations.map((v) => v.code)).toEqual(["allergen"]);
    expect(r.confirmed).toBeUndefined();
  });

  it("una nuova esclusione dichiarata dopo la conferma toglie valore alla conferma", () => {
    const { structure, week } = setup({ allergens: ["glutine"], excludedFoods: ["funghi"] });
    const confirmations = deriveConfirmations([confirmFor({ name: "Prosciutto cotto" }, ["glutine"], [])]).byKey;
    const r = checkConstraints(structure, week, { expand: expand([{ name: "Prosciutto cotto" }]), allergensOf: () => [], linkOf: knownLink, confirmations });
    expect(r.unverified.map((u) => u.code)).toEqual(["uncertain_allergens"]);
    expect(r.confirmed).toBeUndefined();
  });

  it("la nota dell'ingrediente fa parte della conferma", () => {
    const { structure, week } = setup({ allergens: ["glutine"] });
    const confirmations = deriveConfirmations([confirmFor({ name: "Prosciutto cotto" }, ["glutine"])]).byKey;
    const r = checkConstraints(structure, week, { expand: expand([{ name: "Prosciutto cotto", note: "affumicato" }]), allergensOf: () => [], linkOf: knownLink, confirmations });
    expect(r.unverified.map((u) => u.code)).toEqual(["uncertain_allergens"]);
    const same = deriveConfirmations([confirmFor({ name: "Prosciutto cotto", note: "affumicato" }, ["glutine"])]).byKey;
    const ok = checkConstraints(structure, week, { expand: expand([{ name: "Prosciutto cotto", note: "affumicato" }]), allergensOf: () => [], linkOf: knownLink, confirmations: same });
    expect(ok.unverified).toEqual([]);
    expect(ok.confirmed).toHaveLength(1);
  });
});
