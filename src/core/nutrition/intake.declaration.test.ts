import { describe, expect, it } from "vitest";
import { declaration, drink, meal, voidOf } from "../diary/test-helpers";
import { computeIntake } from "./intake";
import { createResolver } from "./resolve";
import { FAKE_FOODS } from "./test-helpers";

const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });

const D = "2026-03-10";
const at = (hhmm: string) => `${D}T${hhmm}:00.000Z`;
const q = (value: number, unit: "g" | "ml" | "pz") => ({ value, unit });

const breakfast = meal("m-b", at("07:30"), {
  mealId: "b",
  kind: "breakfast",
  items: [{ name: "Petto di pollo", quantity: q(100, "g"), certainty: "measured" }],
});
const dinner = meal("m-d", at("19:30"), {
  mealId: "d",
  kind: "dinner",
  items: [{ name: "Petto di pollo", quantity: q(150, "g"), certainty: "measured" }],
});
const lunchStatus = (status: "skipped" | "untracked") =>
  declaration("x", at("14:00"), { date: D, kind: "lunch", status });

const intake = (events: unknown[]) => computeIntake(events, resolver, { timeZone: "UTC" }).days.find((d) => d.date === D)!;

describe("computeIntake: momenti saltati", () => {
  it("colazione e cena registrate e pranzo «saltato»: giornata completa, totale dei soli pasti registrati", () => {
    const day = intake([breakfast, dinner, lunchStatus("skipped")]);
    expect(day.complete).toBe(true);
    expect(day.reasons).toEqual([]);
    expect(day.coverage.skipped).toEqual(["lunch"]);
    expect(day.totals.energyKcal?.value).toBe(250);
    expect(day.totals.energyKcal?.partial).toBe(false);
  });

  it("con «mangiato, non registrato» la giornata è dichiaratamente incompleta", () => {
    const day = intake([breakfast, dinner, lunchStatus("untracked")]);
    expect(day.complete).toBe(false);
    expect(day.reasons).toEqual(["untracked_meals"]);
  });

  it("senza dichiarazione il pranzo manca e la giornata è incompleta", () => {
    const day = intake([breakfast, dinner]);
    expect(day.complete).toBe(false);
    expect(day.reasons).toEqual(["missing_meals"]);
  });

  it("annullata la dichiarazione «saltato», il giorno torna incompleto", () => {
    const day = intake([breakfast, dinner, lunchStatus("skipped"), voidOf("v", at("15:00"), "x")]);
    expect(day.complete).toBe(false);
    expect(day.reasons).toEqual(["missing_meals"]);
  });

  it("un pasto registrato dopo «saltato» vince: i totali sono quelli del pasto", () => {
    const lunch = meal("m-l", at("13:00"), {
      mealId: "l",
      kind: "lunch",
      items: [{ name: "Petto di pollo", quantity: q(200, "g"), certainty: "measured" }],
    });
    const day = intake([breakfast, dinner, lunch, lunchStatus("skipped")]);
    expect(day.complete).toBe(true);
    expect(day.coverage.skipped).toEqual([]);
    expect(day.totals.energyKcal?.value).toBe(450);
  });
});

describe("computeIntake: bevande nei totali", () => {
  it("«saltato» più una bevanda con valori noti: l'assunzione del momento è quella della bevanda, non zero", () => {
    const cola = drink("dr", at("12:40"), {
      name: "Cola",
      ml: 330,
      caffeineMg: 32,
      energyKcal: 139,
      sugarsG: 35,
      certainty: "estimated",
    });
    const day = intake([breakfast, dinner, lunchStatus("skipped"), cola]);
    expect(day.complete).toBe(true);
    expect(day.totals.energyKcal?.value).toBe(389);
    expect(day.totals.energyKcal?.certainty).toBe("estimated");
    expect(day.totals.sugarsG?.value).toBe(35);
    expect(day.totals.caffeineMg?.value).toBe(32);
    expect(day.drinks[0]).toMatchObject({ name: "Cola", energyKcal: 139, sugarsG: 35 });
  });

  it("una bevanda senza valori noti non aggiunge zeri: resta non nota", () => {
    const mystery = drink("dr", at("12:40"), { name: "Infuso di casa", ml: 250 });
    const withDrink = intake([breakfast, dinner, lunchStatus("skipped"), mystery]);
    const without = intake([breakfast, dinner, lunchStatus("skipped")]);
    expect(withDrink.totals).toEqual(without.totals);
    expect(withDrink.totals.energyKcal?.partial).toBe(false);
    // solo quella bevanda: nessun nutriente noto, non zero
    const only = intake([mystery]);
    expect(only.totals.energyKcal).toBeUndefined();
    expect(only.totals.caffeineMg).toBeUndefined();
  });

  it("l'alcol di una bevanda entra nei totali come stima, senza toccare l'energia se non dichiarata", () => {
    const beer = drink("dr", at("20:00"), { name: "Birra", ml: 330, alcoholG: 13, certainty: "estimated" });
    const day = intake([breakfast, dinner, lunchStatus("skipped"), beer]);
    expect(day.totals.alcoholG?.value).toBe(13);
    expect(day.totals.alcoholG?.certainty).toBe("estimated");
    expect(day.totals.energyKcal?.value).toBe(250);
  });
});
