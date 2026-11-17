import { describe, expect, it } from "vitest";
import { derivePantry, type ConsumeEvent } from "../ledger";
import { computeIntake, createResolver } from "../nutrition";
import { FAKE_FOODS } from "../nutrition/test-helpers";
import { deriveDiary } from "./derive";
import { mealsWithPantry } from "./pantry";
import { dayBefore, isQuickConsume, mealForMoment, momentKindAt, moveConsumes, placeConsumes, QUICK_CONSUME_NOTE } from "./placeConsume";
import { getDay, mealMoments } from "./selectors";
import { consume, meal, purchase, voidOf } from "./test-helpers";

const D = "2026-03-10";
const TZ = { timeZone: "UTC" };
const at = (hhmm: string, day = D) => `${day}T${hhmm}:00.000Z`;
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

const lot = purchase("p1", at("06:00"), { lotId: "lot-1", productRef: "Petto di pollo", quantity: q(1100), location: "freezer" });
const pieces = purchase("p2", at("06:00"), { lotId: "lot-2", productRef: "Piadine", quantity: q(4, "pz"), location: "dispensa" });

let n = 0;
const ids = () => `gen-${++n}`;
const ctx = (now: string) => ({ deviceId: "dev-a", now, idGenerator: ids, timeZone: "UTC" });

/** Un consumo come lo costruisce `buildConsume`, senza pasto. */
const eaten = (id: string, when: string, value: number, extra: Partial<ConsumeEvent> = {}): ConsumeEvent =>
  consume(id, when, { lotId: "lot-1", quantity: q(value), note: QUICK_CONSUME_NOTE, ...extra });

const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });
const energyOf = (log: unknown[], date = D) => computeIntake(log, resolver, TZ).days.find((d) => d.date === date)?.totals.energyKcal?.value;

describe("il momento dall'ora", () => {
  it.each([
    ["04:59", "snack"],
    ["07:00", "breakfast"],
    ["10:29", "breakfast"],
    ["10:30", "lunch"],
    ["13:11", "lunch"],
    ["15:29", "lunch"],
    ["15:30", "snack"],
    ["18:29", "snack"],
    ["18:30", "dinner"],
    ["22:59", "dinner"],
    ["23:30", "snack"],
    ["00:10", "snack"],
  ])("%s è %s", (hhmm, kind) => {
    expect(momentKindAt(at(hhmm), "UTC")).toBe(kind);
  });

  it("segue il fuso: le 12:11 UTC d'estate a Roma sono le 14:11, pranzo; le 22:30 UTC sono le 00:30 del giorno dopo, fuori pasto", () => {
    expect(momentKindAt("2026-07-10T12:11:00.000Z", "Europe/Rome")).toBe("lunch");
    expect(momentKindAt("2026-07-10T22:30:00.000Z", "Europe/Rome")).toBe("snack");
  });
});

describe("un consumo rapido senza pasto del momento: nasce un pasto", () => {
  const c = eaten("c1", at("13:11"), 275);
  const placed = placeConsumes([c], deriveDiary([lot], TZ), ctx(at("13:11")));

  it("scrive il pasto del momento giusto e il consumo legato", () => {
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;
    expect(placed.kind).toBe("lunch");
    expect(placed.date).toBe(D);
    expect(placed.joined).toBe(false);
    expect(placed.events.map((e) => e.type)).toEqual(["meal", "consume"]);
    expect(placed.consumes[0].mealId).toBe(placed.mealId);
    expect(isQuickConsume(placed.consumes[0])).toBe(true);
  });

  it("in Oggi il consumo sta nel pranzo, con la sua quantità", () => {
    if (!placed.ok) return;
    const log = [lot, ...placed.events];
    const state = deriveDiary(log, TZ);
    const [m] = mealsWithPantry(state, log);
    expect(m.kind).toBe("lunch");
    expect(m.pantryConsumes.map((x) => x.quantity.value)).toEqual([275]);
    expect(mealMoments(getDay(state, D)).find((x) => x.kind === "lunch")?.status).toBe("recorded");
  });

  it("conta nei nutrienti come ogni pasto", () => {
    if (!placed.ok) return;
    expect(energyOf([lot, ...placed.events])).toBe(275);
  });

  it("senza il diario (ancora da caricare) il pasto nasce comunque", () => {
    const r = placeConsumes([c], undefined, ctx(at("13:11")));
    expect(r.ok && r.events.map((e) => e.type)).toEqual(["meal", "consume"]);
  });

  it("niente da segnare è un errore, non un pasto vuoto", () => {
    expect(placeConsumes([], undefined, ctx(at("13:11"))).ok).toBe(false);
  });
});

describe("un pasto del momento c'è già: il consumo vi si aggiunge", () => {
  const existing = meal("m1", at("13:00"), { mealId: "meal-1", kind: "lunch", title: "Pasta al pomodoro" });
  const log = [lot, existing];

  it("non nasce un secondo pasto", () => {
    const r = placeConsumes([eaten("c1", at("13:11"), 275)], deriveDiary(log, TZ), ctx(at("13:11")));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.joined).toBe(true);
    expect(r.mealId).toBe("meal-1");
    expect(r.events.map((e) => e.type)).toEqual(["consume"]);
    const all = [...log, ...r.events];
    expect(getDay(deriveDiary(all, TZ), D)?.meals).toHaveLength(1);
    expect(mealsWithPantry(deriveDiary(all, TZ), all)[0].pantryConsumes).toHaveLength(1);
  });

  it("due tocchi di fila: il secondo trova il pasto nato dal primo", () => {
    const first = placeConsumes([eaten("c1", at("13:11"), 275)], deriveDiary([lot], TZ), ctx(at("13:11")));
    if (!first.ok) throw new Error("atteso ok");
    const log2 = [lot, ...first.events];
    const second = placeConsumes([eaten("c2", at("13:12"), 138, { certainty: "estimated" })], deriveDiary(log2, TZ), ctx(at("13:12")));
    expect(second.ok && second.joined).toBe(true);
    if (!second.ok) return;
    expect(second.events.map((e) => e.type)).toEqual(["consume"]);
    const all = [...log2, ...second.events];
    expect(getDay(deriveDiary(all, TZ), D)?.meals).toHaveLength(1);
    expect(energyOf(all)).toBe(413);
  });

  it("con più pasti dello stesso momento sceglie l'ultimo", () => {
    const later = meal("m2", at("14:00"), { mealId: "meal-2", kind: "lunch" });
    const state = deriveDiary([lot, existing, later], TZ);
    expect(mealForMoment(state, D, "lunch")?.mealId).toBe("meal-2");
    expect(mealForMoment(state, D, "dinner")).toBeUndefined();
    expect(mealForMoment(state, "2026-03-09", "lunch")).toBeUndefined();
  });

  it("un pasto fantasma (consumi tutti annullati) non accoglie nulla: ne nasce uno nuovo", () => {
    const ghost = [
      lot,
      meal("mg", at("12:00"), { mealId: "meal-g", kind: "lunch" }),
      consume("cg", at("12:01"), { lotId: "lot-1", quantity: q(50), mealId: "meal-g" }),
      voidOf("vg", at("12:30"), "cg"),
    ];
    const r = placeConsumes([eaten("c1", at("13:11"), 275)], deriveDiary(ghost, TZ), ctx(at("13:11")));
    expect(r.ok && r.joined).toBe(false);
  });
});

describe("annullare senza lasciare un pasto fantasma", () => {
  it("annullare tutti gli eventi di un consumo che aveva creato il pasto toglie il pasto", () => {
    const r = placeConsumes([eaten("c1", at("13:11"), 275)], deriveDiary([lot], TZ), ctx(at("13:11")));
    if (!r.ok) throw new Error("atteso ok");
    const log = [lot, ...r.events, ...r.events.map((e, i) => voidOf(`u${i}`, at("13:12"), e.id))];
    expect(getDay(deriveDiary(log, TZ), D)?.meals ?? []).toEqual([]);
    expect(mealMoments(getDay(deriveDiary(log, TZ), D)).find((x) => x.kind === "lunch")?.status).toBe("none");
    expect(derivePantry(log).lots[0].remaining).toBe(1100);
  });

  it("annullare il solo consumo lascia l'evento del pasto, che non compare né conta come pasto vuoto", () => {
    const r = placeConsumes([eaten("c1", at("13:11"), 275)], deriveDiary([lot], TZ), ctx(at("13:11")));
    if (!r.ok) throw new Error("atteso ok");
    const log = [lot, ...r.events, voidOf("u1", at("13:12"), r.consumes[0].id)];
    const state = deriveDiary(log, TZ);
    expect(getDay(state, D)?.meals ?? []).toEqual([]);
    const day = computeIntake(log, resolver, TZ).days.find((d) => d.date === D);
    expect(day?.meals ?? []).toEqual([]);
    expect(day?.reasons ?? []).not.toContain("empty_meals");
  });

  it("annullare il consumo aggiunto a un pasto che c'era lascia il pasto com'era", () => {
    const existing = meal("m1", at("13:00"), { mealId: "meal-1", kind: "lunch", title: "Pasta", items: [{ name: "Pasta", quantity: q(80), certainty: "estimated" }] });
    const r = placeConsumes([eaten("c1", at("13:11"), 275)], deriveDiary([lot, existing], TZ), ctx(at("13:11")));
    if (!r.ok) throw new Error("atteso ok");
    const log = [lot, existing, ...r.events, voidOf("u1", at("13:12"), r.consumes[0].id)];
    const meals = getDay(deriveDiary(log, TZ), D)?.meals ?? [];
    expect(meals.map((m) => m.mealId)).toEqual(["meal-1"]);
  });
});

describe("un pezzo e mezzo pezzo", () => {
  it("un pezzo e mezzo pezzo di fila vanno nello stesso pasto, e il pasto è una stima", () => {
    const one = consume("c1", at("13:11"), { lotId: "lot-2", quantity: q(1, "pz"), note: QUICK_CONSUME_NOTE });
    const half = consume("c2", at("13:12"), { lotId: "lot-2", quantity: q(0.5, "pz"), certainty: "estimated", note: QUICK_CONSUME_NOTE });
    const a = placeConsumes([one], deriveDiary([pieces], TZ), ctx(at("13:11")));
    if (!a.ok) throw new Error("atteso ok");
    const log1 = [pieces, ...a.events];
    const b = placeConsumes([half], deriveDiary(log1, TZ), ctx(at("13:12")));
    if (!b.ok) throw new Error("atteso ok");
    expect(b.joined).toBe(true);
    const all = [...log1, ...b.events];
    const [m] = mealsWithPantry(deriveDiary(all, TZ), all);
    expect(m.pantryConsumes.map((x) => x.quantity.value)).toEqual([1, 0.5]);
    expect(derivePantry(all).lots.find((l) => l.lotId === "lot-2")?.remaining).toBe(2.5);
  });

  it("un pasto nato da una stima è una stima, da una misura una misura", () => {
    const est = placeConsumes([consume("c", at("13:11"), { lotId: "lot-2", quantity: q(0.5, "pz"), certainty: "estimated" })], undefined, ctx(at("13:11")));
    const sure = placeConsumes([consume("c", at("13:11"), { lotId: "lot-2", quantity: q(1, "pz") })], undefined, ctx(at("13:11")));
    expect(est.ok && est.events[0].certainty).toBe("estimated");
    expect(sure.ok && sure.events[0].certainty).toBe("measured");
  });
});

describe("cambiare momento", () => {
  const first = placeConsumes([eaten("c1", at("13:11"), 275)], deriveDiary([lot], TZ), ctx(at("13:11")));
  if (!first.ok) throw new Error("atteso ok");
  const log = [lot, ...first.events];

  it("il consumo passa alla cena: vecchio annullato, nuovo legato al pasto nuovo, una sola volta nei nutrienti", () => {
    const moved = moveConsumes(first.consumes, deriveDiary(log, TZ), ctx(at("13:20")), { kind: "dinner" });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.kind).toBe("dinner");
    expect(moved.events.map((e) => e.type)).toEqual(["meal", "void", "consume"]);
    const all = [...log, ...moved.events];
    const state = deriveDiary(all, TZ);
    const meals = getDay(state, D)?.meals ?? [];
    expect(meals.map((m) => m.kind)).toEqual(["dinner"]);
    expect(mealsWithPantry(state, all)[0].pantryConsumes.map((x) => x.quantity.value)).toEqual([275]);
    expect(energyOf(all)).toBe(275);
    expect(derivePantry(all).lots[0].remaining).toBe(1100 - 275);
    expect(isQuickConsume(moved.consumes[0])).toBe(true);
    expect(moved.consumes[0].replaces).toBe("c1");
    expect(moved.consumes[0].at).toBe(first.consumes[0].at);
  });

  it("annullare il cambio riporta il consumo al pranzo", () => {
    const moved = moveConsumes(first.consumes, deriveDiary(log, TZ), ctx(at("13:20")), { kind: "dinner" });
    if (!moved.ok) throw new Error("atteso ok");
    const all = [...log, ...moved.events, ...moved.events.map((e, i) => voidOf(`u${i}`, at("13:21"), e.id))];
    const meals = getDay(deriveDiary(all, TZ), D)?.meals ?? [];
    expect(meals.map((m) => m.kind)).toEqual(["lunch"]);
    expect(energyOf(all)).toBe(275);
  });

  it("se nel momento di arrivo c'è già un pasto, il consumo vi si aggiunge", () => {
    const dinner = meal("md", at("20:00"), { mealId: "meal-d", kind: "dinner", title: "Zuppa" });
    const all0 = [...log, dinner];
    const moved = moveConsumes(first.consumes, deriveDiary(all0, TZ), ctx(at("13:20")), { kind: "dinner" });
    if (!moved.ok) throw new Error("atteso ok");
    expect(moved.joined).toBe(true);
    expect(moved.events.map((e) => e.type)).toEqual(["void", "consume"]);
    const all = [...all0, ...moved.events];
    const meals = getDay(deriveDiary(all, TZ), D)?.meals ?? [];
    expect(meals.map((m) => m.mealId)).toEqual(["meal-d"]);
    expect(energyOf(all)).toBe(275);
  });

  it("spostare nel momento in cui è già dice che è già lì", () => {
    const moved = moveConsumes(first.consumes, deriveDiary(log, TZ), ctx(at("13:20")), { kind: "lunch" });
    expect(moved.ok).toBe(false);
  });

  it("spostarlo due volte non lo conta due volte", () => {
    const m1 = moveConsumes(first.consumes, deriveDiary(log, TZ), ctx(at("13:20")), { kind: "dinner" });
    if (!m1.ok) throw new Error("atteso ok");
    const log2 = [...log, ...m1.events];
    const m2 = moveConsumes(m1.consumes, deriveDiary(log2, TZ), ctx(at("13:21")), { kind: "snack" });
    if (!m2.ok) throw new Error("atteso ok");
    const all = [...log2, ...m2.events];
    expect((getDay(deriveDiary(all, TZ), D)?.meals ?? []).map((m) => m.kind)).toEqual(["snack"]);
    expect(energyOf(all)).toBe(275);
    expect(derivePantry(all).lots[0].remaining).toBe(1100 - 275);
  });

  it("del pasto di partenza, rimasto senza voci, non resta traccia in Oggi", () => {
    const moved = moveConsumes(first.consumes, deriveDiary(log, TZ), ctx(at("13:20")), { kind: "dinner" });
    if (!moved.ok) throw new Error("atteso ok");
    const state = deriveDiary([...log, ...moved.events], TZ);
    expect(mealMoments(getDay(state, D)).find((x) => x.kind === "lunch")?.status).toBe("none");
  });
});

describe("a cavallo della mezzanotte", () => {
  it("alle 23:50 è fuori pasto di oggi; alle 00:10 è fuori pasto del giorno dopo", () => {
    const late = placeConsumes([eaten("c1", at("23:50"), 100)], undefined, ctx(at("23:50")));
    const after = placeConsumes([eaten("c2", at("00:10", "2026-03-11"), 100)], undefined, ctx(at("00:10", "2026-03-11")));
    expect(late.ok && [late.kind, late.date]).toEqual(["snack", D]);
    expect(after.ok && [after.kind, after.date]).toEqual(["snack", "2026-03-11"]);
  });

  it("alle 00:30 si può dire «ieri, a cena»: il pasto è di ieri, alle 20:00 tipiche, e il consumo resta di adesso", () => {
    const now = at("00:30", "2026-03-11");
    const c = eaten("c1", now, 275);
    const log0 = [lot];
    const first = placeConsumes([c], deriveDiary(log0, TZ), ctx(now));
    if (!first.ok) throw new Error("atteso ok");
    const log1 = [...log0, ...first.events];
    const moved = moveConsumes(first.consumes, deriveDiary(log1, TZ), ctx(now), { kind: "dinner", date: dayBefore("2026-03-11") });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.date).toBe(D);
    const mealEvent = moved.events.find((e) => e.type === "meal");
    expect(mealEvent?.at).toBe(at("20:00"));
    expect(moved.consumes[0].at).toBe(now);
    const all = [...log1, ...moved.events];
    const state = deriveDiary(all, TZ);
    expect((getDay(state, D)?.meals ?? []).map((m) => m.kind)).toEqual(["dinner"]);
    expect(getDay(state, "2026-03-11")?.meals ?? []).toEqual([]);
    // le calorie vanno al giorno del pasto, una volta sola
    expect(energyOf(all, D)).toBe(275);
    expect(energyOf(all, "2026-03-11")).toBeUndefined();
  });

  it("dayBefore passa il mese e l'anno", () => {
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
  });
});
