import { describe, expect, it } from "vitest";
import { derivePantry, mergeEvents, type ConsumeEvent, type EventLike } from "../ledger";
import { computeIntake, createResolver } from "../nutrition";
import { FAKE_FOODS } from "../nutrition/test-helpers";
import { deriveDiary } from "./derive";
import { appendItems, changeConsumeQuantity, currentMeal, removeConsume, removeItem, rewriteMeal, type EditContext, type MealEdit } from "./editMeal";
import { pantryMealReport } from "./pantry";
import { mealForMoment, placeConsumes } from "./placeConsume";
import { getDay, mealMoments } from "./selectors";
import { consume, meal, purchase, seededRandom, shuffled, voidOf } from "./test-helpers";
import type { MealItem } from "./types";
import { voidMeal } from "./voidMeal";

const D = "2026-03-10";
const TZ = { timeZone: "UTC" };
const at = (hhmm: string) => `${D}T${hhmm}:00.000Z`;
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

let n = 0;
const ctx = (now: string, deviceId: string): EditContext => ({ deviceId, now, idGenerator: () => `${deviceId}-${++n}`, timeZone: "UTC" });
const options = (now: string, deviceId: string) => ({ deviceId, now: () => now, idGenerator: () => `${deviceId}-${++n}` });

type Log = unknown[];

const lot = purchase("p1", at("06:00"), { lotId: "lot-1", productRef: "Petto di pollo", quantity: q(400), location: "frigo" });
const pizza: MealItem = { name: "Pizza", quantity: q(1, "pz"), certainty: "estimated" };
const lunch = meal("m1", at("13:00"), { mealId: "meal-1", kind: "lunch", title: "Pranzo veloce", items: [pizza], certainty: "estimated" });
const c1 = consume("c1", at("13:00"), { lotId: "lot-1", quantity: q(150), mealId: "meal-1" });
const base: Log = [lot, lunch, c1];

const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });

function done(edit: MealEdit) {
  if (!edit.ok) throw new Error(`atteso ok: ${edit.error}`);
  return edit.events;
}

function view(log: Log) {
  const state = deriveDiary(log, TZ);
  const report = pantryMealReport(state, log);
  const intake = computeIntake(log, resolver, TZ);
  return {
    meals: report.meals.map((m) => ({
      mealId: m.mealId,
      kind: m.kind,
      at: m.at,
      title: m.title,
      items: m.items.map((i) => i.name),
      consumes: m.pantryConsumes.map((c) => c.quantity.value),
      revived: m.revived,
    })),
    orphans: report.orphanConsumes.map((c) => c.quantity.value),
    standalone: intake.days.flatMap((d) => d.standalone.map((l) => l.quantity.value)),
    mealLines: intake.days.flatMap((d) => d.meals.flatMap((m) => m.lines.map((l) => `${m.mealId}:${l.quantity.value}`))),
    remaining: derivePantry(log as never[]).lots[0].remaining,
  };
}

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

describe("un telefono toglie il pasto mentre l'altro ne corregge un consumo", () => {
  const removal = voidMeal("meal-1", base, options(at("14:00"), "dev-a"));
  const correction = done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:05"), "dev-b")));

  it("il consumo rimasto valido non resta fuori dal diario: il pasto compare ancora, con quella sola voce e il segno `revived`", () => {
    const { shown } = everywhere(61, base, removal, correction);
    expect(shown.meals).toEqual([{ mealId: "meal-1", kind: "lunch", at: at("13:00"), title: undefined, items: [], consumes: [100], revived: true }]);
    expect(shown.orphans).toEqual([]);
    expect(shown.standalone).toEqual([]);
    expect(shown.mealLines).toEqual(["meal-1:100"]);
    expect(shown.remaining).toBe(300);
  });

  it("il momento torna «registrato» e il pasto si ritrova per momento", () => {
    const { merged } = everywhere(62, base, removal, correction);
    const state = deriveDiary(merged, TZ);
    expect(mealMoments(getDay(state, D)).find((m) => m.kind === "lunch")?.status).toBe("recorded");
    expect(mealForMoment(state, D, "lunch")?.mealId).toBe("meal-1");
  });

  it("«Togli il pasto» sul pasto ricomparso annulla il consumo rimasto, e «Annulla» lo riporta", () => {
    const { merged, shown } = everywhere(63, base, removal, correction);
    const again = voidMeal("meal-1", merged, options(at("15:00"), "dev-a"));
    expect(again).toHaveLength(1);
    const after = everywhere(64, merged, again).shown;
    expect(after).toEqual({ meals: [], orphans: [], standalone: [], mealLines: [], remaining: 400 });
    const undo = again.map((e, i) => voidOf(`undo-${++n}-${i}`, at("15:01"), e.id));
    expect(view([...merged, ...again, ...undo])).toEqual(shown);
  });

  it("le correzioni funzionano sul pasto ricomparso: quantità, voce tolta, voce aggiunta, ora", () => {
    const { merged } = everywhere(65, base, removal, correction);
    const cur = currentMeal("meal-1", merged);
    expect(cur?.meal).toMatchObject({ mealId: "meal-1", kind: "lunch", at: at("13:00") });
    expect(cur?.meal.items).toBeUndefined();
    expect(cur?.consumes.map((c) => c.quantity.value)).toEqual([100]);
    const shownConsume = cur?.consumes[0] as ConsumeEvent;

    const less = done(changeConsumeQuantity(shownConsume, { value: 60, estimated: false }, 400, ctx(at("15:00"), "dev-a")));
    expect(everywhere(66, merged, less).shown.meals[0]).toMatchObject({ consumes: [60], revived: true });

    const gone = done(removeConsume(shownConsume, merged, ctx(at("15:00"), "dev-a")));
    expect(everywhere(67, merged, gone).shown.meals).toEqual([]);

    // con una voce o un'ora nuova il pasto torna a essere un pasto come gli altri, con lo stesso `mealId`
    const added = done(appendItems("meal-1", [pizza], merged, ctx(at("15:00"), "dev-a")));
    expect(added.map((e) => e.type)).toEqual(["meal"]);
    expect(everywhere(68, merged, added).shown.meals).toEqual([
      { mealId: "meal-1", kind: "lunch", at: at("13:00"), title: undefined, items: ["Pizza"], consumes: [100], revived: undefined },
    ]);
    const later = done(rewriteMeal("meal-1", { kind: "dinner", minutes: 20 * 60 }, merged, ctx(at("21:00"), "dev-a")));
    expect(everywhere(69, merged, later).shown.meals[0]).toMatchObject({ kind: "dinner", at: at("20:00"), consumes: [100], revived: undefined });

    expect(removeItem("meal-1", 0, merged, ctx(at("15:00"), "dev-a"))).toEqual({ ok: false, error: "Questa voce non c'è più." });
  });

  it("un consumo segnato dopo va nel pasto ricomparso, non in uno nuovo", () => {
    const { merged } = everywhere(70, base, removal, correction);
    const placed = placeConsumes([consume("c9", at("13:20"), { lotId: "lot-1", quantity: q(40) })], deriveDiary(merged, TZ), ctx(at("13:20"), "dev-a"));
    if (!placed.ok) throw new Error("atteso ok");
    expect(placed.joined).toBe(true);
    expect(everywhere(71, merged, placed.events).shown.meals[0]).toMatchObject({ mealId: "meal-1", consumes: [100, 40], revived: true });
  });
});

describe("quando un pasto tolto non deve ricomparire", () => {
  it("tolto con tutti i suoi consumi: non compare", () => {
    const removal = voidMeal("meal-1", base, options(at("14:00"), "dev-a"));
    expect(view([...base, ...removal])).toEqual({ meals: [], orphans: [], standalone: [], mealLines: [], remaining: 400 });
  });

  it("un consumo il cui pasto non è mai arrivato resta fuori, tra gli orfani, finché il pasto non arriva", () => {
    const early: Log = [lot, c1];
    expect(view(early)).toMatchObject({ meals: [], orphans: [150] });
    expect(voidMeal("meal-1", early, options(at("14:00"), "dev-a"))).toEqual([]);
    expect(view([...early, lunch])).toMatchObject({ meals: [{ mealId: "meal-1", consumes: [150], revived: undefined }], orphans: [] });
  });

  it("se resta in vigore un'altra versione del pasto vale quella, senza il segno", () => {
    // A toglie il pasto, B nel frattempo gli aggiunge una voce: la versione di B è ancora valida
    const removal = voidMeal("meal-1", base, options(at("14:00"), "dev-a"));
    const added = done(appendItems("meal-1", [{ name: "Pane", quantity: q(50), certainty: "estimated" }], base, ctx(at("14:05"), "dev-b")));
    const { shown } = everywhere(72, base, removal, added);
    expect(shown.meals).toEqual([
      { mealId: "meal-1", kind: "lunch", at: at("13:00"), title: "Pranzo veloce", items: ["Pizza", "Pane"], consumes: [], revived: undefined },
    ]);
    expect(shown.orphans).toEqual([]);
  });
});
