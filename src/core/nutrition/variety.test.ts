import { describe, expect, it } from "vitest";
import { declaration, meal } from "../diary/test-helpers";
import { computeIntake } from "./intake";
import { createResolver } from "./resolve";
import { fakeFood } from "./test-helpers";
import { analyzeVariety, foodLookup, plantKindOf } from "./variety";

const FOODS = [
  fakeFood("lenticchie-secche", "Lenticchie, secche", { proteinG: 25 }, { group: "legumi", variantOf: "lenticchie", aliases: ["lenticchie secche"] }),
  fakeFood("lenticchie-lessate", "Lenticchie, cotte", { proteinG: 9 }, { group: "legumi", variantOf: "lenticchie", aliases: ["lenticchie cotte"] }),
  fakeFood("mela-cruda", "Mela, cruda", { proteinG: 0.3 }, { group: "frutta", aliases: ["mela"] }),
  fakeFood("spinaci-crudi", "Spinaci, crudi", { proteinG: 2.9 }, { group: "verdura", aliases: ["spinaci"] }),
  fakeFood("patata-lessa", "Patate, lesse", { proteinG: 2 }, { group: "verdura", aliases: ["patate"] }),
  fakeFood("riso-integrale-cotto", "Riso integrale, cotto", { proteinG: 2.7 }, { group: "cereali", variantOf: "riso-integrale", aliases: ["riso integrale"] }),
  fakeFood("riso-bianco-cotto", "Riso bianco, cotto", { proteinG: 2.7 }, { group: "cereali", aliases: ["riso bianco"] }),
  fakeFood("noci", "Noci", { proteinG: 15 }, { group: "frutta-secca" }),
  fakeFood("basilico-fresco", "Basilico, fresco", { proteinG: 3 }, { group: "condimenti", aliases: ["basilico"] }),
  fakeFood("olio", "Olio di oliva", { proteinG: 0 }, { group: "oli-e-grassi" }),
  fakeFood("pollo", "Pollo", { proteinG: 20 }, { group: "carne" }),
];
const lookup = foodLookup(FOODS);
const resolver = createResolver({ foods: FOODS, productByRef: () => undefined });
const TODAY = "2026-03-10";
const at = (date: string, hhmm: string) => `${date}T${hhmm}:00.000Z`;
const item = (name: string) => ({ name, quantity: { value: 100, unit: "g" as const }, certainty: "measured" as const });

type Kind = "breakfast" | "lunch" | "dinner" | "snack";
let n = 0;
const m = (date: string, hhmm: string, kind: Kind, names: string[]) => {
  n++;
  return meal(`m${n}`, at(date, hhmm), { mealId: `x${n}`, kind, items: names.map(item) });
};
const fullDay = (date: string, b: string[], l: string[], d: string[]) => [
  m(date, "07:30", "breakfast", b),
  m(date, "12:30", "lunch", l),
  m(date, "19:30", "dinner", d),
];
const run = (events: unknown[]) =>
  analyzeVariety(computeIntake(events, resolver, { timeZone: "UTC" }).days, lookup, TODAY);

describe("plantKindOf", () => {
  it("raggruppa gli stati dello stesso alimento e classifica per gruppo", () => {
    expect(plantKindOf(FOODS[0]!)).toEqual({ key: "lenticchie", name: "Lenticchie", group: "legumes" });
    expect(plantKindOf(FOODS[1]!)?.key).toBe("lenticchie");
    expect(plantKindOf(FOODS[5]!)?.group).toBe("wholeGrains");
    expect(plantKindOf(FOODS[8]!)?.group).toBe("herbs");
  });

  it("non conta patate, cereali raffinati, olio e carne", () => {
    for (const i of [4, 6, 9, 10]) expect(plantKindOf(FOODS[i]!)).toBeUndefined();
  });
});

describe("analyzeVariety", () => {
  it("senza dati: niente conteggio e nessun gruppo dichiarato assente", () => {
    const r = run([]);
    expect(r.current).toMatchObject({ count: 0, daysWithData: 0, partial: false });
    expect(r.absent).toEqual([]);
    expect(r.monotony).toEqual([]);
  });

  it("conta alimenti diversi, non voci; secco e cotto sono lo stesso alimento", () => {
    const r = run([
      ...fullDay("2026-03-09", ["Mela"], ["Lenticchie secche", "Spinaci"], ["Lenticchie cotte", "Pollo"]),
      ...fullDay("2026-03-10", ["Mela"], ["Spinaci", "Riso integrale"], ["Noci", "Basilico"]),
    ]);
    expect(r.current.count).toBe(6);
    expect(r.current.byGroup.legumes).toEqual([{ key: "lenticchie", name: "Lenticchie", days: 1 }]);
    expect(r.current.byGroup.fruit[0]).toMatchObject({ name: "Mela", days: 2 });
    expect(r.current.partial).toBe(false);
    expect(r.absent).toEqual([]);
  });

  it("alimenti non riconosciuti e giorni incompleti rendono il conteggio un minimo", () => {
    const r = run(fullDay("2026-03-10", ["Mela"], ["Cibo sconosciuto"], ["Pollo"]));
    expect(r.current.count).toBe(1);
    expect(r.current.unrecognizedLines).toBe(1);
    expect(r.current.partial).toBe(true);
    const incomplete = run([m("2026-03-10", "12:00", "lunch", ["Mela"])]);
    expect(incomplete.current).toMatchObject({ count: 1, daysWithData: 1, completeDays: 0, partial: true });
  });

  it("i giorni senza dati non contano; la settimana prima è separata", () => {
    const r = run([
      ...fullDay("2026-03-01", ["Mela"], ["Spinaci"], ["Noci"]),
      ...fullDay("2026-03-10", ["Mela"], ["Pollo"], ["Pollo"]),
    ]);
    expect(r.current).toMatchObject({ daysWithData: 1, count: 1 });
    expect(r.previous).toMatchObject({ from: "2026-02-25", to: "2026-03-03", count: 3, daysWithData: 1 });
  });

  it("dice da quanti giorni manca un gruppo, o che non è mai stato registrato", () => {
    const r = run([
      ...fullDay("2026-03-01", ["Lenticchie cotte"], ["Pollo"], ["Pollo"]),
      ...fullDay("2026-03-10", ["Mela"], ["Spinaci"], ["Pollo"]),
    ]);
    expect(r.absent.find((a) => a.group === "legumes")).toEqual({ group: "legumes", daysSince: 9 });
    expect(r.absent.find((a) => a.group === "herbs")).toEqual({ group: "herbs" });
    expect(r.absent[0]!.daysSince).toBeUndefined();
    expect(r.absent.map((a) => a.group)).not.toContain("fruit");
  });

  it("segnala lo stesso alimento in più di metà dei pasti, ma non olio e condimenti", () => {
    const r = run([
      ...fullDay("2026-03-09", ["Mela", "Olio di oliva"], ["Riso bianco", "Olio di oliva"], ["Riso bianco", "Olio di oliva"]),
      ...fullDay("2026-03-10", ["Riso bianco", "Olio di oliva"], ["Riso bianco"], ["Pollo", "Olio di oliva"]),
    ]);
    expect(r.monotony.map((x) => [x.name, x.meals, x.totalMeals])).toEqual([["Riso bianco", 4, 6]]);
  });

  it("esattamente la metà dei pasti non basta; con pochi pasti niente", () => {
    const half = run([
      ...fullDay("2026-03-09", ["Mela"], ["Mela"], ["Pollo"]),
      ...fullDay("2026-03-10", ["Mela"], ["Spinaci"], ["Noci"]),
    ]);
    expect(half.monotony).toEqual([]);
    const few = run([m("2026-03-10", "12:00", "lunch", ["Mela"]), m("2026-03-10", "19:00", "dinner", ["Mela"])]);
    expect(few.monotony).toEqual([]);
  });

  it("un pasto saltato non ha voci e non conta tra i pasti", () => {
    const r = run([
      m("2026-03-10", "07:00", "breakfast", ["Mela"]),
      declaration("d1", at("2026-03-10", "13:00"), { date: "2026-03-10", kind: "lunch", status: "skipped" }),
      m("2026-03-10", "19:00", "dinner", ["Mela"]),
    ]);
    expect(r.current.count).toBe(1);
    expect(r.current.completeDays).toBe(1);
  });
});
