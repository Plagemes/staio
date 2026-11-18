import { describe, expect, it } from "vitest";
import { mergeAllEvents, type AnyEvent } from "../events";
import { derivePantry, mergeEvents, validateEvent, type ConsumeEvent, type EventLike } from "../ledger";
import { consumeRoots } from "../ledger/supersede";
import { computeIntake, createResolver } from "../nutrition";
import { FAKE_FOODS } from "../nutrition/test-helpers";
import { deriveDiary } from "./derive";
import {
  appendItems,
  changeConsumeQuantity,
  changeItem,
  currentMeal,
  keepMealVersion,
  moveItem,
  removeConsume,
  removeItem,
  rewriteMeal,
  type EditContext,
  type MealEdit,
} from "./editMeal";
import { activeConsumes, familyConsumes } from "./log";
import { mealsWithPantry } from "./pantry";
import { moveConsumes, placeConsumes } from "./placeConsume";
import { getDay } from "./selectors";
import { voidMeal } from "./voidMeal";
import { consume, meal, purchase, seededRandom, shuffled, voidOf } from "./test-helpers";
import type { MealEvent, MealItem, MealKind } from "./types";
import { validateDiaryEvent } from "./validate";

const D = "2026-03-10";
const Y = "2026-03-09";
const TZ = { timeZone: "UTC" };
const at = (hhmm: string, day = D) => `${day}T${hhmm}:00.000Z`;
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

let n = 0;
const ctx = (now: string, deviceId = "dev-a"): EditContext => ({
  deviceId,
  now,
  idGenerator: () => `${deviceId}-${++n}`,
  timeZone: "UTC",
});

type Log = unknown[];

// 400 g comprati, 150 g mangiati a pranzo: ne restano 250.
const lot = purchase("p1", at("06:00"), { lotId: "lot-1", productRef: "Petto di pollo", quantity: q(400), location: "frigo" });
const pizza: MealItem = { name: "Pizza", quantity: q(1, "pz"), certainty: "estimated" };
const mela: MealItem = { name: "Mela", quantity: q(1, "pz"), certainty: "estimated", foodId: "mela" };
const lunch = meal("m1", at("13:00"), { mealId: "meal-1", kind: "lunch", title: "Pranzo veloce", items: [pizza, mela], certainty: "estimated" });
const c1 = consume("c1", at("13:00"), { lotId: "lot-1", quantity: q(150), mealId: "meal-1", note: "quick" });
const base: Log = [lot, lunch, c1];

const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });
const energyOf = (log: Log, date = D) => computeIntake(log, resolver, TZ).days.find((d) => d.date === date)?.totals.energyKcal?.value;

function done(edit: MealEdit): Extract<MealEdit, { ok: true }>["events"] {
  if (!edit.ok) throw new Error(`atteso ok: ${edit.error}`);
  return edit.events;
}
const errorOf = (edit: MealEdit): string | undefined => (edit.ok ? undefined : edit.error);

const mealsOf = (log: Log) => mealsWithPantry(deriveDiary(log, TZ), log);
const mealOf = (log: Log, mealId = "meal-1") => mealsOf(log).find((m) => m.mealId === mealId);
const remaining = (log: Log, lotId = "lot-1") => derivePantry(log as never[]).lots.find((l) => l.lotId === lotId)?.remaining;
const names = (items: readonly MealItem[] | undefined) => (items ?? []).map((i) => i.name);

/** «Annulla» sull'avviso: un `void` per ogni evento scritto dall'azione. */
const undo = (events: readonly { id: string }[], when: string) => events.map((e, i) => voidOf(`undo-${++n}-${i}`, when, e.id));

/** Che cosa vede l'utente: pasti con voci e consumi, quantità rimasta, energia del giorno. */
function snapshot(log: Log) {
  const state = deriveDiary(log, TZ);
  return {
    meals: mealsWithPantry(state, log).map((m) => ({
      mealId: m.mealId,
      date: m.date,
      kind: m.kind,
      at: m.at,
      items: m.items,
      consumes: m.pantryConsumes.map((c) => [c.lotId, c.quantity.value, c.at]),
    })),
    remaining: remaining(log),
    energy: energyOf(log),
  };
}

describe("currentMeal", () => {
  it("dà l'evento in vigore e i suoi consumi", () => {
    const cur = currentMeal("meal-1", base);
    expect(cur?.meal.id).toBe("m1");
    expect(cur?.consumes.map((c) => c.id)).toEqual(["c1"]);
  });

  it("niente per un pasto sconosciuto o annullato con i suoi consumi", () => {
    expect(currentMeal("meal-x", base)).toBeUndefined();
    expect(currentMeal("meal-1", [...base, voidOf("v", at("14:00"), "m1"), voidOf("vc", at("14:00"), "c1")])).toBeUndefined();
  });

  it("un consumo annullato non c'è; uno sostituito due volte vale una volta", () => {
    expect(currentMeal("meal-1", [...base, voidOf("v", at("14:00"), "c1")])?.consumes).toEqual([]);
    const a = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")));
    const b = done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:05"), "dev-b")));
    expect(currentMeal("meal-1", [...base, ...a, ...b])?.consumes.map((c) => c.quantity.value)).toEqual([100]);
  });

  it("un pasto fantasma (senza voci, consumi tutti annullati) non c'è, come in deriveDiary", () => {
    const ghost: Log = [
      lot,
      meal("mg", at("12:00"), { mealId: "meal-g", kind: "lunch" }),
      consume("cg", at("12:01"), { lotId: "lot-1", quantity: q(50), mealId: "meal-g" }),
      voidOf("vg", at("12:30"), "cg"),
    ];
    expect(currentMeal("meal-g", ghost)).toBeUndefined();
    expect(mealsOf(ghost)).toEqual([]);
    expect(errorOf(appendItems("meal-g", [pizza], ghost, ctx(at("13:00"))))).toBe("Questo pasto non c'è più.");
  });
});

describe("changeConsumeQuantity: una voce della dispensa", () => {
  it("1. quantità uguale a prima: nessun evento", () => {
    expect(changeConsumeQuantity(c1, { value: 150, estimated: false }, 400, ctx(at("14:00")))).toEqual({ ok: true, events: [] });
  });

  it("2. 150 g corretti a 80 g: un void e un consumo che lo sostituisce; in dispensa tornano 70 g", () => {
    expect(remaining(base)).toBe(250);
    const events = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"))));
    expect(events.map((e) => e.type)).toEqual(["void", "consume"]);
    expect(events[1]).toMatchObject({ replaces: "c1", lotId: "lot-1", mealId: "meal-1", at: c1.at, note: "quick", certainty: "measured" });
    const log = [...base, ...events];
    expect(remaining(log)).toBe(320);
    expect(mealOf(log)?.pantryConsumes.map((c) => c.quantity.value)).toEqual([80]);
    expect(energyOf(log)).toBe((energyOf(base) as number) - 70);
    // una quantità corretta non è una voce tolta dalla dispensa
    expect(mealOf(log)?.removedLines).toBeUndefined();
  });

  it("3. 80 g corretti a 400 g con 330 disponibili: errore, nessun evento", () => {
    const first = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"))));
    const eighty = first[1] as ConsumeEvent;
    const r = changeConsumeQuantity(eighty, { value: 400, estimated: false }, 330, ctx(at("14:10")));
    expect(r).toEqual({ ok: false, error: "Ne restavano 330 g." });
  });

  it("si può mangiare tutto ciò che c'era, non di più", () => {
    const all = done(changeConsumeQuantity(c1, { value: 400, estimated: false }, 400, ctx(at("14:00"))));
    expect(remaining([...base, ...all])).toBe(0);
    expect(errorOf(changeConsumeQuantity(c1, { value: 400.5, estimated: false }, 400, ctx(at("14:00"))))).toBe("Ne restavano 400 g.");
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, "80" as unknown as number])("un valore non valido (%s) non scrive niente", (value) => {
    expect(changeConsumeQuantity(c1, { value, estimated: false }, 400, ctx(at("14:00")))).toEqual({
      ok: false,
      error: "Scrivi una quantità, per esempio 80.",
    });
  });

  it("un disponibile illeggibile non scrive niente", () => {
    expect(changeConsumeQuantity(c1, { value: 80, estimated: false }, Number.NaN, ctx(at("14:00"))).ok).toBe(false);
  });

  it("la certezza può solo peggiorare: una misura diventa una stima, mai il contrario", () => {
    const est = done(changeConsumeQuantity(c1, { value: 80, estimated: true }, 400, ctx(at("14:00"))));
    expect(est[1].certainty).toBe("estimated");
    // stessa quantità, ma ora è una stima: è una correzione
    const same = done(changeConsumeQuantity(c1, { value: 150, estimated: true }, 400, ctx(at("14:00"))));
    expect(same.map((e) => e.type)).toEqual(["void", "consume"]);
    expect(remaining([...base, ...same])).toBe(250);

    for (const certainty of ["estimated", "label"] as const) {
      const rough = { ...c1, certainty };
      // una quantità riscritta non diventa una pesata
      const corrected = done(changeConsumeQuantity(rough, { value: 80, estimated: false }, 400, ctx(at("14:00"))));
      expect(corrected[1].certainty).toBe(certainty);
      // stesso valore e stessa certezza: niente da scrivere
      expect(changeConsumeQuantity(rough, { value: 150, estimated: false }, 400, ctx(at("14:00")))).toEqual({ ok: true, events: [] });
    }
    expect(done(changeConsumeQuantity({ ...c1, certainty: "label" }, { value: 80, estimated: true }, 400, ctx(at("14:00"))))[1].certainty).toBe("estimated");
    expect(changeConsumeQuantity({ ...c1, certainty: "estimated" }, { value: 150, estimated: true }, 400, ctx(at("14:00")))).toEqual({ ok: true, events: [] });
  });

  it("due correzioni di fila: conta solo l'ultima", () => {
    const first = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"))));
    const second = done(changeConsumeQuantity(first[1] as ConsumeEvent, { value: 120, estimated: false }, 400, ctx(at("14:10"))));
    const log = [...base, ...first, ...second];
    expect(remaining(log)).toBe(280);
    expect(mealOf(log)?.pantryConsumes.map((c) => c.quantity.value)).toEqual([120]);
  });

  it("14. «Annulla» riporta dispensa e diario com'erano", () => {
    const events = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"))));
    const log = [...base, ...events, ...undo(events, at("14:01"))];
    expect(snapshot(log)).toEqual(snapshot(base));
  });
});

describe("removeConsume: togliere una voce della dispensa", () => {
  it("toglie il consumo: la dispensa torna com'era e il pasto dice che una voce è stata tolta", () => {
    const events = done(removeConsume(c1, base, ctx(at("14:00"))));
    expect(events.map((e) => e.type)).toEqual(["void"]);
    const log = [...base, ...events];
    expect(remaining(log)).toBe(400);
    expect(mealOf(log)?.pantryConsumes).toEqual([]);
    expect(names(mealOf(log)?.items)).toEqual(["Pizza", "Mela"]);
    expect(mealOf(log)?.removedLines).toBe(1);
    expect(energyOf(log)).toBe((energyOf(base) as number) - 150);
  });

  it("dopo due correzioni toglie la voce com'è adesso, e conta come una voce sola", () => {
    const first = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"))));
    const second = done(changeConsumeQuantity(first[1] as ConsumeEvent, { value: 120, estimated: false }, 400, ctx(at("14:10"))));
    const log0 = [...base, ...first, ...second];
    const events = done(removeConsume(second[1], log0, ctx(at("14:20"))));
    expect(events.map((e) => e.type)).toEqual(["void"]);
    const log = [...log0, ...events];
    expect(remaining(log)).toBe(400);
    expect(mealOf(log)?.removedLines).toBe(1);
    // vale anche partendo da un consumo vecchio della stessa voce: la voce è una
    expect(done(removeConsume(c1, log0, ctx(at("14:20")))).map((e) => (e as { targetEventId: string }).targetEventId)).toEqual([second[1].id]);
  });

  it("l'unica voce di un pasto senza voci proprie: il pasto sparisce, e «Annulla» lo riporta", () => {
    const log0: Log = [lot, meal("mq", at("13:00"), { mealId: "meal-q", kind: "lunch" }), consume("cq", at("13:00"), { lotId: "lot-1", quantity: q(100), mealId: "meal-q" })];
    const events = done(removeConsume({ id: "cq" }, log0, ctx(at("14:00"))));
    const log = [...log0, ...events];
    expect(mealsOf(log)).toEqual([]);
    expect(remaining(log)).toBe(400);
    expect(snapshot([...log, ...undo(events, at("14:01"))])).toEqual(snapshot(log0));
  });

  it("una voce che non c'è più: errore, nessun evento", () => {
    const gone = [...base, voidOf("v", at("13:30"), "c1")];
    expect(removeConsume(c1, gone, ctx(at("14:00")))).toEqual({ ok: false, error: "Questa voce non c'è più." });
    expect(removeConsume({ id: "mai-visto" }, base, ctx(at("14:00")))).toEqual({ ok: false, error: "Questa voce non c'è più." });
    expect(removeConsume(c1, base, { deviceId: "dev-a", now: "adesso" }).ok).toBe(false);
  });
});

describe("changeItem: una voce libera", () => {
  it("4. «pizza 1 pz» corretta a «2 pz»: void del pasto e pasto nuovo con lo stesso mealId; i consumi restano legati", () => {
    const events = done(changeItem("meal-1", 0, { quantity: q(2, "pz") }, base, ctx(at("14:00"))));
    expect(events.map((e) => e.type)).toEqual(["void", "meal"]);
    const log = [...base, ...events];
    const m = mealOf(log);
    expect(mealsOf(log)).toHaveLength(1);
    expect(m?.items.map((i) => [i.name, i.quantity.value])).toEqual([["Pizza", 2], ["Mela", 1]]);
    expect(m?.pantryConsumes.map((c) => c.id)).toEqual(["c1"]);
    expect(m).toMatchObject({ title: "Pranzo veloce", kind: "lunch", at: lunch.at, certainty: "estimated", source: "manual" });
    expect(deriveDiary(log, TZ).anomalies).toEqual([]);
    expect(remaining(log)).toBe(250);
  });

  it("valore uguale a prima: nessun evento", () => {
    expect(changeItem("meal-1", 0, { quantity: q(1, "pz") }, base, ctx(at("14:00")))).toEqual({ ok: true, events: [] });
    expect(changeItem("meal-1", 0, { name: " Pizza " }, base, ctx(at("14:00")))).toEqual({ ok: true, events: [] });
    expect(changeItem("meal-1", 0, {}, base, ctx(at("14:00")))).toEqual({ ok: true, events: [] });
  });

  it("la quantità corretta tiene l'alimento scelto; un altro nome lo lascia", () => {
    const more = done(changeItem("meal-1", 1, { quantity: q(2, "pz") }, base, ctx(at("14:00"))));
    expect(mealOf([...base, ...more])?.items[1]).toEqual({ ...mela, quantity: q(2, "pz") });
    const renamed = done(changeItem("meal-1", 1, { name: "Pesca" }, base, ctx(at("14:00"))));
    expect(mealOf([...base, ...renamed])?.items[1]).toEqual({ name: "Pesca", quantity: q(1, "pz"), certainty: "estimated" });
  });

  it("errori: pasto che non c'è più, voce che non c'è più, valori non validi", () => {
    const c = ctx(at("14:00"));
    expect(errorOf(changeItem("meal-x", 0, { quantity: q(2, "pz") }, base, c))).toBe("Questo pasto non c'è più.");
    expect(errorOf(changeItem("meal-1", 0, { quantity: q(2, "pz") }, [...base, ...voidMeal("meal-1", base, { deviceId: "dev-a", now: () => at("13:30") })], c))).toBe("Questo pasto non c'è più.");
    for (const index of [2, -1, 0.5, Number.NaN]) {
      expect(errorOf(changeItem("meal-1", index, { quantity: q(2, "pz") }, base, c))).toBe("Questa voce non c'è più.");
    }
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(errorOf(changeItem("meal-1", 0, { quantity: q(value, "pz") }, base, c))).toBe("Scrivi una quantità, per esempio 80.");
    }
    expect(errorOf(changeItem("meal-1", 0, { quantity: { value: 2, unit: "kg" as never } }, base, c))).toBe("Scrivi una quantità, per esempio 80.");
    expect(errorOf(changeItem("meal-1", 0, { name: "   " }, base, c))).toBe("Scrivi come si chiama.");
  });

  it("14. «Annulla» riporta il pasto com'era", () => {
    const events = done(changeItem("meal-1", 0, { quantity: q(2, "pz") }, base, ctx(at("14:00"))));
    const log = [...base, ...events, ...undo(events, at("14:01"))];
    expect(snapshot(log)).toEqual(snapshot(base));
    expect(currentMeal("meal-1", log)?.meal.id).toBe("m1");
  });
});

describe("removeItem", () => {
  const onlyPizza = meal("m2", at("20:00"), { mealId: "meal-2", kind: "dinner", items: [pizza] });

  it("5. tolta l'unica voce libera di un pasto con un consumo: il pasto resta, con il consumo", () => {
    const withConsume: Log = [lot, onlyPizza, consume("c2", at("20:00"), { lotId: "lot-1", quantity: q(100), mealId: "meal-2" })];
    const events = done(removeItem("meal-2", 0, withConsume, ctx(at("20:30"))));
    expect(events.map((e) => e.type)).toEqual(["void", "meal"]);
    expect((events[1] as MealEvent).items).toEqual([]);
    const log = [...withConsume, ...events];
    const m = mealOf(log, "meal-2");
    expect(m?.items).toEqual([]);
    expect(m?.pantryConsumes.map((c) => c.id)).toEqual(["c2"]);
    expect(remaining(log)).toBe(300);
  });

  it("6. tolta l'unica voce di un pasto senza consumi: solo il void, e il pasto non compare più", () => {
    const alone: Log = [lot, onlyPizza];
    const events = done(removeItem("meal-2", 0, alone, ctx(at("20:30"))));
    expect(events.map((e) => e.type)).toEqual(["void"]);
    expect(mealsOf([...alone, ...events])).toEqual([]);
    expect(deriveDiary([...alone, ...events], TZ).days).toEqual([]);
  });

  it("un pasto il cui unico consumo era già stato annullato sparisce con l'ultima voce", () => {
    const log0: Log = [lot, onlyPizza, consume("c2", at("20:00"), { lotId: "lot-1", quantity: q(100), mealId: "meal-2" }), voidOf("v2", at("20:10"), "c2")];
    const events = done(removeItem("meal-2", 0, log0, ctx(at("20:30"))));
    expect(events.map((e) => e.type)).toEqual(["void"]);
    expect(mealsOf([...log0, ...events])).toEqual([]);
  });

  it("toglie la voce giusta e lascia le altre nello stesso ordine", () => {
    const events = done(removeItem("meal-1", 0, base, ctx(at("14:00"))));
    expect(mealOf([...base, ...events])?.items).toEqual([mela]);
  });

  it("errori: pasto o voce che non ci sono più", () => {
    expect(errorOf(removeItem("meal-x", 0, base, ctx(at("14:00"))))).toBe("Questo pasto non c'è più.");
    expect(errorOf(removeItem("meal-1", 2, base, ctx(at("14:00"))))).toBe("Questa voce non c'è più.");
  });

  it("«Annulla» fa ricomparire il pasto tolto", () => {
    const alone: Log = [lot, onlyPizza];
    const events = done(removeItem("meal-2", 0, alone, ctx(at("20:30"))));
    expect(snapshot([...alone, ...events, ...undo(events, at("20:31"))])).toEqual(snapshot(alone));
  });
});

describe("rewriteMeal: momento, giorno e ora di tutto il pasto", () => {
  it("7. da pranzo a cena, stesso giorno: compare a cena con voci e consumi, a pranzo non resta niente, conta una volta", () => {
    const events = done(rewriteMeal("meal-1", { kind: "dinner" }, base, ctx(at("14:00"))));
    expect(events.map((e) => e.type)).toEqual(["void", "meal"]);
    const log = [...base, ...events];
    const meals = getDay(deriveDiary(log, TZ), D)?.meals ?? [];
    expect(meals.map((m) => m.kind)).toEqual(["dinner"]);
    const m = mealOf(log);
    expect(names(m?.items)).toEqual(["Pizza", "Mela"]);
    expect(m?.pantryConsumes.map((c) => c.id)).toEqual(["c1"]);
    // se cambia solo il momento, l'ora non cambia
    expect(m?.at).toBe(lunch.at);
    expect(energyOf(log)).toBe(energyOf(base));
    expect(remaining(log)).toBe(250);
  });

  it("8. a ieri: il pasto compare ieri con i suoi consumi, che non cambiano istante", () => {
    const events = done(rewriteMeal("meal-1", { date: Y }, base, ctx(at("14:00"))));
    const log = [...base, ...events];
    const m = mealOf(log);
    expect(m?.date).toBe(Y);
    expect(m?.at).toBe(at("13:00", Y));
    expect(m?.pantryConsumes.map((c) => [c.id, c.at])).toEqual([["c1", c1.at]]);
    expect(events.every((e) => e.type !== "consume")).toBe(true);
    expect(getDay(deriveDiary(log, TZ), D)?.meals ?? []).toEqual([]);
    expect(energyOf(log, Y)).toBe(energyOf(base, D));
    expect(energyOf(log, D)).toBeUndefined();
    // la dispensa non torna indietro: il lotto è scalato da quando è stato mangiato davvero
    expect(remaining(log)).toBe(250);
    expect(derivePantry(log as never[], { asOf: at("12:00") }).lots[0].remaining).toBe(400);
  });

  it("9. con la sola ora: stesso giorno, stesso momento, ora nuova", () => {
    const events = done(rewriteMeal("meal-1", { minutes: 12 * 60 + 15 }, base, ctx(at("14:00"))));
    const m = mealOf([...base, ...events]);
    expect(m).toMatchObject({ date: D, kind: "lunch", at: at("12:15") });
  });

  it("momento, giorno e ora insieme", () => {
    const events = done(rewriteMeal("meal-1", { kind: "dinner", date: Y, minutes: 20 * 60 + 30 }, base, ctx(at("14:00"))));
    expect(mealOf([...base, ...events])).toMatchObject({ date: Y, kind: "dinner", at: at("20:30", Y) });
  });

  it("niente di diverso: nessun evento", () => {
    const c = ctx(at("14:00"));
    expect(rewriteMeal("meal-1", {}, base, c)).toEqual({ ok: true, events: [] });
    expect(rewriteMeal("meal-1", { kind: "lunch", date: D, minutes: 13 * 60 }, base, c)).toEqual({ ok: true, events: [] });
  });

  it("un'ora non valida o un giorno che deve ancora venire: errore, nessun evento", () => {
    const c = ctx(at("14:00"));
    for (const minutes of [-1, 1440, 12.5, Number.NaN]) {
      expect(rewriteMeal("meal-1", { minutes }, base, c)).toEqual({ ok: false, error: "Scegli un'ora valida." });
    }
    expect(rewriteMeal("meal-1", { date: "2026-03-11" }, base, c)).toEqual({
      ok: false,
      error: "Non posso mettere un pasto in un giorno che deve ancora venire.",
    });
    expect(errorOf(rewriteMeal("meal-1", { date: "2026-02-30" }, base, c))).toBe("Scegli un giorno valido.");
    expect(errorOf(rewriteMeal("meal-x", { kind: "dinner" }, base, c))).toBe("Questo pasto non c'è più.");
    expect(rewriteMeal("meal-1", { kind: "brunch" as MealKind }, base, c).ok).toBe(false);
  });

  it("il giorno e l'ora sono quelli del fuso del diario, anche a cavallo del cambio dell'ora", () => {
    // 30 marzo 2026, 13:00 a Roma (ora legale, +2)
    const rome = meal("mr", "2026-03-30T11:00:00.000Z", { mealId: "meal-r", kind: "lunch", items: [pizza] });
    const c = { deviceId: "dev-a", now: "2026-03-30T12:00:00.000Z", idGenerator: () => `r-${++n}` };
    // spostato al 28 marzo (ora solare, +1): restano le 13:00 di Roma
    const moved = done(rewriteMeal("meal-r", { date: "2026-03-28" }, [rome], c));
    expect((moved[1] as MealEvent).at).toBe("2026-03-28T12:00:00.000Z");
    expect(deriveDiary([rome, ...moved]).days.map((d) => d.date)).toEqual(["2026-03-28"]);
    // le 00:30 del 31 a Roma sono ancora il 30 in UTC: per Roma il 31 è domani
    const late = done(rewriteMeal("meal-r", { minutes: 30 }, [rome], c));
    expect((late[1] as MealEvent).at).toBe("2026-03-29T22:30:00.000Z");
    expect(errorOf(rewriteMeal("meal-r", { date: "2026-03-31" }, [rome], c))).toMatch(/deve ancora venire/);
  });

  it("14. «Annulla» riporta il pasto dov'era", () => {
    const events = done(rewriteMeal("meal-1", { kind: "dinner", date: Y }, base, ctx(at("14:00"))));
    const log = [...base, ...events, ...undo(events, at("14:01"))];
    expect(snapshot(log)).toEqual(snapshot(base));
    expect(energyOf(log, Y)).toBeUndefined();
  });
});

describe("moveItem: una voce libera in un altro momento", () => {
  const dinner = meal("md", at("20:00"), { mealId: "meal-d", kind: "dinner", title: "Zuppa", items: [{ name: "Zuppa", quantity: q(300), certainty: "measured" }] });

  it("10. verso un momento che ha già un pasto: la voce entra in quello", () => {
    const log0: Log = [...base, dinner];
    const events = done(moveItem("meal-1", 0, { kind: "dinner" }, log0, deriveDiary(log0, TZ), ctx(at("21:00"))));
    expect(events.map((e) => e.type)).toEqual(["void", "void", "meal", "meal"]);
    const log = [...log0, ...events];
    expect(names(mealOf(log)?.items)).toEqual(["Mela"]);
    const d = mealOf(log, "meal-d");
    expect(names(d?.items)).toEqual(["Zuppa", "Pizza"]);
    expect(d).toMatchObject({ title: "Zuppa", at: dinner.at, certainty: "estimated" });
    expect(mealsOf(log)).toHaveLength(2);
    expect(deriveDiary(log, TZ).anomalies).toEqual([]);
    expect(energyOf(log)).toBe(energyOf(log0));
  });

  it("10. verso un momento vuoto dello stesso giorno: nasce un pasto all'ora di quello di partenza", () => {
    const events = done(moveItem("meal-1", 1, { kind: "snack" }, base, deriveDiary(base, TZ), ctx(at("14:00"))));
    expect(events.map((e) => e.type)).toEqual(["void", "meal", "meal"]);
    const log = [...base, ...events];
    const snack = mealsOf(log).find((m) => m.kind === "snack");
    expect(snack?.items).toEqual([mela]);
    expect(snack?.at).toBe(lunch.at);
    expect(snack?.mealId).not.toBe("meal-1");
    expect(names(mealOf(log)?.items)).toEqual(["Pizza"]);
    expect(mealOf(log)?.pantryConsumes).toHaveLength(1);
    expect(energyOf(log)).toBe(energyOf(base));
  });

  it.each(["breakfast", "lunch", "dinner", "snack"] as const)(
    "10. verso un momento vuoto di un altro giorno (%s): l'ora tipica, la stessa di placeConsumes",
    (kind) => {
      const events = done(moveItem("meal-1", 0, { kind, date: Y }, base, deriveDiary(base, TZ), ctx(at("14:00"))));
      const created = events[events.length - 1] as MealEvent;
      expect(created).toMatchObject({ type: "meal", kind, items: [pizza] });
      const placed = placeConsumes([consume("cx", at("14:00"), { lotId: "lot-1", quantity: q(10) })], deriveDiary(base, TZ), ctx(at("14:00")), { kind, date: Y });
      if (!placed.ok) throw new Error("atteso ok");
      expect(created.at).toBe(placed.events[0].at);
      expect(mealsOf([...base, ...events]).find((m) => m.mealId === created.mealId)?.date).toBe(Y);
    },
  );

  it("l'ultima voce di un pasto senza consumi: il pasto di partenza sparisce", () => {
    const log0: Log = [lot, meal("m2", at("13:00"), { mealId: "meal-2", kind: "lunch", items: [pizza] }), dinner];
    const events = done(moveItem("meal-2", 0, { kind: "dinner" }, log0, deriveDiary(log0, TZ), ctx(at("21:00"))));
    expect(events.map((e) => e.type)).toEqual(["void", "void", "meal"]);
    const log = [...log0, ...events];
    expect(mealsOf(log).map((m) => m.mealId)).toEqual(["meal-d"]);
    expect(names(mealOf(log, "meal-d")?.items)).toEqual(["Zuppa", "Pizza"]);
  });

  it("l'ultima voce libera di un pasto che ha un consumo: il pasto resta con il consumo", () => {
    const log0: Log = [lot, meal("m2", at("13:00"), { mealId: "meal-2", kind: "lunch", items: [pizza] }), consume("c2", at("13:00"), { lotId: "lot-1", quantity: q(100), mealId: "meal-2" })];
    const events = done(moveItem("meal-2", 0, { kind: "dinner" }, log0, deriveDiary(log0, TZ), ctx(at("21:00"))));
    const log = [...log0, ...events];
    expect(mealOf(log, "meal-2")?.pantryConsumes).toHaveLength(1);
    expect(mealOf(log, "meal-2")?.items).toEqual([]);
    expect(mealsOf(log).find((m) => m.kind === "dinner")?.items).toEqual([pizza]);
  });

  it("è già in quel momento: nessun evento", () => {
    expect(moveItem("meal-1", 0, { kind: "lunch" }, base, deriveDiary(base, TZ), ctx(at("14:00")))).toEqual({ ok: true, events: [] });
    expect(moveItem("meal-1", 0, { kind: "lunch", date: D }, base, deriveDiary(base, TZ), ctx(at("14:00")))).toEqual({ ok: true, events: [] });
  });

  it("un diario più vecchio del registro: il pasto di arrivo annullato nel frattempo non riceve niente", () => {
    const log0: Log = [...base, dinner];
    const stale = deriveDiary(log0, TZ);
    const log1: Log = [...log0, voidOf("vd", at("20:30"), "md")];
    const events = done(moveItem("meal-1", 0, { kind: "dinner" }, log1, stale, ctx(at("21:00"))));
    const log = [...log1, ...events];
    const dinners = mealsOf(log).filter((m) => m.kind === "dinner");
    expect(dinners).toHaveLength(1);
    expect(dinners[0].mealId).not.toBe("meal-d");
    expect(dinners[0].items).toEqual([pizza]);
  });

  it("errori: pasto o voce che non ci sono più, giorno non valido o futuro", () => {
    const state = deriveDiary(base, TZ);
    const c = ctx(at("14:00"));
    expect(errorOf(moveItem("meal-x", 0, { kind: "dinner" }, base, state, c))).toBe("Questo pasto non c'è più.");
    expect(errorOf(moveItem("meal-1", 5, { kind: "dinner" }, base, state, c))).toBe("Questa voce non c'è più.");
    expect(errorOf(moveItem("meal-1", 0, { kind: "dinner", date: "domani" }, base, state, c))).toBe("Scegli un giorno valido.");
    expect(errorOf(moveItem("meal-1", 0, { kind: "dinner", date: "2026-03-11" }, base, state, c))).toMatch(/deve ancora venire/);
  });

  it("«Annulla» riporta la voce nel pasto di partenza", () => {
    const log0: Log = [...base, dinner];
    const events = done(moveItem("meal-1", 0, { kind: "dinner" }, log0, deriveDiary(log0, TZ), ctx(at("21:00"))));
    expect(snapshot([...log0, ...events, ...undo(events, at("21:01"))])).toEqual(snapshot(log0));
    const fresh = done(moveItem("meal-1", 0, { kind: "snack" }, base, deriveDiary(base, TZ), ctx(at("14:00"))));
    expect(snapshot([...base, ...fresh, ...undo(fresh, at("14:01"))])).toEqual(snapshot(base));
  });
});

describe("appendItems", () => {
  const pane: MealItem = { name: "Pane", quantity: q(50), certainty: "estimated" };
  const insalata: MealItem = { name: "Insalata", quantity: q(80), certainty: "estimated" };

  it("11. due volte di fila: la seconda parte dal pasto riscritto dalla prima", () => {
    const first = done(appendItems("meal-1", [pane], base, ctx(at("14:00"))));
    const log1 = [...base, ...first];
    const second = done(appendItems("meal-1", [insalata], log1, ctx(at("14:05"))));
    const log = [...log1, ...second];
    expect(names(mealOf(log)?.items)).toEqual(["Pizza", "Mela", "Pane", "Insalata"]);
    expect(mealsOf(log)).toHaveLength(1);
    expect(mealOf(log)?.pantryConsumes).toHaveLength(1);
    expect(deriveDiary(log, TZ).anomalies).toEqual([]);
    expect((second[0] as { targetEventId: string }).targetEventId).toBe(first[1].id);
  });

  it("niente da aggiungere: nessun evento; il pasto che non c'è più è un errore", () => {
    expect(appendItems("meal-1", [], base, ctx(at("14:00")))).toEqual({ ok: true, events: [] });
    expect(errorOf(appendItems("meal-x", [pane], base, ctx(at("14:00"))))).toBe("Questo pasto non c'è più.");
  });

  it("una voce stimata rende stimato un pasto misurato, mai il contrario", () => {
    const sure: Log = [meal("ms", at("13:00"), { mealId: "meal-s", kind: "lunch", items: [{ name: "Riso", quantity: q(80), certainty: "measured" }] })];
    const est = done(appendItems("meal-s", [pane], sure, ctx(at("14:00"))));
    expect(est[1].certainty).toBe("estimated");
    const kept = done(appendItems("meal-1", [{ name: "Riso", quantity: q(80), certainty: "measured" }], base, ctx(at("14:00"))));
    expect(kept[1].certainty).toBe("estimated");
  });

  it("una voce non valida non scrive niente", () => {
    const bad = [{ name: "", quantity: q(50), certainty: "estimated" }, { name: "Pane", quantity: q(0), certainty: "estimated" }, { name: "Pane", quantity: q(50) }, null];
    for (const item of bad) {
      expect(appendItems("meal-1", [pane, item as MealItem], base, ctx(at("14:00"))).ok).toBe(false);
    }
  });

  it("le voci passate non restano legate a quelle scritte", () => {
    const mine = { ...pane, quantity: { ...pane.quantity } };
    const events = done(appendItems("meal-1", [mine], base, ctx(at("14:00"))));
    mine.quantity.value = 999;
    expect((events[1] as MealEvent).items?.[2].quantity.value).toBe(50);
  });
});

describe("gli eventi di ogni azione", () => {
  const dinner = meal("md", at("20:00"), { mealId: "meal-d", kind: "dinner", items: [{ name: "Zuppa", quantity: q(300), certainty: "measured" }] });
  const log0: Log = [...base, dinner];
  const now = at("21:00");
  const actions: [string, () => MealEdit][] = [
    ["changeConsumeQuantity", () => changeConsumeQuantity(c1, { value: 80, estimated: true }, 400, ctx(now, "dev-z"))],
    ["changeItem", () => changeItem("meal-1", 0, { quantity: q(2, "pz"), name: "Pizza margherita" }, log0, ctx(now, "dev-z"))],
    ["removeItem", () => removeItem("meal-1", 0, log0, ctx(now, "dev-z"))],
    ["removeItem, ultima voce", () => removeItem("meal-d", 0, log0, ctx(now, "dev-z"))],
    ["moveItem, pasto esistente", () => moveItem("meal-1", 0, { kind: "dinner" }, log0, deriveDiary(log0, TZ), ctx(now, "dev-z"))],
    ["moveItem, pasto nuovo", () => moveItem("meal-1", 0, { kind: "snack", date: Y }, log0, deriveDiary(log0, TZ), ctx(now, "dev-z"))],
    ["rewriteMeal", () => rewriteMeal("meal-1", { kind: "dinner", date: Y, minutes: 19 * 60 }, log0, ctx(now, "dev-z"))],
    ["appendItems", () => appendItems("meal-1", [{ name: "Pane", quantity: q(50), certainty: "estimated" }], log0, ctx(now, "dev-z"))],
  ];

  it.each(actions)("%s: stesso recordedAt e stesso deviceId, prima gli annullamenti, tutti validi, id distinti", (_name, run) => {
    const events = done(run());
    expect(events.length).toBeGreaterThan(0);
    expect(new Set(events.map((e) => e.recordedAt))).toEqual(new Set([now]));
    expect(new Set(events.map((e) => e.deviceId))).toEqual(new Set(["dev-z"]));
    const firstNew = events.findIndex((e) => e.type !== "void");
    expect(events.slice(firstNew === -1 ? events.length : firstNew).every((e) => e.type !== "void")).toBe(true);
    for (const e of events) {
      expect(e.type === "consume" ? validateEvent(e) : validateDiaryEvent(e)).toEqual([]);
    }
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    const known = new Set(log0.map((e) => (e as { id: string }).id));
    expect(events.every((e) => !known.has(e.id))).toBe(true);
  });

  it.each(actions)("%s: solo void, meal e consumi che sostituiscono un consumo esistente", (_name, run) => {
    const events = done(run());
    for (const e of events) {
      expect(["void", "meal", "consume"]).toContain(e.type);
      if (e.type === "consume") expect(e.replaces).toBe("c1");
    }
  });

  it.each(actions)("%s: il registro di partenza non viene toccato", (_name, run) => {
    const before = JSON.stringify(log0);
    run();
    expect(JSON.stringify(log0)).toBe(before);
  });

  it("un istante non valido non scrive niente", () => {
    const bad = { deviceId: "dev-a", now: "adesso", timeZone: "UTC" };
    expect(changeItem("meal-1", 0, { quantity: q(2, "pz") }, base, bad).ok).toBe(false);
    expect(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, bad).ok).toBe(false);
    expect(rewriteMeal("meal-1", { kind: "dinner" }, base, bad).ok).toBe(false);
    expect(appendItems("meal-1", [pizza], base, bad).ok).toBe(false);
    expect(removeItem("meal-1", 0, base, bad).ok).toBe(false);
  });
});

describe("due telefoni", () => {
  const orders = (a: Log, b: Log): Log[] => {
    const random = seededRandom(7);
    const union = [...a, ...b];
    return [
      mergeEvents(a as EventLike[], b as EventLike[]).events,
      mergeEvents(b as EventLike[], a as EventLike[]).events,
      mergeAllEvents(a as AnyEvent[], b as AnyEvent[]).events,
      union,
      [...union].reverse(),
      ...Array.from({ length: 12 }, () => shuffled(union, random)),
    ];
  };

  it("12. lo stesso pasto corretto su due telefoni: dopo l'unione ne compare uno solo, lo stesso ovunque, e i consumi contano una volta", () => {
    const a = [...base, ...done(rewriteMeal("meal-1", { minutes: 12 * 60 }, base, ctx(at("14:00"), "dev-a")))];
    const b = [...base, ...done(removeItem("meal-1", 0, base, ctx(at("14:05"), "dev-b")))];
    const merged = mergeEvents(a as EventLike[], b as EventLike[]).events as unknown as { id: string; type: string; targetEventId?: string; mealId?: string }[];
    expect(merged.filter((e) => e.type === "void" && e.targetEventId === "m1")).toHaveLength(2);
    expect(merged.filter((e) => e.type === "meal" && e.mealId === "meal-1" && e.id !== "m1")).toHaveLength(2);

    const views = orders(a, b).map((log) => {
      const state = deriveDiary(log, TZ);
      expect(state.anomalies.map((x) => x.code)).toEqual(["duplicate_meal"]);
      expect(state.anomalies[0].mealId).toBe("meal-1");
      return snapshot(log);
    });
    for (const v of views) expect(v).toEqual(views[0]);
    expect(views[0].meals).toHaveLength(1);
    expect(views[0].meals[0].consumes).toEqual([["lot-1", 150, c1.at]]);
    expect(views[0].remaining).toBe(250);
    // le due correzioni non si toccano e valgono tutte e due: l'ora di A, la voce tolta da B
    expect(views[0].meals[0].at).toBe(at("12:00"));
    expect(names(views[0].meals[0].items)).toEqual(["Mela"]);
    expect(mealOf(merged)?.otherVersions).toBeUndefined();
    const cur = currentMeal("meal-1", merged);
    expect([cur?.meal.at, names(cur?.meal.items)]).toEqual([at("12:00"), ["Mela"]]);
  });

  it("12. una correzione fatta dopo l'unione parte dal pasto mostrato e non lascia doppioni", () => {
    const a = [...base, ...done(appendItems("meal-1", [{ name: "Pane", quantity: q(50), certainty: "estimated" }], base, ctx(at("14:00"), "dev-a")))];
    const b = [...base, ...done(removeItem("meal-1", 0, base, ctx(at("14:05"), "dev-b")))];
    const merged = mergeEvents(a as EventLike[], b as EventLike[]).events as Log;
    const shown = mealOf(merged);
    expect(deriveDiary(merged, TZ).anomalies.map((x) => x.code)).toEqual(["duplicate_meal"]);

    const events = done(changeItem("meal-1", 0, { quantity: q(3, "pz") }, merged, ctx(at("15:00"), "dev-a")));
    expect(events.map((e) => e.type)).toEqual(["void", "void", "meal"]);
    for (const log of orders(merged, events)) {
      const state = deriveDiary(log, TZ);
      expect(state.anomalies).toEqual([]);
      const m = mealOf(log);
      expect(mealsOf(log)).toHaveLength(1);
      expect(m?.items).toEqual([{ ...(shown?.items[0] as MealItem), quantity: q(3, "pz") }, ...(shown?.items.slice(1) ?? [])]);
      expect(m?.pantryConsumes).toHaveLength(1);
    }
    // e «Annulla» riporta ai due pasti di prima, di cui se ne mostra uno
    expect(snapshot([...merged, ...events, ...undo(events, at("15:01"))])).toEqual(snapshot(merged));
  });

  // Due correzioni che non si uniscono: ognuno cambia la quantità di una voce diversa. Vale quella di B, più recente.
  const conflict = (start: Log): Log => {
    const a = [...start, ...done(changeItem("meal-1", 0, { quantity: q(2, "pz") }, start, ctx(at("14:00"), "dev-a")))];
    const b = [...start, ...done(changeItem("meal-1", 1, { quantity: q(3, "pz") }, start, ctx(at("14:05"), "dev-b")))];
    return mergeEvents(a as EventLike[], b as EventLike[]).events as Log;
  };
  const amounts = (items: readonly MealItem[] | undefined) => (items ?? []).map((i) => i.quantity.value);

  it("14. «Tieni questa» e «Usa l'altra»: il doppione si chiude, resta un pasto solo, e «Annulla» riporta le due versioni", () => {
    const merged = conflict(base);
    const shown = mealOf(merged);
    const other = shown?.otherVersions?.[0];
    if (!shown || !other) throw new Error("atteso un pasto con un'altra versione");
    expect([amounts(shown.items), amounts(other.items)]).toEqual([[1, 3], [2, 1]]);

    for (const [chosen, expected] of [[shown, [1, 3]], [other, [2, 1]]] as const) {
      const events = done(keepMealVersion("meal-1", { at: chosen.at, kind: chosen.kind, items: chosen.items }, merged, ctx(at("15:00"))));
      expect(events.map((e) => e.type)).toEqual(["void", "void", "meal"]);
      for (const log of orders(merged, events)) {
        expect(deriveDiary(log, TZ).anomalies).toEqual([]);
        expect(mealsOf(log)).toHaveLength(1);
        const m = mealOf(log);
        expect([amounts(m?.items), m?.otherVersions, m?.title, m?.pantryConsumes.length]).toEqual([expected, undefined, "Pranzo veloce", 1]);
      }
      expect(snapshot([...merged, ...events, ...undo(events, at("15:01"))])).toEqual(snapshot(merged));
      expect(mealOf([...merged, ...events, ...undo(events, at("15:01"))])?.otherVersions).toHaveLength(1);
    }
    // con una sola versione, già quella scelta, non c'è niente da scrivere
    expect(done(keepMealVersion("meal-1", { at: lunch.at, kind: "lunch", items: [pizza, mela] }, base, ctx(at("15:00"))))).toEqual([]);
    expect(errorOf(keepMealVersion("meal-9", { at: lunch.at, kind: "lunch", items: [] }, base, ctx(at("15:00"))))).toBeDefined();
  });

  it("14. scelte opposte su due telefoni prima dell'unione: resta sempre un pasto, con il contenuto della scelta più recente", () => {
    // con un consumo della dispensa e senza: senza, annullando soltanto il pasto sparirebbe; con, resterebbe senza voci libere
    for (const start of [base, [lunch] as Log]) {
      const merged = conflict(start);
      const shown = mealOf(merged);
      const other = shown?.otherVersions?.[0];
      if (!shown || !other) throw new Error("atteso un pasto con un'altra versione");
      const keep = (v: { at: string; kind: MealKind; items: readonly MealItem[] }, when: string, device: string) =>
        done(keepMealVersion("meal-1", { at: v.at, kind: v.kind, items: v.items }, merged, ctx(at(when), device)));

      for (const [first, second, expected] of [[shown, other, [2, 1]], [other, shown, [1, 3]]] as const) {
        const a = [...merged, ...keep(first, "15:00", "dev-a")];
        const b = [...merged, ...keep(second, "15:05", "dev-b")];
        const views = orders(a, b).map((log) => {
          expect(mealsOf(log)).toHaveLength(1);
          const m = mealOf(log);
          expect(m?.revived).toBeUndefined();
          expect(amounts(m?.items)).toEqual(expected);
          expect(m?.pantryConsumes.length).toBe(start === base ? 1 : 0);
          // la scelta dell'altro telefono non si perde: resta da mostrare
          expect(m?.otherVersions?.map((v) => amounts(v.items))).toEqual([expected[0] === 2 ? [1, 3] : [2, 1]]);
          return snapshot(log);
        });
        for (const v of views) expect(v).toEqual(views[0]);
      }
    }
  });

  it("14. la stessa scelta su due telefoni: dopo l'unione il pasto è uno, senza un'altra versione da mostrare", () => {
    const merged = conflict(base);
    const shown = mealOf(merged);
    const other = shown?.otherVersions?.[0];
    if (!shown || !other) throw new Error("atteso un pasto con un'altra versione");
    for (const [chosen, expected] of [[shown, [1, 3]], [other, [2, 1]]] as const) {
      const pick = (when: string, device: string) =>
        done(keepMealVersion("meal-1", { at: chosen.at, kind: chosen.kind, items: chosen.items }, merged, ctx(at(when), device)));
      for (const log of orders([...merged, ...pick("15:00", "dev-a")], [...merged, ...pick("15:05", "dev-b")])) {
        expect(mealsOf(log)).toHaveLength(1);
        expect([amounts(mealOf(log)?.items), mealOf(log)?.otherVersions]).toEqual([expected, undefined]);
      }
    }
  });

  it("13. lo stesso consumo corretto su due telefoni: vale un solo sostituto, la quantità non raddoppia", () => {
    const a = [...base, ...done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")))];
    const b = [...base, ...done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:05"), "dev-b")))];
    const views = orders(a, b).map((log) => {
      expect(derivePantry(log as never[]).anomalies).toEqual([]);
      return snapshot(log);
    });
    for (const v of views) expect(v).toEqual(views[0]);
    // vale il sostituto registrato per ultimo: 100 g, non 180
    expect(views[0].meals[0].consumes).toEqual([["lot-1", 100, c1.at]]);
    expect(views[0].remaining).toBe(300);
    expect(views[0].energy).toBe((energyOf(base) as number) - 50);
  });

  it("13. un telefono corregge la quantità, l'altro sposta il consumo a cena: vale una sola delle due, mai tutte e due", () => {
    const a = [...base, ...done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")))];
    const moved = moveConsumes([c1], deriveDiary(base, TZ), { ...ctx(at("14:05"), "dev-b"), timeZone: "UTC" }, { kind: "dinner" });
    if (!moved.ok) throw new Error("atteso ok");
    const b = [...base, ...moved.events];
    const views = orders(a, b).map(snapshot);
    for (const v of views) expect(v).toEqual(views[0]);
    expect(views[0].remaining).toBe(250);
    expect(views[0].meals.flatMap((m) => m.consumes)).toEqual([["lot-1", 150, c1.at]]);
  });

  it("13. un telefono corregge due volte, l'altro una: dopo l'unione vale comunque un solo consumo", () => {
    const a1 = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")));
    const a2 = done(changeConsumeQuantity(a1[1] as ConsumeEvent, { value: 120, estimated: false }, 400, ctx(at("14:02"), "dev-a")));
    const a = [...base, ...a1, ...a2];
    const b = [...base, ...done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:01"), "dev-b")))];
    const views = orders(a, b).map(snapshot);
    for (const v of views) expect(v).toEqual(views[0]);
    // vale l'ultima correzione registrata: 120 g, non 120 + 100
    expect(views[0].meals[0].consumes).toEqual([["lot-1", 120, c1.at]]);
    expect(views[0].remaining).toBe(280);
  });

  it("13. corretto di nuovo dopo l'unione: il sostituto scartato dell'altro telefono non torna a contare", () => {
    const fromA = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")));
    const fromB = done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:05"), "dev-b")));
    const merged: Log = [...base, ...fromA, ...fromB];
    const shown = currentMeal("meal-1", merged)?.consumes ?? [];
    expect(shown.map((c) => c.quantity.value)).toEqual([100]);
    const again = done(changeConsumeQuantity(shown[0], { value: 60, estimated: false }, 400, ctx(at("15:00"), "dev-a")));
    for (const log of orders(merged, again)) {
      expect(mealOf(log)?.pantryConsumes.map((c) => c.quantity.value)).toEqual([60]);
      expect(remaining(log)).toBe(340);
    }
    // «Annulla» di quest'ultima riporta ai 100 g che si vedevano
    const back = [...merged, ...again, ...undo(again, at("15:01"))];
    expect(mealOf(back)?.pantryConsumes.map((c) => c.quantity.value)).toEqual([100]);
    expect(remaining(back)).toBe(300);
  });

  it("13. due spostamenti su un telefono e una correzione sull'altro: un solo consumo, 150 g scalati una volta", () => {
    const tz = (now: string, device: string) => ({ ...ctx(now, device), timeZone: "UTC" });
    const m1 = moveConsumes([c1], deriveDiary(base, TZ), tz(at("14:00"), "dev-a"), { kind: "dinner" });
    if (!m1.ok) throw new Error("atteso ok");
    const a1 = [...base, ...m1.events];
    const m2 = moveConsumes(m1.consumes, deriveDiary(a1, TZ), tz(at("14:02"), "dev-a"), { kind: "snack" });
    if (!m2.ok) throw new Error("atteso ok");
    const a = [...a1, ...m2.events];
    const b = [...base, ...done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:01"), "dev-b")))];
    const views = orders(a, b).map((log) => {
      expect(activeConsumes(log)).toHaveLength(1);
      expect(derivePantry(log as never[]).anomalies).toEqual([]);
      return snapshot(log);
    });
    for (const v of views) expect(v).toEqual(views[0]);
    // vale l'ultimo scritto: lo spostamento allo spuntino, con i 150 g di partenza
    expect(views[0].remaining).toBe(250);
    expect(views[0].meals.flatMap((m) => m.consumes)).toEqual([["lot-1", 150, c1.at]]);
    expect(views[0].meals.find((m) => m.consumes.length > 0)?.kind).toBe("snack");
    expect(views[0].energy).toBe(energyOf(base));
    // nessun pasto dice di aver perso una voce: è stata spostata, non tolta
    const merged = [...a, ...b];
    expect(mealsOf(merged).map((m) => m.removedLines)).toEqual(mealsOf(merged).map(() => undefined));
  });

  it("13. «Togli» dopo un conflitto unito: la voce non torna con il consumo dell'altro telefono", () => {
    const fromA = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")));
    const fromB = done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:05"), "dev-b")));
    const merged: Log = [...base, ...fromA, ...fromB];
    const shown = currentMeal("meal-1", merged)?.consumes ?? [];
    expect(shown.map((c) => c.quantity.value)).toEqual([100]);
    // annullare solo il consumo mostrato farebbe tornare gli 80 g dell'altro telefono
    expect(remaining([...merged, voidOf("solo", at("15:00"), shown[0].id)])).toBe(320);

    expect(familyConsumes(merged, shown).map((c) => c.quantity.value).sort((x, y) => x - y)).toEqual([80, 100]);
    const events = done(removeConsume(shown[0], merged, ctx(at("15:00"), "dev-a")));
    expect(events.map((e) => e.type)).toEqual(["void", "void"]);
    for (const log of orders(merged, events)) {
      expect(remaining(log)).toBe(400);
      expect(activeConsumes(log)).toEqual([]);
      expect(mealOf(log)?.pantryConsumes).toEqual([]);
      // una voce tolta, non due né tre
      expect(mealOf(log)?.removedLines).toBe(1);
      expect(energyOf(log)).toBe((energyOf(base) as number) - 150);
    }
    // «Annulla» riporta la voce che si vedeva: 100 g
    const back = [...merged, ...events, ...undo(events, at("15:01"))];
    expect(mealOf(back)?.pantryConsumes.map((c) => c.quantity.value)).toEqual([100]);
    expect(remaining(back)).toBe(300);
    expect(mealOf(back)?.removedLines).toBeUndefined();
  });

  it("13. un conflitto unito non è una voce tolta", () => {
    const fromA = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")));
    const fromB = done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:05"), "dev-b")));
    for (const log of orders([...base, ...fromA], [...base, ...fromB])) expect(mealOf(log)?.removedLines).toBeUndefined();
  });

  it("13. «Annulla» su un telefono dopo l'unione lascia in vigore la correzione dell'altro", () => {
    const fromA = done(changeConsumeQuantity(c1, { value: 80, estimated: false }, 400, ctx(at("14:00"), "dev-a")));
    const fromB = done(changeConsumeQuantity(c1, { value: 100, estimated: false }, 400, ctx(at("14:05"), "dev-b")));
    const log = [...base, ...fromA, ...fromB, ...undo(fromB, at("14:10"))];
    expect(remaining(log)).toBe(320);
    expect(mealOf(log)?.pantryConsumes.map((c) => c.quantity.value)).toEqual([80]);
  });

  it("correzioni a caso su due telefoni, unite in ordine casuale: stesso risultato ovunque, niente contato due volte", () => {
    const dinner = meal("md", at("20:00"), { mealId: "meal-d", kind: "dinner", items: [{ name: "Zuppa", quantity: q(300), certainty: "measured" }] });
    const c2 = consume("c2", at("20:00"), { lotId: "lot-1", quantity: q(50), mealId: "meal-d" });
    const start: Log = [...base, dinner, c2];

    function randomEdit(log: Log, random: () => number, c: EditContext): MealEdit {
      const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
      const mealId = pick(["meal-1", "meal-d"]);
      const cur = currentMeal(mealId, log);
      if (!cur) return { ok: true, events: [] };
      const count = cur.meal.items?.length ?? 0;
      const index = Math.floor(random() * Math.max(count, 1));
      const eaten = activeConsumes(log);
      switch (Math.floor(random() * 8)) {
        case 6: {
          if (eaten.length === 0) return { ok: true, events: [] };
          const moved = moveConsumes([pick(eaten)], deriveDiary(log, TZ), c, { kind: pick(["breakfast", "lunch", "dinner", "snack"] as const) });
          return moved.ok ? { ok: true, events: moved.events } : { ok: true, events: [] };
        }
        case 7:
          return eaten.length === 0 || random() < 0.5 ? { ok: true, events: [] } : removeConsume(pick(eaten), log, c);
        case 0: {
          if (eaten.length === 0) return { ok: true, events: [] };
          const target = pick(eaten);
          const left = remaining(log) as number;
          return changeConsumeQuantity(target, { value: 10 + Math.floor(random() * 100), estimated: random() < 0.5 }, left + target.quantity.value, c);
        }
        case 1:
          return count === 0 ? { ok: true, events: [] } : changeItem(mealId, index, { quantity: q(1 + Math.floor(random() * 5), "pz") }, log, c);
        case 2:
          return count === 0 ? { ok: true, events: [] } : removeItem(mealId, index, log, c);
        case 3:
          return count === 0
            ? { ok: true, events: [] }
            : moveItem(mealId, index, { kind: pick(["breakfast", "lunch", "dinner", "snack"] as const), date: pick([D, Y]) }, log, deriveDiary(log, TZ), c);
        case 4:
          return rewriteMeal(mealId, { kind: pick(["lunch", "dinner", "snack"] as const), date: pick([D, Y]), minutes: Math.floor(random() * 1440) }, log, c);
        default:
          return appendItems(mealId, [{ name: pick(["Pane", "Insalata", "Mela"]), quantity: q(1 + Math.floor(random() * 3), "pz"), certainty: "estimated" }], log, c);
      }
    }

    for (let seed = 1; seed <= 40; seed++) {
      const random = seededRandom(seed);
      const logs: Record<string, Log> = { "dev-a": [...start], "dev-b": [...start] };
      let minute = 0;
      for (let step = 0; step < 8; step++) {
        const device = random() < 0.5 ? "dev-a" : "dev-b";
        const now = `2026-03-10T21:${String(minute++).padStart(2, "0")}:00.000Z`;
        const edit = randomEdit(logs[device], random, ctx(now, device));
        if (edit.ok) logs[device].push(...edit.events);
        // ogni tanto i due telefoni si uniscono a metà strada
        if (random() < 0.2) {
          const merged = mergeEvents(logs["dev-a"] as EventLike[], logs["dev-b"] as EventLike[]).events as Log;
          logs["dev-a"] = [...merged];
          logs["dev-b"] = [...merged];
        }
      }
      const union = [...logs["dev-a"], ...logs["dev-b"]];
      const reference = snapshot(mergeEvents(logs["dev-a"] as EventLike[], logs["dev-b"] as EventLike[]).events);
      for (let i = 0; i < 4; i++) expect(snapshot(shuffled(union, random)), `seme ${seed}`).toEqual(reference);
      expect(snapshot(mergeEvents(logs["dev-b"] as EventLike[], logs["dev-a"] as EventLike[]).events), `seme ${seed}`).toEqual(reference);

      // un pasto compare una volta sola
      const ids = reference.meals.map((m) => m.mealId);
      expect(new Set(ids).size, `seme ${seed}`).toBe(ids.length);
      // la dispensa scala esattamente i consumi in vigore, ognuno una volta
      const pantry = derivePantry(union as never[]);
      expect(pantry.anomalies.filter((x) => x.code === "over_consumption"), `seme ${seed}`).toEqual([]);
      const eaten = activeConsumes(union).reduce((sum, c) => sum + c.quantity.value, 0);
      expect(pantry.lots[0].consumed, `seme ${seed}`).toBe(eaten);
      expect(pantry.lots[0].remaining, `seme ${seed}`).toBe(400 - eaten);
      // e i consumi in vigore sono al più quelli di partenza, uno per voce: una correzione non ne aggiunge mai
      const active = activeConsumes(union);
      expect(active.length, `seme ${seed}`).toBeLessThanOrEqual(2);
      const roots = consumeRoots(union);
      expect(new Set(active.map((x) => roots.get(x.id))).size, `seme ${seed}`).toBe(active.length);
      expect(new Set([...roots.values()]), `seme ${seed}`).toEqual(new Set(["c1", "c2"]));
      // le voci tolte sono al più quelle che non ci sono più, mai quelle solo corrette o spostate
      const removed = mealsOf(union).reduce((sum, m) => sum + (m.removedLines ?? 0), 0);
      expect(removed, `seme ${seed}`).toBeLessThanOrEqual(2 - active.length);
    }
  });
});

describe("pasto fuori casa: la taglia e l'energia stimata", () => {
  const normal: MealItem = { name: "Fuori casa · normale", quantity: q(1, "pz"), certainty: "estimated", energyKcal: 800 };
  const out = meal("mo", at("13:00"), { mealId: "meal-o", kind: "lunch", items: [normal], certainty: "estimated" });
  const start: Log = [out];
  const large = { name: "Fuori casa · abbondante", energyKcal: 1200 };
  const itemsOf = (log: Log) => mealOf(log, "meal-o")?.items;

  it("8. da «normale» ad «abbondante»: un void e un pasto nuovo con lo stesso mealId, e il conto cambia", () => {
    expect(energyOf(start)).toBe(800);
    const events = done(changeItem("meal-o", 0, large, start, ctx(at("14:00"))));
    expect(events.map((e) => e.type)).toEqual(["void", "meal"]);
    expect(events[0]).toMatchObject({ type: "void", targetEventId: "mo" });
    const next = events[1] as MealEvent;
    expect(next).toMatchObject({ mealId: "meal-o", kind: "lunch", at: out.at, replaces: "mo", certainty: "estimated" });
    expect(next.items).toEqual([{ ...normal, ...large }]);
    for (const e of events) expect(validateDiaryEvent(e)).toEqual([]);
    const after = [...start, ...events];
    expect(mealsOf(after)).toHaveLength(1);
    expect(itemsOf(after)).toEqual([{ ...normal, ...large }]);
    expect(energyOf(after)).toBe(1200);
  });

  it("8. «Annulla» riporta «normale» con la sua energia", () => {
    const events = done(changeItem("meal-o", 0, large, start, ctx(at("14:00"))));
    const undone = [...start, ...events, ...undo(events, at("14:01"))];
    expect(snapshot(undone)).toEqual(snapshot(start));
    expect(itemsOf(undone)).toEqual([normal]);
    expect(energyOf(undone)).toBe(800);
  });

  it("la stessa taglia e la stessa energia: nessun evento", () => {
    expect(done(changeItem("meal-o", 0, { name: normal.name, energyKcal: 800 }, start, ctx(at("14:00"))))).toEqual([]);
  });

  it("un'energia non valida non scrive niente", () => {
    for (const energyKcal of [-1, 5001, Number.NaN, Infinity]) {
      expect(errorOf(changeItem("meal-o", 0, { energyKcal }, start, ctx(at("14:00"))))).toBeDefined();
    }
  });

  it("una voce che non è una stima fuori casa non riceve un'energia scritta a mano", () => {
    expect(errorOf(changeItem("meal-1", 0, { energyKcal: 500 }, base, ctx(at("14:00"))))).toBeDefined();
    expect(mealOf(base)?.items[0]).toEqual(pizza);
  });

  it("9. spostato da pranzo a cena: l'energia resta quella scritta", () => {
    const events = done(rewriteMeal("meal-o", { kind: "dinner", minutes: 20 * 60 }, start, ctx(at("21:00"))));
    const after = [...start, ...events];
    expect(mealOf(after, "meal-o")).toMatchObject({ kind: "dinner", at: at("20:00") });
    expect(itemsOf(after)).toEqual([normal]);
    expect(energyOf(after)).toBe(800);
  });

  it("la voce spostata in un altro momento porta con sé la sua energia, nel pasto nuovo e in uno che c'è già", () => {
    const toEmpty = [...start, ...done(moveItem("meal-o", 0, { kind: "dinner" }, start, deriveDiary(start, TZ), ctx(at("21:00"))))];
    expect(mealsOf(toEmpty).map((m) => [m.kind, m.items])).toEqual([["dinner", [normal]]]);
    expect(energyOf(toEmpty)).toBe(800);

    const withDinner: Log = [...start, meal("md", at("20:00"), { mealId: "meal-d", kind: "dinner", items: [pizza], certainty: "estimated" })];
    const joined = [...withDinner, ...done(moveItem("meal-o", 0, { kind: "dinner" }, withDinner, deriveDiary(withDinner, TZ), ctx(at("21:00"))))];
    expect(mealOf(joined, "meal-d")?.items).toEqual([pizza, normal]);
    expect(mealOf(joined, "meal-o")).toBeUndefined();
  });

  it("aggiungere una voce al pasto non tocca la stima", () => {
    const after = [...start, ...done(appendItems("meal-o", [pizza], start, ctx(at("14:00"))))];
    expect(itemsOf(after)).toEqual([normal, pizza]);
  });

  it("due telefoni cambiano la taglia in due modi: dopo l'unione il pasto è uno, lo stesso su entrambi, e conta una volta", () => {
    const a = done(changeItem("meal-o", 0, large, start, ctx(at("14:00"), "dev-a")));
    const b = done(changeItem("meal-o", 0, { name: "Fuori casa · leggero", energyKcal: 480 }, start, ctx(at("14:05"), "dev-b")));
    const ab = mergeAllEvents([...start, ...a] as AnyEvent[], [...start, ...b] as AnyEvent[]).events as Log;
    const ba = mergeAllEvents([...start, ...b] as AnyEvent[], [...start, ...a] as AnyEvent[]).events as Log;
    expect(snapshot(ab)).toEqual(snapshot(ba));
    expect(mealsOf(ab)).toHaveLength(1);
    // vale la correzione più recente, con il nome e l'energia scritti insieme
    expect(itemsOf(ab)).toEqual([{ ...normal, name: "Fuori casa · leggero", energyKcal: 480 }]);
    expect(energyOf(ab)).toBe(480);
  });
});
