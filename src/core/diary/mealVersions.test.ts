import { describe, expect, it } from "vitest";
import { derivePantry, mergeEvents, type EventLike } from "../ledger";
import { computeIntake, createResolver } from "../nutrition";
import { FAKE_FOODS } from "../nutrition/test-helpers";
import { deriveDiary } from "./derive";
import { appendItems, changeItem, currentMeal, moveItem, removeItem, rewriteMeal, type EditContext, type MealEdit } from "./editMeal";
import { mealsWithPantry } from "./pantry";
import { consume, meal, purchase, seededRandom, shuffled, voidOf } from "./test-helpers";
import type { MealItem } from "./types";

const D = "2026-03-10";
const TZ = { timeZone: "UTC" };
const at = (hhmm: string) => `${D}T${hhmm}:00.000Z`;
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

let n = 0;
const ctx = (now: string, deviceId: string): EditContext => ({ deviceId, now, idGenerator: () => `${deviceId}-${++n}`, timeZone: "UTC" });

type Log = unknown[];

const lot = purchase("p1", at("06:00"), { lotId: "lot-1", productRef: "Petto di pollo", quantity: q(400), location: "frigo" });
const pizza: MealItem = { name: "Pizza", quantity: q(1, "pz"), certainty: "estimated" };
const mela: MealItem = { name: "Mela", quantity: q(1, "pz"), certainty: "estimated" };
const pane: MealItem = { name: "Pane", quantity: q(50), certainty: "estimated" };
const lunch = meal("m1", at("13:00"), { mealId: "meal-1", kind: "lunch", items: [pizza, mela], certainty: "estimated" });
const c1 = consume("c1", at("13:00"), { lotId: "lot-1", quantity: q(150), mealId: "meal-1" });
const base: Log = [lot, lunch, c1];

const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });

function done(edit: MealEdit) {
  if (!edit.ok) throw new Error(`atteso ok: ${edit.error}`);
  return edit.events;
}
const text = (items: readonly MealItem[]) => items.map((i) => `${i.name} ${i.quantity.value}`);

function view(log: Log) {
  const state = deriveDiary(log, TZ);
  return {
    meals: mealsWithPantry(state, log).map((m) => ({
      mealId: m.mealId,
      eventId: m.eventId,
      kind: m.kind,
      at: m.at,
      items: text(m.items),
      consumes: m.pantryConsumes.map((c) => c.quantity.value),
      others: (m.otherVersions ?? []).map((v) => ({ eventId: v.eventId, kind: v.kind, at: v.at, items: text(v.items) })),
    })),
    anomalies: state.anomalies.map((a) => [a.code, a.eventId, a.keptEventId]),
    remaining: derivePantry(log as never[]).lots[0].remaining,
    energy: computeIntake(log, resolver, TZ).days.map((d) => [d.date, d.totals.energyKcal?.value]),
  };
}

/** Lo stesso insieme di eventi come arriva su dispositivi diversi; il risultato deve essere identico. */
function everywhere(seed: number, ...parts: Log[]) {
  const random = seededRandom(seed);
  const union = parts.flat();
  const merged = parts.reduce((acc, p) => mergeEvents(acc as EventLike[], p as EventLike[]).events as Log, [] as Log);
  const reference = view(merged);
  for (const log of [[...union].reverse(), ...Array.from({ length: 12 }, () => shuffled(union, random))]) {
    expect(view(log)).toEqual(reference);
  }
  return { merged, shown: reference };
}

describe("due telefoni correggono lo stesso pasto: si uniscono le correzioni che non si toccano", () => {
  it("A cambia la pizza in 2 pz, B aggiunge il pane: valgono tutte e due, in qualunque ordine arrivino", () => {
    const a = done(changeItem("meal-1", 0, { quantity: q(2, "pz") }, base, ctx(at("14:00"), "dev-a")));
    const b = done(appendItems("meal-1", [pane], base, ctx(at("14:05"), "dev-b")));
    const { shown } = everywhere(31, base, a, b);
    expect(shown.meals).toHaveLength(1);
    expect(shown.meals[0].items).toEqual(["Pizza 2", "Mela 1", "Pane 50"]);
    expect(shown.meals[0].consumes).toEqual([150]);
    expect(shown.meals[0].others).toEqual([]);
    expect(shown.remaining).toBe(250);
    // vale lo stesso se la correzione più vecchia è l'aggiunta
    const b2 = done(appendItems("meal-1", [pane], base, ctx(at("13:55"), "dev-b")));
    expect(everywhere(32, base, a, b2).shown.meals[0].items).toEqual(["Pizza 2", "Mela 1", "Pane 50"]);
  });

  it("A cambia l'ora, B toglie una voce: l'ora di A e le voci di B", () => {
    const a = done(rewriteMeal("meal-1", { kind: "dinner", minutes: 20 * 60 }, base, ctx(at("21:00"), "dev-a")));
    const b = done(removeItem("meal-1", 0, base, ctx(at("21:05"), "dev-b")));
    const { shown } = everywhere(33, base, a, b);
    expect(shown.meals).toEqual([expect.objectContaining({ kind: "dinner", at: at("20:00"), items: ["Mela 1"], consumes: [150], others: [] })]);
  });

  it("tutti e due aggiungono: le aggiunte dell'uno e dell'altro, una volta sola quella uguale", () => {
    const a = done(appendItems("meal-1", [pane], base, ctx(at("14:00"), "dev-a")));
    const b = done(appendItems("meal-1", [pane, { name: "Noci", quantity: q(20), certainty: "estimated" }], base, ctx(at("14:05"), "dev-b")));
    expect(everywhere(34, base, a, b).shown.meals[0].items).toEqual(["Pizza 1", "Mela 1", "Pane 50", "Noci 20"]);
  });

  it("A sposta una voce a cena, B cambia l'ora del pranzo: la voce spostata non compare due volte", () => {
    const dinner = meal("m2", at("20:00"), { mealId: "meal-2", kind: "dinner", items: [{ name: "Zuppa", quantity: q(300), certainty: "measured" }] });
    const log0: Log = [...base, dinner];
    const a = done(moveItem("meal-1", 0, { kind: "dinner" }, log0, deriveDiary(log0, TZ), ctx(at("21:00"), "dev-a")));
    const b = done(rewriteMeal("meal-1", { minutes: 12 * 60 }, log0, ctx(at("21:05"), "dev-b")));
    const { shown } = everywhere(35, log0, a, b);
    expect(shown.meals.map((m) => [m.kind, m.at, m.items])).toEqual([
      ["lunch", at("12:00"), ["Mela 1"]],
      ["dinner", at("20:00"), ["Zuppa 300", "Pizza 1"]],
    ]);
  });

  it("tre telefoni: un'aggiunta, un cambio d'ora e una voce tolta entrano tutti", () => {
    const a = done(appendItems("meal-1", [pane], base, ctx(at("14:00"), "dev-a")));
    const b = done(rewriteMeal("meal-1", { minutes: 12 * 60 + 30 }, base, ctx(at("14:02"), "dev-b")));
    const c = done(removeItem("meal-1", 1, base, ctx(at("14:04"), "dev-c")));
    const { shown } = everywhere(36, base, a, b, c);
    expect(shown.meals).toEqual([expect.objectContaining({ at: at("12:30"), items: ["Pizza 1", "Pane 50"], others: [] })]);
    expect(shown.anomalies.map((x) => x[0])).toEqual(["duplicate_meal", "duplicate_meal"]);
  });

  it("due correzioni di fila su un telefono e una sull'altro: si risale alla versione comune", () => {
    const a1 = done(changeItem("meal-1", 0, { quantity: q(2, "pz") }, base, ctx(at("14:00"), "dev-a")));
    const a2 = done(removeItem("meal-1", 1, [...base, ...a1], ctx(at("14:02"), "dev-a")));
    const b = done(appendItems("meal-1", [pane], base, ctx(at("14:01"), "dev-b")));
    expect(everywhere(37, base, a1, a2, b).shown.meals[0].items).toEqual(["Pizza 2", "Pane 50"]);
  });
});

describe("due telefoni cambiano le stesse voci: vale la più recente, l'altra è segnalata", () => {
  const a = done(changeItem("meal-1", 0, { quantity: q(2, "pz") }, base, ctx(at("14:00"), "dev-a")));
  const b = done(removeItem("meal-1", 1, base, ctx(at("14:05"), "dev-b")));

  it("si mostra la versione registrata per ultima, con l'altra accanto e le sue voci", () => {
    const { shown } = everywhere(41, base, a, b);
    expect(shown.meals).toHaveLength(1);
    expect(shown.meals[0].eventId).toBe(b[1].id);
    expect(shown.meals[0].items).toEqual(["Pizza 1"]);
    expect(shown.meals[0].others).toEqual([{ eventId: a[1].id, kind: "lunch", at: at("13:00"), items: ["Pizza 2", "Mela 1"] }]);
    expect(shown.anomalies).toEqual([["duplicate_meal", a[1].id, b[1].id]]);
    expect(shown.meals[0].consumes).toEqual([150]);
  });

  it("vale la più recente anche se l'altra ha l'ora del pasto più bassa", () => {
    const early = done(rewriteMeal("meal-1", { minutes: 8 * 60 }, [...base, ...a], ctx(at("14:01"), "dev-a")));
    const { shown } = everywhere(42, base, a, early, b);
    expect(shown.meals[0].eventId).toBe(b[1].id);
    expect(shown.meals[0].others.map((o) => o.at)).toEqual([at("08:00")]);
  });

  it("la correzione successiva parte da ciò che si vede e chiude il doppione; «Annulla» lo riapre com'era", () => {
    const { merged, shown } = everywhere(43, base, a, b);
    expect(currentMeal("meal-1", merged)?.meal.items?.map((i) => i.name)).toEqual(["Pizza"]);
    const next = done(appendItems("meal-1", [pane], merged, ctx(at("15:00"), "dev-a")));
    expect(next.map((e) => e.type)).toEqual(["void", "void", "meal"]);
    const after = everywhere(44, merged, next).shown;
    expect(after.meals[0].items).toEqual(["Pizza 1", "Pane 50"]);
    expect(after.meals[0].others).toEqual([]);
    expect(after.anomalies).toEqual([]);
    const undo = next.map((e, i) => voidOf(`undo-${++n}-${i}`, at("15:01"), e.id));
    expect(view([...merged, ...next, ...undo])).toEqual(shown);
  });
});

describe("la correzione dopo l'unione scrive ciò che si vedeva unito", () => {
  it("cambiare una voce del pasto unito tiene le aggiunte di tutti e due i telefoni", () => {
    const a = done(changeItem("meal-1", 0, { quantity: q(2, "pz") }, base, ctx(at("14:00"), "dev-a")));
    const b = done(appendItems("meal-1", [pane], base, ctx(at("14:05"), "dev-b")));
    const { merged } = everywhere(51, base, a, b);
    // la voce 2 del pasto mostrato è il pane aggiunto da B
    const next = done(changeItem("meal-1", 2, { quantity: q(80) }, merged, ctx(at("15:00"), "dev-a")));
    const after = everywhere(52, merged, next).shown;
    expect(after.meals[0].items).toEqual(["Pizza 2", "Mela 1", "Pane 80"]);
    expect(after.anomalies).toEqual([]);
  });

  it("due pasti uguali scritti senza una versione comune non si uniscono: vale il più recente", () => {
    const twin = meal("m1b", at("13:00"), { mealId: "meal-1", kind: "lunch", items: [pane], recordedAt: at("13:30") });
    const { shown } = everywhere(53, base, [twin]);
    expect(shown.meals[0].eventId).toBe("m1b");
    expect(shown.meals[0].others).toEqual([{ eventId: "m1", kind: "lunch", at: at("13:00"), items: ["Pizza 1", "Mela 1"] }]);
  });
});
