import { describe, expect, it } from "vitest";
import { derivePantry, mergeEvents, type ConsumeEvent, type EventLike } from "../ledger";
import { computeIntake, createResolver } from "../nutrition";
import { FAKE_FOODS } from "../nutrition/test-helpers";
import { deriveDiary } from "./derive";
import { changeConsumeQuantity, type EditContext, type MealEdit } from "./editMeal";
import { activeConsumes } from "./log";
import { pantryMealReport } from "./pantry";
import { moveConsumes } from "./placeConsume";
import { consume, meal, purchase, seededRandom, shuffled, voidOf } from "./test-helpers";
import { voidMeal } from "./voidMeal";

const D = "2026-03-10";
const TZ = { timeZone: "UTC" };
const at = (hhmm: string) => `${D}T${hhmm}:00.000Z`;
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

let n = 0;
const ctx = (now: string, deviceId: string): EditContext => ({ deviceId, now, idGenerator: () => `${deviceId}-${++n}`, timeZone: "UTC" });
const options = (now: string, deviceId = "dev-a") => ({ deviceId, now: () => now, idGenerator: () => `${deviceId}-${++n}` });

type Log = unknown[];

const lot = purchase("p1", at("06:00"), { lotId: "lot-1", productRef: "Petto di pollo", quantity: q(400), location: "frigo" });
const lunch = meal("m1", at("13:00"), { mealId: "meal-1", kind: "lunch", items: [{ name: "Mela", quantity: q(1, "pz"), certainty: "estimated" }] });
const c1 = consume("c1", at("13:00"), { lotId: "lot-1", quantity: q(150), mealId: "meal-1" });
const base: Log = [lot, lunch, c1];

const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });

function done(edit: MealEdit) {
  if (!edit.ok) throw new Error(`atteso ok: ${edit.error}`);
  return edit.events;
}

/** Che cosa vede l'utente: pasti con i loro consumi, consumi rimasti senza pasto, dispensa, energia del giorno. */
function snapshot(log: Log) {
  const report = pantryMealReport(deriveDiary(log, TZ), log);
  return {
    meals: report.meals.map((m) => ({ mealId: m.mealId, kind: m.kind, items: m.items, consumes: m.pantryConsumes.map((c) => c.quantity.value) })),
    orphans: report.orphanConsumes.map((c) => c.quantity.value),
    remaining: derivePantry(log as never[]).lots[0].remaining,
    energy: computeIntake(log, resolver, TZ).days.find((d) => d.date === D)?.totals.energyKcal?.value,
  };
}

/** Lo stesso insieme di eventi come arriva su dispositivi diversi: unioni nei due versi e ordini a caso. */
function orders(a: Log, b: Log, seed: number): Log[] {
  const random = seededRandom(seed);
  const union = [...a, ...b];
  return [
    mergeEvents(a as EventLike[], b as EventLike[]).events,
    mergeEvents(b as EventLike[], a as EventLike[]).events,
    [...union].reverse(),
    ...Array.from({ length: 12 }, () => shuffled(union, random)),
  ];
}

const undo = (events: readonly { id: string }[], when: string) => events.map((e, i) => voidOf(`undo-${++n}-${i}`, when, e.id));

describe("voidMeal", () => {
  it("annulla il pasto e i suoi consumi: prima il pasto, tutti allo stesso istante, e la dispensa torna com'era", () => {
    const voids = voidMeal("meal-1", base, options(at("14:00")));
    expect(voids.map((v) => v.targetEventId)).toEqual(["m1", "c1"]);
    expect(new Set(voids.map((v) => v.recordedAt))).toEqual(new Set([at("14:00")]));
    expect(snapshot([...base, ...voids])).toEqual({ meals: [], orphans: [], remaining: 400, energy: undefined });
  });

  it("un pasto che non c'è o è già annullato: niente da scrivere", () => {
    expect(voidMeal("meal-x", base)).toEqual([]);
    const voids = voidMeal("meal-1", base, options(at("14:00")));
    expect(voidMeal("meal-1", [...base, ...voids], options(at("14:01")))).toEqual([]);
  });

  it("dopo un conflitto unito: nessun consumo del pasto resta vivo, su nessun dispositivo, e «Annulla» riporta ciò che si vedeva", () => {
    const a = [...base, ...done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")))];
    const b = [...base, ...done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:05"), "dev-b")))];
    const merged = mergeEvents(a as EventLike[], b as EventLike[]).events as Log;
    const before = snapshot(merged);
    expect(before.meals[0].consumes).toEqual([100]);

    const voids = voidMeal("meal-1", merged, options(at("15:00")));
    // il pasto, il consumo che contava (100 g) e quello scartato dell'altro telefono (80 g)
    expect(voids).toHaveLength(3);
    for (const log of orders(merged, voids, 21)) {
      expect(activeConsumes(log)).toEqual([]);
      expect(snapshot(log)).toEqual({ meals: [], orphans: [], remaining: 400, energy: undefined });
    }
    for (const log of orders(merged, [...voids, ...undo(voids, at("15:01"))], 22)) expect(snapshot(log)).toEqual(before);
  });

  it("dopo correzioni a catena su un telefono e una sull'altro: lo stesso", () => {
    const a1 = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")));
    const a2 = done(changeConsumeQuantity(a1[1] as ConsumeEvent, { value: 120, estimated: true }, 400, ctx(at("14:02"), "dev-a")));
    const b = [...base, ...done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:01"), "dev-b")))];
    const merged = mergeEvents([...base, ...a1, ...a2] as EventLike[], b as EventLike[]).events as Log;
    const before = snapshot(merged);
    expect(before.meals[0].consumes).toEqual([120]);
    const voids = voidMeal("meal-1", merged, options(at("15:00"), "dev-b"));
    for (const log of orders(merged, voids, 23)) {
      expect(activeConsumes(log)).toEqual([]);
      expect(snapshot(log)).toEqual({ meals: [], orphans: [], remaining: 400, energy: undefined });
    }
    for (const log of orders(merged, [...voids, ...undo(voids, at("15:01"))], 24)) expect(snapshot(log)).toEqual(before);
  });

  it("il consumo che l'altro telefono ha spostato in un altro pasto resta là; qui non resta niente che possa tornare", () => {
    // A corregge la quantità (resta a pranzo); B, più tardi, sposta il consumo a cena: vale lo spostamento.
    const a = [...base, ...done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")))];
    const moved = moveConsumes([c1], deriveDiary(base, TZ), { ...ctx(at("14:05"), "dev-b"), timeZone: "UTC" }, { kind: "dinner" });
    if (!moved.ok) throw new Error("atteso ok");
    const merged = mergeEvents(a as EventLike[], [...base, ...moved.events] as EventLike[]).events as Log;
    const before = snapshot(merged);
    expect(before.meals.map((m) => [m.kind, m.consumes])).toEqual([["lunch", []], ["dinner", [150]]]);

    const voids = voidMeal("meal-1", merged, options(at("15:00")));
    for (const log of orders(merged, voids, 25)) {
      const view = snapshot(log);
      expect(view.meals.map((m) => [m.kind, m.consumes])).toEqual([["dinner", [150]]]);
      expect(view.orphans).toEqual([]);
      expect(view.remaining).toBe(250);
    }
    // tolta poi anche la cena, il consumo scartato del pranzo non torna a contare
    const afterLunch = [...merged, ...voids];
    const dinnerVoids = voidMeal(moved.mealId, afterLunch, options(at("15:10")));
    for (const log of orders(afterLunch, dinnerVoids, 26)) {
      expect(activeConsumes(log)).toEqual([]);
      expect(snapshot(log)).toEqual({ meals: [], orphans: [], remaining: 400, energy: undefined });
    }
    for (const log of orders(merged, [...voids, ...undo(voids, at("15:01"))], 27)) expect(snapshot(log)).toEqual(before);
  });
});
