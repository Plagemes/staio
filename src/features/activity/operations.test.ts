import { describe, expect, it } from "vitest";
import {
  appendItems,
  changeConsumeQuantity,
  changeItem,
  createWater,
  createWeight,
  deriveDiary,
  mealsWithPantry,
  moveConsumes,
  moveItem,
  removeConsume,
  removeItem,
  rewriteMeal,
  voidMeal,
  type DiaryDrink,
  type MealKind,
} from "@/core/diary";
import { purchase, seededRandom, shuffled } from "@/core/diary/test-helpers";
import { mergeAllEvents, operationIdOf, validateAnyEvent, withOperationId, type AnyEvent } from "@/core/events";
import { stampOperationId } from "@/core/events/operation";
import { correctLot, derivePantry, supersededConsumes, type ConsumeEvent, type Lot, type PurchaseEvent, type VoidEvent } from "@/core/ledger";
import { computeIntake } from "@/core/nutrition";
import { recipe as plannedRecipe, weekEv } from "@/core/plan/test-helpers";
import { composePrep } from "@/core/prep";
import { recipeEvent } from "@/core/recipes/test-helpers";
import {
  buildConsume,
  buildDiscard,
  buildEdit,
  buildFinish,
  buildMove,
  buildOpen,
  buildRemoveMistaken,
  buildUndo,
  formFromLot,
} from "../actions";
import { buildDrink, buildDrinkConsume, linkedConsumes, removeDrink, retimeDrink } from "../drinks";
import { buildAppendToMeal, buildRepeatMeal } from "../mealEdit";
import { buildMealDeclaration, buildMealEvents, buildMealFromHabit } from "../meals";
import { AUTOMATIC_NOTE, legacyBarcodeUpdates } from "../migrations";
import { buildQuantityCorrection } from "../pantry/correctQuantity";
import { buildChangeMoment, buildEaten } from "../pantry/eaten";
import { commandBlock, groupOperations, groupWrites, redoOperation, undoOperation, type Operation } from "./operations";

const TZ = "Europe/Rome";
const EVER = "2000-01-01T00:00:00.000Z";
const BOUGHT = "2026-11-10T09:00:00.000Z";
const NOON = "2026-11-16T11:00:00.000Z"; // 12:00 a Roma: pranzo
const LUNCH = "2026-11-16T12:11:00.000Z"; // 13:11 a Roma
const DINNER = "2026-11-16T19:00:00.000Z"; // 20:00 a Roma
const LATER = "2026-11-16T20:10:00.000Z"; // 21:10 a Roma
const NIGHT = "2026-11-16T21:00:00.000Z";
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

let n = 0;
const nextId = () => `id-${String(++n).padStart(6, "0")}`;
const ctx = (now: string, deviceId = "A") => ({ now, deviceId, idGenerator: nextId });
const factory = (now: string, deviceId = "A") => ({ now: () => now, deviceId, idGenerator: nextId });

const stock: AnyEvent[] = [
  purchase("p-pollo", BOUGHT, { deviceId: "A", lotId: "pollo", productRef: "Petto di pollo", quantity: q(1000), location: "frigo" }),
  purchase("p-insalata", BOUGHT, { deviceId: "A", lotId: "insalata", productRef: "Insalata", quantity: q(200), location: "frigo" }),
  purchase("p-pasta", BOUGHT, { deviceId: "A", lotId: "pasta", productRef: "Pasta", quantity: q(500), location: "dispensa" }),
  purchase("p-yogurt", BOUGHT, { deviceId: "A", lotId: "yogurt", productRef: "Yogurt", quantity: q(125), location: "frigo" }),
];

const lotOf = (log: readonly AnyEvent[], lotId: string) => derivePantry(log).lots.find((l) => l.lotId === lotId) as Lot;
const left = (log: readonly AnyEvent[], lotId: string) => lotOf(log, lotId).remaining;
const diaryOf = (log: readonly AnyEvent[]) => deriveDiary(log, { timeZone: TZ });
const mealsOf = (log: readonly AnyEvent[]) => mealsWithPantry(diaryOf(log), log);
const opsOf = (log: readonly AnyEvent[]) => groupOperations(log, { since: EVER });

/**
 * Dispensa, diario e ciò da cui si calcolano i nutrienti: quello che deve tornare identico. Resta fuori `removedLines`:
 * è la traccia che il diario tiene di una voce della dispensa tolta da un pasto, e un consumo annullato la lascia
 * (lo fa anche «Annulla» sull'avviso); c'è un test apposta.
 */
function snapshot(log: readonly AnyEvent[]) {
  const pantry = derivePantry(log);
  const diary = diaryOf(log);
  const plain = <T extends { removedLines?: number }>(meal: T): Omit<T, "removedLines"> => {
    const { removedLines: _trace, ...rest } = meal;
    void _trace;
    return rest;
  };
  return {
    lots: pantry.lots,
    pantryAnomalies: pantry.anomalies,
    days: diary.days.map((d) => ({ ...d, meals: d.meals.map(plain) })),
    habits: diary.habits,
    diaryAnomalies: diary.anomalies,
    meals: mealsWithPantry(diary, log).map(plain),
    intake: computeIntake(log, () => undefined, { timeZone: TZ }).days,
  };
}

/** L'operazione che contiene questo evento. */
function opWith(log: readonly AnyEvent[], event: Pick<AnyEvent, "id">): Operation {
  const op = opsOf(log).find((o) => o.events.some((e) => e.id === event.id));
  if (!op) throw new Error(`nessuna operazione con ${event.id}`);
  return op;
}

function undo(log: readonly AnyEvent[], op: Operation, now = NIGHT, deviceId = "A"): VoidEvent[] {
  const r = undoOperation(op, log, derivePantry(log), ctx(now, deviceId));
  if (!r.ok) throw new Error(`annulla: ${r.reason}`);
  return r.events;
}

function redo(log: readonly AnyEvent[], op: Operation, now = "2026-11-16T21:30:00.000Z", deviceId = "A"): VoidEvent[] {
  const r = redoOperation(op, log, derivePantry(log), ctx(now, deviceId));
  if (!r.ok) throw new Error(`rifai: ${r.reason}`);
  return r.events;
}

const reasonOf = (r: ReturnType<typeof undoOperation>): string => (r.ok ? "ok" : r.reason);

/** Gli eventi di un costruttore finiscono tutti in un solo gruppo di scrittura, e il gruppo non contiene altro. */
function expectOneWrite(log0: readonly AnyEvent[], events: readonly AnyEvent[]): void {
  expect(events.length).toBeGreaterThan(0);
  expect(events.every((e) => validateAnyEvent(e).length === 0)).toBe(true);
  const ids = new Set(events.map((e) => e.id));
  const groups = groupWrites([...log0, ...events]).filter((g) => g.events.some((e) => ids.has(e.id)));
  expect(groups).toHaveLength(1);
  expect(new Set(groups[0].events.map((e) => e.id))).toEqual(ids);
}

/**
 * Un'azione dell'interfaccia: i suoi eventi sono una sola operazione; «Annulla» scrive solo annullamenti, tutti allo
 * stesso istante, e riporta dispensa e diario a prima; «Rifai» li riporta a dopo l'azione.
 */
function expectUndoable(log0: readonly AnyEvent[], events: readonly AnyEvent[]): { undone: AnyEvent[]; redone: AnyEvent[] } {
  expectOneWrite(log0, events);
  const log = [...log0, ...events];
  const op = opWith(log, events.find((e) => e.type !== "void") as AnyEvent);
  expect(op.events.map((e) => e.id).sort()).toEqual(events.map((e) => e.id).sort());
  expect(op.state).toBe("active");
  expect(commandBlock(op, log, derivePantry(log), { now: NIGHT })).toBeUndefined();

  const voids = undo(log, op);
  expect(voids.every((v) => v.type === "void" && v.recordedAt === NIGHT && v.deviceId === "A")).toBe(true);
  expect(voids.map((v) => v.targetEventId).sort()).toEqual(events.map((e) => e.id).sort());
  const undone = [...log, ...voids];
  expect(snapshot(undone)).toEqual(snapshot(log0));
  const after = opWith(undone, op);
  expect(after.state).toBe("undone");
  expect(reasonOf(undoOperation(after, undone, derivePantry(undone), ctx(NIGHT)))).toMatch(/già annullata/);

  const again = redo(undone, after);
  expect(again.every((v) => v.type === "void")).toBe(true);
  expect(again.map((v) => v.targetEventId).sort()).toEqual(voids.map((v) => v.id).sort());
  const redone = [...undone, ...again];
  expect(snapshot(redone)).toEqual(snapshot(log));
  expect(opWith(redone, op).state).toBe("active");
  expect(opsOf(redone).map((o) => o.id)).toEqual(opsOf(log).map((o) => o.id));
  return { undone, redone };
}

/** Un «Togli» (solo annullamenti): un gruppo solo, nessuna riga in più. */
function expectVoidOnly(log0: readonly AnyEvent[], events: readonly AnyEvent[]): AnyEvent[] {
  expect(events.every((e) => e.type === "void")).toBe(true);
  expectOneWrite(log0, events);
  const log = [...log0, ...events];
  expect(opsOf(log).map((o) => o.id)).toEqual(opsOf(log0).map((o) => o.id));
  return log;
}

function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
}

/** Cena registrata: pollo, insalata e pasta dalla dispensa, più una voce libera. */
function withDinner(base: readonly AnyEvent[] = stock, now = DINNER, deviceId = "A") {
  const r = ok(
    buildMealEvents(
      {
        kind: "dinner",
        picks: [
          { lot: lotOf(base, "pollo"), choice: { kind: "text", text: "200 g" } },
          { lot: lotOf(base, "insalata"), choice: { kind: "text", text: "50 g" } },
          { lot: lotOf(base, "pasta"), choice: { kind: "text", text: "80 g" } },
        ],
        freeItems: [{ name: "Pane", quantityText: "40 g" }],
      },
      ctx(now, deviceId),
    ),
  );
  const consumes = r.events.filter((e): e is ConsumeEvent => e.type === "consume");
  return { events: r.events, log: [...base, ...r.events], mealId: r.mealId, consumes, pollo: consumes[0] };
}

/** «Mangiato» dalla scheda di un alimento. */
function eat(log: readonly AnyEvent[], lotId: string, value: number, now: string, deviceId = "A") {
  const r = ok(buildEaten([lotOf(log, lotId)], { kind: "value", value }, ctx(now, deviceId), diaryOf(log)));
  return { events: r.events, log: [...log, ...r.events], marked: r.marked, consume: r.marked.consumes[0] };
}

describe("raggruppare: un'azione, una operazione", () => {
  it("una chiamata di scrittura è un'operazione: gli eventi con lo stesso opId stanno insieme, anche se non portano lo stesso istante", () => {
    const at = (ms: number) => new Date(Date.parse(NOON) + ms).toISOString();
    const water = (ms: number, deviceId = "A") => createWater({ ml: 200 }, factory(at(ms), deviceId));
    const first = withOperationId([water(0), water(40)], "op-1");
    const second = withOperationId([water(600)], "op-2");
    const other = withOperationId([water(300, "B")], "op-3");
    const groups = groupWrites([...second, ...other, ...first]);
    expect(groups.map((g) => g.events.map((e) => e.id))).toEqual([first.map((e) => e.id), other.map((e) => e.id), second.map((e) => e.id)]);
    expect(groups.map((g) => [g.id, g.at, g.deviceId])).toEqual([[first[0].id, at(0), "A"], [other[0].id, at(300), "B"], [second[0].id, at(600), "A"]]);

    const log = [...first, ...second, ...other];
    expect(opsOf(log).map((o) => o.id)).toEqual([second[0].id, other[0].id, first[0].id]);
    const voids = undo(log, opWith(log, first[0]));
    expect(voids.map((v) => v.targetEventId).sort()).toEqual(first.map((e) => e.id).sort());
    expect(opsOf([...log, ...voids]).map((o) => o.state)).toEqual(["active", "active", "undone"]);
  });

  it("due azioni diverse fatte di fila non diventano una riga sola: né con l'opId, né nei registri di prima", () => {
    for (const stamp of [true, false]) {
      const write = (events: readonly AnyEvent[]): AnyEvent[] => (stamp ? withOperationId(events, nextId()) : [...events]);
      const eaten = write(eat(stock, "yogurt", 100, NOON).events);
      const log1 = [...stock, ...eaten];
      const thrown = write(ok(buildDiscard(lotOf(log1, "pollo"), { kind: "all" }, "expired", ctx("2026-11-16T11:00:00.600Z"))).events);
      const log = [...log1, ...thrown];
      const [later, earlier] = opsOf(log);
      expect(later.events.map((e) => e.type)).toEqual(["discard"]);
      expect(earlier.events.map((e) => e.type).sort()).toEqual(["consume", "meal"]);
      const undone = [...log, ...undo(log, earlier)];
      expect([left(undone, "yogurt"), left(undone, "pollo")]).toEqual([125, 0]);

      const water = write([createWater({ ml: 200 }, factory(LUNCH))]);
      const weight = write([createWeight({ kg: 72.4 }, factory("2026-11-16T12:11:00.500Z"))]);
      expect(opsOf([...water, ...weight]).map((o) => o.events.map((e) => e.type))).toEqual([["weight"], ["water"]]);
    }
  });

  it("registri di prima dell'opId: stanno insieme gli eventi a pochi millisecondi dal primo, per dispositivo", () => {
    const at = (ms: number) => new Date(Date.parse(NOON) + ms).toISOString();
    const water = (ms: number, deviceId = "A") => createWater({ ml: 200 }, factory(at(ms), deviceId));
    const [a, b, c, d, other] = [water(0), water(10), water(11), water(15), water(5, "B")];
    const groups = groupWrites([d, other, c, a, b]);
    expect(groups.map((g) => g.events.map((e) => e.id))).toEqual([[a.id, b.id], [other.id], [c.id, d.id]]);
    // un evento di prima non entra in un'operazione che ha l'opId, nemmeno allo stesso istante
    const stamped = withOperationId([water(0)], "op-9");
    expect(groupWrites([a, ...stamped]).map((g) => g.events.length)).toEqual([1, 1]);
  });

  it("9. due bicchieri nella stessa scrittura sono una sola operazione, e «Annulla» li toglie entrambi", () => {
    const pair = withOperationId([createWater({ ml: 200 }, factory(NOON)), createWater({ ml: 200 }, factory("2026-11-16T11:00:00.400Z"))], "op-w");
    const log = [...stock, ...pair];
    const op = opWith(log, pair[0]);
    expect(op.events.map((e) => e.id)).toEqual(pair.map((e) => e.id));
    const voids = undo(log, op);
    expect(voids.map((v) => v.targetEventId).sort()).toEqual(pair.map((e) => e.id).sort());
    expect(diaryOf([...log, ...voids]).days).toEqual([]);
  });

  it("un «Annulla» seguito entro il secondo da un'altra azione non diventa una correzione: annullare la seconda non riporta in vita la prima", () => {
    const at = (ms: number) => new Date(Date.parse(NOON) + ms).toISOString();
    const first = createWater({ ml: 200 }, factory(at(0)));
    const log1 = [first];
    const voids = undo(log1, opWith(log1, first), at(5000));
    const second = createWater({ ml: 500 }, factory(at(5600)));
    const log = [...log1, ...voids, second];
    expect(groupWrites(log).map((g) => g.events.map((e) => e.id))).toEqual([[first.id], [voids[0].id], [second.id]]);
    expect(opsOf(log).map((o) => [o.id, o.state])).toEqual([[second.id, "active"], [first.id, "undone"]]);
    const after = [...log, ...undo(log, opWith(log, second), at(60_000))];
    expect(diaryOf(after).days).toEqual([]);
    expect(opsOf(after).map((o) => o.state)).toEqual(["undone", "undone"]);
    // e un «Annulla» toccato entro il secondo dalla sua azione è un annullamento, non una parte dell'azione
    const quick = [first, ...undo(log1, opWith(log1, first), at(700))];
    expect(opsOf(quick).map((o) => [o.events.length, o.state])).toEqual([[1, "undone"]]);
  });

  it("10. gli eventi dell'altro telefono stanno al loro posto nel tempo", () => {
    const mine = createWater({ ml: 200 }, factory(LUNCH, "A"));
    const theirs = createWater({ ml: 300 }, factory(NOON, "B"));
    const latest = createWater({ ml: 100 }, factory(DINNER, "A"));
    expect(opsOf([mine, latest, theirs]).map((o) => [o.id, o.deviceId])).toEqual([[latest.id, "A"], [mine.id, "A"], [theirs.id, "B"]]);
  });

  it("11. un tipo che questa versione non conosce è una riga, senza «Annulla»", () => {
    const alien = { id: "x-1", type: "holograph", at: NOON, recordedAt: NOON, deviceId: "B", schemaVersion: 1, certainty: "measured", source: "manual" } as unknown as AnyEvent;
    const broken = { id: "x-2", type: "water", at: NOON, recordedAt: NOON, deviceId: "B", schemaVersion: 1, certainty: "measured", source: "manual", ml: -5 } as unknown as AnyEvent;
    const log = [...stock, alien, broken];
    const ops = opsOf(log);
    expect(ops.map((o) => o.id)).toEqual(["x-1", "p-insalata"]);
    expect(commandBlock(ops[0], log, derivePantry(log), { now: NIGHT })).toMatch(/versione più nuova/);
    expect(reasonOf(undoOperation(ops[0], log, derivePantry(log), ctx(NIGHT)))).toMatch(/versione più nuova/);
  });

  it("12. quattordici giorni: ciò che è più vecchio non compare, e un annullamento di oggi su un'azione vecchia non fa righe", () => {
    const old = createWater({ ml: 200 }, factory("2026-10-27T09:00:00.000Z"));
    const borderline = createWater({ ml: 200 }, factory("2026-11-01T21:00:00.000Z"));
    const recent = createWater({ ml: 200 }, factory("2026-11-03T09:00:00.000Z"));
    const log0 = [old, borderline, recent];
    const since = "2026-11-02T21:00:00.000Z";
    expect(groupOperations(log0, { since }).map((o) => o.id)).toEqual([recent.id]);
    const voids = undo(log0, opWith(log0, old));
    const log = [...log0, ...voids];
    expect(groupOperations(log, { since }).map((o) => o.id)).toEqual([recent.id]);
    expect(opWith(log, old).state).toBe("undone");
  });

  it("13. registro vuoto: nessuna operazione", () => {
    expect(opsOf([])).toEqual([]);
    expect(groupWrites([])).toEqual([]);
  });

  it("non dipende dall'ordine in cui gli eventi arrivano", () => {
    const { log } = withDinner();
    const more = [...log, ...eat(log, "yogurt", 125, LATER, "B").events];
    const expected = opsOf(more);
    for (const seed of [1, 2, 3, 4, 5]) expect(opsOf(shuffled(more, seededRandom(seed)))).toEqual(expected);
  });
});

describe("un costruttore, una operazione; dopo «Annulla» tutto è come prima", () => {
  it("1. buildMealEvents: pasto con tre alimenti della dispensa, una riga sola", () => {
    const dinner = withDinner();
    expect(dinner.events.map((e) => e.type)).toEqual(["meal", "consume", "consume", "consume"]);
    const { undone } = expectUndoable(stock, dinner.events);
    expect([left(undone, "pollo"), left(undone, "insalata"), left(undone, "pasta")]).toEqual([1000, 200, 500]);
    expect(mealsOf(undone)).toEqual([]);
  });

  it("buildMealEvents con «salvalo come pasto abituale»: anche il pasto abituale torna indietro", () => {
    const r = ok(
      buildMealEvents(
        { kind: "lunch", picks: [{ lot: lotOf(stock, "pasta"), choice: { kind: "text", text: "80 g" } }], freeItems: [], saveHabitAs: "Solito pranzo" },
        ctx(LUNCH),
      ),
    );
    expect(r.events.map((e) => e.type)).toEqual(["meal", "consume", "habit"]);
    expectUndoable(stock, r.events);
  });

  it("buildMealFromHabit", () => {
    const habit = { habitId: "h1", title: "Solita cena", kind: "dinner" as MealKind, items: [{ name: "Pasta", quantity: q(80), certainty: "measured" as const }, { name: "Sugo", quantity: q(100), certainty: "estimated" as const }] };
    const r = buildMealFromHabit(habit, derivePantry(stock).lots, ctx(DINNER));
    expect(r.events.map((e) => e.type)).toEqual(["meal", "consume"]);
    expectUndoable(stock, r.events);
  });

  it("buildMealDeclaration", () => {
    expectUndoable(stock, buildMealDeclaration("2026-11-16", "lunch", "skipped", ctx(LATER)).events);
  });

  it("buildEaten in un momento vuoto: pasto e consumo insieme", () => {
    const eaten = eat(stock, "pollo", 275, LUNCH);
    expect(eaten.events.map((e) => e.type)).toEqual(["meal", "consume"]);
    expectUndoable(stock, eaten.events);
  });

  it("2. buildEaten in un momento che ha già un pasto: si toglie solo il consumo, il pasto resta", () => {
    const lunch = ok(buildMealEvents({ kind: "lunch", picks: [], freeItems: [{ name: "Riso", quantityText: "150 g" }] }, ctx(NOON)));
    const log0 = [...stock, ...lunch.events];
    const eaten = eat(log0, "pollo", 275, LUNCH);
    expect(eaten.events.map((e) => e.type)).toEqual(["consume"]);
    expect(eaten.consume.mealId).toBe(lunch.mealId);
    const { undone, redone } = expectUndoable(log0, eaten.events);
    expect(mealsOf(undone).map((m) => [m.mealId, m.items.length, m.pantryConsumes.length])).toEqual([[lunch.mealId, 1, 0]]);
    // l'unica differenza con prima: il pasto ricorda che una voce della dispensa è stata tolta; rifatta, non più
    expect(mealsOf(undone)[0].removedLines).toBe(1);
    expect(mealsOf(redone)[0].removedLines).toBeUndefined();
  });

  it("buildChangeMoment: dal pranzo alla cena e ritorno", () => {
    const eaten = eat(stock, "pollo", 275, LUNCH);
    const moved = ok(buildChangeMoment(eaten.marked, { kind: "dinner" }, ctx(LATER), diaryOf(eaten.log)));
    expect(moved.events.map((e) => e.type).sort()).toEqual(["consume", "meal", "void"]);
    const { undone, redone } = expectUndoable(eaten.log, moved.events);
    expect(mealsOf(undone).map((m) => m.kind)).toEqual(["lunch"]);
    expect(mealsOf(redone).map((m) => m.kind)).toEqual(["dinner"]);
    expect(left(redone, "pollo")).toBe(725);
  });

  it("buildConsume, buildDiscard, buildOpen, buildMove, buildFinish", () => {
    const pollo = lotOf(stock, "pollo");
    for (const r of [
      buildConsume(pollo, { kind: "value", value: 100 }, ctx(LUNCH)),
      buildDiscard(pollo, { kind: "all" }, "expired", ctx(LUNCH)),
      buildOpen(pollo, ctx(LUNCH)),
      buildMove(pollo, "freezer", ctx(LUNCH)),
      buildFinish(pollo, ctx(LUNCH)),
    ]) {
      expectUndoable(stock, ok(r).events);
    }
  });

  it("buildEdit: nome e scadenza", () => {
    const pollo = lotOf(stock, "pollo");
    const r = ok(buildEdit(stock[0] as PurchaseEvent, pollo, { ...formFromLot(pollo), name: "Petto di pollo bio", expiryKind: "use_by", expiryDate: "2026-11-20" }, ctx(LUNCH)));
    expect(r.events.map((e) => e.type)).toEqual(["updateLot"]);
    const { redone } = expectUndoable(stock, r.events);
    expect(lotOf(redone, "pollo").productRef).toBe("Petto di pollo bio");
  });

  it("buildQuantityCorrection: quanto ne resta, entro e oltre la quantità d'ingresso", () => {
    const eaten = eat(stock, "pollo", 300, LUNCH);
    const lot = lotOf(eaten.log, "pollo");
    const within = ok(buildQuantityCorrection({ lot, creation: stock[0] as PurchaseEvent, remaining: 250, log: eaten.log, ctx: ctx(LATER) }));
    expect(within.events.map((e) => e.type)).toEqual(["adjust"]);
    expectUndoable(eaten.log, within.events);

    const beyond = ok(buildQuantityCorrection({ lot, creation: stock[0] as PurchaseEvent, remaining: 1100, log: eaten.log, ctx: ctx(LATER) }));
    expect(beyond.events.map((e) => e.type)).toEqual(["void", "purchase", "adjust"]);
    // l'ingresso riscritto ha già un consumo: la regola dell'ingresso non lo ferma, perché l'ingresso di prima torna
    const { redone } = expectUndoable(eaten.log, beyond.events);
    expect([left(redone, "pollo"), lotOf(redone, "pollo").initial]).toEqual([1100, 1400]);
  });

  it("7. correctLot: annullamento, ingresso nuovo e modifica un millisecondo dopo sono una sola operazione", () => {
    const events = correctLot(stock[0] as PurchaseEvent, { quantity: q(1200), productRef: "Pollo intero" }, { lot: lotOf(stock, "pollo"), ...factory(LUNCH) }) as AnyEvent[];
    expect(events.map((e) => e.type)).toEqual(["void", "purchase", "updateLot"]);
    expect(events.map((e) => e.recordedAt)).toEqual([LUNCH, LUNCH, "2026-11-16T12:11:00.001Z"]);
    const { undone, redone } = expectUndoable(stock, events);
    expect([lotOf(undone, "pollo").productRef, left(undone, "pollo")]).toEqual(["Petto di pollo", 1000]);
    expect([lotOf(redone, "pollo").productRef, left(redone, "pollo")]).toEqual(["Pollo intero", 1200]);
  });

  it("buildRemoveMistaken: un gruppo di soli annullamenti; l'acquisto diventa «Annullata» e si rifà", () => {
    const voids = ok(buildRemoveMistaken(lotOf(stock, "yogurt"), stock, [], ctx(LUNCH))).events as AnyEvent[];
    const log = expectVoidOnly(stock, voids);
    expect(derivePantry(log).lots.map((l) => l.lotId)).not.toContain("yogurt");
    // i quattro acquisti di partenza sono stati scritti insieme: tolto uno solo, l'operazione è «corretta dopo»
    expect(opWith(log, { id: "p-yogurt" }).state).toBe("changed");

    const alone = purchase("p-latte", "2026-11-12T08:00:00.000Z", { deviceId: "A", lotId: "latte", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo" });
    const log0 = [...stock, alone];
    const gone = expectVoidOnly(log0, ok(buildRemoveMistaken(lotOf(log0, "latte"), log0, [], ctx(LUNCH))).events as AnyEvent[]);
    const op = opWith(gone, alone);
    expect(op.state).toBe("undone");
    expect(snapshot([...gone, ...redo(gone, op)])).toEqual(snapshot(log0));
  });

  it("buildDrink, retimeDrink, removeDrink", () => {
    const drink = buildDrink({ name: "Tè", ml: 200 }, { ...ctx(LUNCH), timeZone: TZ });
    const { redone } = expectUndoable(stock, drink.events);
    const entry = diaryOf(redone).days[0].drinks[0] as DiaryDrink;

    const retimed = ok(retimeDrink(entry, "2026-11-16", "08:15", { ...ctx(LATER), timeZone: TZ }));
    expect(retimed.events.map((e) => e.type)).toEqual(["void", "drink"]);
    const after = expectUndoable(redone, retimed.events).redone;
    expect(opWith(after, drink.events[0]).state).toBe("changed");

    const moved = diaryOf(after).days[0].drinks[0] as DiaryDrink;
    const removed = expectVoidOnly(after, removeDrink(moved, [], { ...ctx("2026-11-16T22:30:00.000Z"), timeZone: TZ }).events);
    expect(diaryOf(removed).days).toEqual([]);
    expect(opWith(removed, retimed.events[1]).state).toBe("undone");
  });

  it("voidMeal: un gruppo di soli annullamenti; il pasto diventa «Annullata» e «Rifai» lo rimette con i suoi consumi", () => {
    const dinner = withDinner();
    const voids = voidMeal(dinner.mealId, dinner.log, factory(LATER));
    expect(voids).toHaveLength(4);
    const log = expectVoidOnly(dinner.log, voids);
    expect(snapshot(log)).toEqual(snapshot(stock));
    const op = opWith(log, dinner.events[0]);
    expect(op.state).toBe("undone");
    expect(op.undoneBy?.map((v) => v.id).sort()).toEqual(voids.map((v) => v.id).sort());
    expect(snapshot([...log, ...redo(log, op)])).toEqual(snapshot(dinner.log));
  });

  it("changeConsumeQuantity", () => {
    const dinner = withDinner();
    const edit = ok(changeConsumeQuantity(dinner.pollo, { value: 150, estimated: false }, 1000, ctx(LATER)));
    expect(edit.events.map((e) => e.type)).toEqual(["void", "consume"]);
    const { redone } = expectUndoable(dinner.log, edit.events);
    expect(left(redone, "pollo")).toBe(850);
  });

  it("removeConsume: un gruppo di soli annullamenti; il pasto risulta «corretto dopo»", () => {
    const dinner = withDinner();
    const log = expectVoidOnly(dinner.log, ok(removeConsume(dinner.pollo, dinner.log, ctx(LATER))).events);
    expect(left(log, "pollo")).toBe(1000);
    const op = opWith(log, dinner.events[0]);
    expect([op.state, op.changedAt]).toEqual(["changed", LATER]);
    expect(reasonOf(undoOperation(op, log, derivePantry(log), ctx(NIGHT)))).toBe("Ne è stata tolta una parte dopo, alle 21:10: non si annulla più da qui.");
  });

  it("changeItem, removeItem, rewriteMeal, appendItems", () => {
    const dinner = withDinner();
    for (const edit of [
      changeItem(dinner.mealId, 0, { quantity: q(60) }, dinner.log, ctx(LATER)),
      removeItem(dinner.mealId, 0, dinner.log, ctx(LATER)),
      rewriteMeal(dinner.mealId, { kind: "lunch", minutes: 13 * 60 }, dinner.log, ctx(LATER)),
      appendItems(dinner.mealId, [{ name: "Mela", quantity: q(1, "pz"), certainty: "estimated" }], dinner.log, ctx(LATER)),
    ]) {
      const events = ok(edit).events;
      expect(events.map((e) => e.type)).toEqual(["void", "meal"]);
      const { redone } = expectUndoable(dinner.log, events);
      expect(opWith(redone, dinner.events[0]).state).toBe("changed");
      expect(mealsOf(redone).map((m) => m.pantryConsumes.length)).toEqual([3]);
    }
  });

  it("moveItem: verso un momento vuoto e verso un pasto che c'è già", () => {
    const dinner = withDinner();
    const toEmpty = ok(moveItem(dinner.mealId, 0, { kind: "lunch" }, dinner.log, diaryOf(dinner.log), ctx(LATER)));
    expect(toEmpty.events.map((e) => e.type)).toEqual(["void", "meal", "meal"]);
    expectUndoable(dinner.log, toEmpty.events);

    const lunch = ok(buildMealEvents({ kind: "lunch", picks: [], freeItems: [{ name: "Riso", quantityText: "150 g" }] }, ctx(NOON)));
    const log0 = [...dinner.log, ...lunch.events];
    const toMeal = ok(moveItem(dinner.mealId, 0, { kind: "lunch" }, log0, diaryOf(log0), ctx(LATER)));
    expect(toMeal.events.map((e) => e.type)).toEqual(["void", "void", "meal", "meal"]);
    const { redone } = expectUndoable(log0, toMeal.events);
    expect(opWith(redone, lunch.events[0]).state).toBe("changed");
  });

  it("buildAppendToMeal: con una voce libera e con il solo alimento della dispensa", () => {
    const lunch = ok(buildMealEvents({ kind: "lunch", picks: [], freeItems: [{ name: "Riso", quantityText: "150 g" }] }, ctx(NOON)));
    const log0 = [...stock, ...lunch.events];
    const both = ok(
      buildAppendToMeal(
        { mealId: lunch.mealId, picks: [{ lot: lotOf(log0, "insalata"), choice: { kind: "text", text: "50 g" } }], freeItems: [{ name: "Pane", quantityText: "40 g" }], log: log0 },
        ctx(LUNCH),
      ),
    );
    expect(both.events.map((e) => e.type)).toEqual(["void", "meal", "consume"]);
    expectUndoable(log0, both.events);

    const pick = ok(buildAppendToMeal({ mealId: lunch.mealId, picks: [{ lot: lotOf(log0, "insalata"), choice: { kind: "all" } }], freeItems: [], log: log0 }, ctx(LUNCH)));
    expect(pick.events.map((e) => e.type)).toEqual(["consume"]);
    expectUndoable(log0, pick.events);
  });

  it("buildRepeatMeal", () => {
    const yesterday = withDinner(stock, "2026-11-15T19:00:00.000Z");
    const [meal] = mealsOf(yesterday.log);
    const names = new Map(derivePantry(yesterday.log).lots.map((l) => [l.lotId, l.productRef]));
    const lots = derivePantry(yesterday.log).lots.filter((l) => l.remaining > 0);
    const r = buildRepeatMeal({ meal, names, lots }, ctx(DINNER));
    expect(r.events.map((e) => e.type)).toEqual(["meal", "consume", "consume", "consume"]);
    const { redone } = expectUndoable(yesterday.log, r.events);
    expect(left(redone, "pollo")).toBe(600);
  });
});

describe("quando non si può, lo dice e non scrive", () => {
  it("3. un acquisto già in parte mangiato: il motivo è quello del registro della dispensa", () => {
    const latte = purchase("p-latte", "2026-11-15T08:00:00.000Z", { deviceId: "A", lotId: "latte", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo" });
    const log0 = [...stock, latte];
    expect(commandBlock(opWith(log0, latte), log0, derivePantry(log0), { now: NIGHT })).toBeUndefined();
    const eaten = ok(buildConsume(lotOf(log0, "latte"), { kind: "value", value: 200 }, ctx(LUNCH)));
    const log = [...log0, ...eaten.events];
    const op = opWith(log, latte);
    expect(op.state).toBe("active");
    const reason = "Questo alimento ha già altri movimenti: toglili prima, poi potrai togliere l'ingresso.";
    expect(commandBlock(op, log, derivePantry(log), { now: NIGHT })).toBe(reason);
    expect(undoOperation(op, log, derivePantry(log), ctx(NIGHT))).toEqual({ ok: false, reason });
    // tolto il consumo, l'acquisto si annulla
    const cleared = [...log, ...undo(log, opWith(log, eaten.events[0]))];
    expect(undoOperation(opWith(cleared, latte), cleared, derivePantry(cleared), ctx(NIGHT)).ok).toBe(true);
  });

  it("4. quantità corretta due volte: la prima correzione è «corretta dopo», la seconda vale; annullata la seconda, la prima torna a valere", () => {
    const dinner = withDinner();
    const first = ok(changeConsumeQuantity(dinner.pollo, { value: 150, estimated: false }, 1000, ctx(LATER))).events;
    const log1 = [...dinner.log, ...first];
    const second = ok(changeConsumeQuantity(first[1] as ConsumeEvent, { value: 180, estimated: false }, 1000, ctx(NIGHT))).events;
    const log2 = [...log1, ...second];
    expect(left(log2, "pollo")).toBe(820);

    const states = (log: readonly AnyEvent[]) => [dinner.events[0], first[1], second[1]].map((e) => opWith(log, e).state);
    expect(states(log2)).toEqual(["changed", "changed", "active"]);
    expect(opWith(log2, first[1]).changedAt).toBe(NIGHT);
    expect(reasonOf(undoOperation(opWith(log2, first[1]), log2, derivePantry(log2), ctx("2026-11-16T21:30:00.000Z")))).toBe(
      "È stata corretta dopo: annulla prima la correzione delle 22:00.",
    );
    expect(reasonOf(undoOperation(opWith(log2, dinner.events[0]), log2, derivePantry(log2), ctx("2026-11-17T08:00:00.000Z")))).toBe(
      "È stata corretta dopo: annulla prima la correzione del 16 nov 2026, alle 22:00.",
    );

    const log3 = [...log2, ...undo(log2, opWith(log2, second[1]), "2026-11-16T21:30:00.000Z")];
    expect(states(log3)).toEqual(["changed", "active", "undone"]);
    expect(snapshot(log3)).toEqual(snapshot(log1));
    const log4 = [...log3, ...undo(log3, opWith(log3, first[1]), "2026-11-16T21:40:00.000Z")];
    expect(states(log4)).toEqual(["active", "undone", "undone"]);
    expect(snapshot(log4)).toEqual(snapshot(dinner.log));
    // rifatta la seconda (la più recente): vale lei, una volta sola; la prima, più vecchia, non si rifà sopra di lei
    const log5 = [...log4, ...redo(log4, opWith(log4, second[1]), "2026-11-16T21:50:00.000Z")];
    expect(left(log5, "pollo")).toBe(820);
    expect(mealsOf(log5)[0].pantryConsumes.filter((c) => c.lotId === "pollo").map((c) => c.quantity.value)).toEqual([180]);
    expect(states(log5)).toEqual(["changed", "changed", "active"]);
    expect(redoOperation(opWith(log5, first[1]), log5, derivePantry(log5), ctx("2026-11-16T22:00:00.000Z")).ok).toBe(false);
    const log6 = [...log5, ...undo(log5, opWith(log5, second[1]), "2026-11-16T22:00:00.000Z")];
    expect(snapshot(log6)).toEqual(snapshot(dinner.log));
    const log7 = [...log6, ...undo(log6, opWith(log6, dinner.events[0]), "2026-11-16T22:10:00.000Z")];
    expect(snapshot(log7)).toEqual(snapshot(stock));
  });

  it("5. buttato per sbaglio: «Annulla» lo riporta in dispensa, «Rifai» lo butta di nuovo", () => {
    const thrown = ok(buildDiscard(lotOf(stock, "yogurt"), { kind: "all" }, "expired", ctx(NOON))).events as AnyEvent[];
    const log = [...stock, ...thrown];
    expect(lotOf(log, "yogurt").status).toBe("finished");
    const undone = [...log, ...undo(log, opWith(log, thrown[0]))];
    expect([left(undone, "yogurt"), lotOf(undone, "yogurt").status, lotOf(undone, "yogurt").discarded]).toEqual([125, "active", 0]);
    const redone = [...undone, ...redo(undone, opWith(undone, thrown[0]))];
    expect([left(redone, "yogurt"), lotOf(redone, "yogurt").status, lotOf(redone, "yogurt").discarded]).toEqual([0, "finished", 125]);
    // e ancora: annulla, rifai
    const twice = [...redone, ...undo(redone, opWith(redone, thrown[0]), "2026-11-16T22:00:00.000Z")];
    expect(left(twice, "yogurt")).toBe(125);
    expect(opWith(twice, thrown[0]).undoneBy).toHaveLength(1);
    expect(left([...twice, ...redo(twice, opWith(twice, thrown[0]), "2026-11-16T22:10:00.000Z")], "yogurt")).toBe(0);
  });

  it("6. «Rifai» di un consumo quando l'alimento è stato eliminato, o è finito: non si può, e lo dice", () => {
    const eaten = eat(stock, "yogurt", 100, LUNCH);
    const undone = [...eaten.log, ...undo(eaten.log, opWith(eaten.log, eaten.consume), LATER)];

    const removed = [...undone, ...(ok(buildRemoveMistaken(lotOf(undone, "yogurt"), undone, derivePantry(undone).voidedEventIds, ctx(NIGHT))).events as AnyEvent[])];
    const r = redoOperation(opWith(removed, eaten.consume), removed, derivePantry(removed), ctx("2026-11-16T22:00:00.000Z"));
    expect(r).toEqual({ ok: false, reason: "Non si può rifare: l'alimento non c'è più." });

    const finished = [...undone, ...ok(buildConsume(lotOf(undone, "yogurt"), { kind: "all" }, ctx(NIGHT))).events];
    expect(redoOperation(opWith(finished, eaten.consume), finished, derivePantry(finished), ctx("2026-11-16T22:00:00.000Z"))).toEqual({
      ok: false,
      reason: "Non si può rifare: non ne resta abbastanza.",
    });
  });

  it("un pasto registrato a cui dopo si è aggiunto un alimento della dispensa: prima si toglie l'aggiunta", () => {
    const dinner = withDinner();
    const added = eat(dinner.log, "yogurt", 125, LATER);
    expect(added.consume.mealId).toBe(dinner.mealId);
    const op = opWith(added.log, dinner.events[0]);
    expect(op.state).toBe("active");
    expect(undoOperation(op, added.log, derivePantry(added.log), ctx(NIGHT))).toEqual({ ok: false, reason: "Prima togli ciò che hai aggiunto dopo a questo pasto." });
    const cleared = [...added.log, ...undo(added.log, opWith(added.log, added.consume))];
    expect(snapshot([...cleared, ...undo(cleared, opWith(cleared, dinner.events[0]), "2026-11-16T22:00:00.000Z")])).toEqual(snapshot(stock));
  });

  it("due «Mangiato» nello stesso momento: annullare il primo toglie solo il suo consumo, il contenitore del momento resta", () => {
    const first = eat(stock, "pollo", 275, LUNCH);
    const second = eat(first.log, "insalata", 50, "2026-11-16T12:13:00.000Z");
    expect(second.events.map((e) => e.type)).toEqual(["consume"]);
    const voids = undo(second.log, opWith(second.log, first.consume));
    expect(voids.map((v) => v.targetEventId)).toEqual([first.consume.id]);
    const undone = [...second.log, ...voids];
    expect(left(undone, "pollo")).toBe(1000);
    expect(mealsOf(undone).map((m) => m.pantryConsumes.map((c) => c.lotId))).toEqual([["insalata"]]);
    expect(deriveDiary(undone).anomalies).toEqual([]);
    const op = opWith(undone, first.consume);
    expect(op.state).toBe("undone");
    const redone = [...undone, ...redo(undone, op)];
    expect(snapshot(redone)).toEqual(snapshot(second.log));

    // tolto anche il secondo, e poi rifatto il primo: il pasto c'è ancora, niente resta orfano
    const both = [...undone, ...undo(undone, opWith(undone, second.consume), "2026-11-16T22:00:00.000Z")];
    expect(snapshot(both)).toEqual(snapshot(stock));
    expect(snapshot([...both, ...redo(both, opWith(both, first.consume), "2026-11-16T22:10:00.000Z")])).toEqual(snapshot(first.log));
  });

  it("«Rifai» di un consumo il cui pasto non c'è più: non lascia un consumo senza pasto", () => {
    const first = eat(stock, "pollo", 275, LUNCH);
    const second = eat(first.log, "insalata", 50, "2026-11-16T12:13:00.000Z");
    const a = [...second.log, ...undo(second.log, opWith(second.log, second.consume), LATER)];
    const b = [...a, ...undo(a, opWith(a, first.consume), NIGHT)];
    expect(snapshot(b)).toEqual(snapshot(stock));
    expect(redoOperation(opWith(b, second.consume), b, derivePantry(b), ctx("2026-11-16T22:00:00.000Z"))).toEqual({ ok: false, reason: "Non si può rifare: il pasto non c'è più." });
    const c = [...b, ...redo(b, opWith(b, first.consume), "2026-11-16T22:00:00.000Z")];
    expect(snapshot([...c, ...redo(c, opWith(c, second.consume), "2026-11-16T22:10:00.000Z")])).toEqual(snapshot(second.log));
  });

  it("«Rifai» non fa rivivere un consumo sostituito da una correzione venuta dopo", () => {
    const dinner = withDinner();
    const first = ok(changeConsumeQuantity(dinner.pollo, { value: 150, estimated: false }, 1000, ctx(LATER))).events;
    const log1 = [...dinner.log, ...first];
    const log2 = [...log1, ...undo(log1, opWith(log1, first[1]), NIGHT)];
    // ora il consumo è di nuovo quello del pasto: lo si corregge un'altra volta
    const second = ok(changeConsumeQuantity(dinner.pollo, { value: 120, estimated: false }, 1000, ctx("2026-11-16T22:00:00.000Z"))).events;
    const log3 = [...log2, ...second];
    expect(left(log3, "pollo")).toBe(880);
    const op = opWith(log3, first[1]);
    expect(op.state).toBe("undone");
    expect(redoOperation(op, log3, derivePantry(log3), ctx("2026-11-16T22:10:00.000Z"))).toEqual({ ok: false, reason: "Non si può rifare: nel frattempo è stata corretta di nuovo." });
  });

  it("una bevanda con la dispensa scalata: prima si annulla lo scalato; e lo scalato non si rifà senza la bevanda", () => {
    const tea = purchase("p-te", BOUGHT, { deviceId: "A", lotId: "te", productRef: "Tè verde", quantity: q(40), location: "dispensa" });
    const base = [...stock, tea];
    const drink = buildDrink({ name: "Tè", ml: 200 }, { ...ctx(NOON), timeZone: TZ });
    const log1 = [...base, ...drink.events];
    const dose = { quantity: { value: 2, unit: "g" as const }, certainty: "estimated" as const, text: "circa 2 g" };
    const scaled = ok(buildDrinkConsume({ lot: lotOf(log1, "te"), dose }, drink.events[0].id, ctx(LUNCH)));
    const log2 = [...log1, ...scaled.events];
    expect(left(log2, "te")).toBe(38);
    expectUndoable(log1, scaled.events);

    expect(undoOperation(opWith(log2, drink.events[0]), log2, derivePantry(log2), ctx(NIGHT))).toEqual({
      ok: false,
      reason: "Prima annulla ciò che hai scalato dalla dispensa per questa bevanda.",
    });
    const log3 = [...log2, ...undo(log2, opWith(log2, scaled.events[0]), LATER)];
    const log4 = [...log3, ...undo(log3, opWith(log3, drink.events[0]), NIGHT)];
    expect(snapshot(log4)).toEqual(snapshot(base));
    expect(redoOperation(opWith(log4, scaled.events[0]), log4, derivePantry(log4), ctx("2026-11-16T22:00:00.000Z"))).toEqual({
      ok: false,
      reason: "Non si può rifare: la bevanda non c'è più.",
    });
    const log5 = [...log4, ...redo(log4, opWith(log4, drink.events[0]), "2026-11-16T22:00:00.000Z")];
    expect(snapshot([...log5, ...redo(log5, opWith(log5, scaled.events[0]), "2026-11-16T22:10:00.000Z")])).toEqual(snapshot(log2));

    // «Togli» dal diario le annulla insieme: tutte e due risultano annullate
    const entry = diaryOf(log2).days[0].drinks[0] as DiaryDrink;
    const removed = [...log2, ...removeDrink(entry, linkedConsumes(entry.eventId, log2, derivePantry(log2).voidedEventIds), { ...ctx("2026-11-16T22:30:00.000Z"), timeZone: TZ }).events];
    expect([opWith(removed, drink.events[0]).state, opWith(removed, scaled.events[0]).state]).toEqual(["undone", "undone"]);
    expect(snapshot(removed)).toEqual(snapshot(base));
  });

  it("un evento che vale finché non ne arriva uno più recente (pasto abituale rinominato): il vecchio è «corretto dopo»", () => {
    const first = ok(buildMealEvents({ kind: "lunch", picks: [], freeItems: [{ name: "Riso", quantityText: "150 g" }], saveHabitAs: "Riso" }, ctx(NOON)));
    const habit = first.events.find((e) => e.type === "habit") as Extract<AnyEvent, { type: "habit" }>;
    const renamed = { ...habit, id: nextId(), title: "Riso in bianco", recordedAt: LATER, at: LATER } as AnyEvent;
    const log = [...stock, ...first.events, renamed];
    expect(opWith(log, habit).state).toBe("changed");
    expect(opWith(log, renamed).state).toBe("active");
    const undone = [...log, ...undo(log, opWith(log, renamed))];
    expect(diaryOf(undone).habits.map((h) => h.title)).toEqual(["Riso"]);
    expect(opWith(undone, habit).state).toBe("active");
  });

  it("le conferme sugli allergeni non si annullano né si rifanno da qui", () => {
    const confirm = { id: nextId(), type: "allergenConfirmation", at: NOON, recordedAt: NOON, deviceId: "A", schemaVersion: 1, certainty: "measured", source: "manual", action: "confirm", key: "k", ingredient: "Salsa", allergens: ["latte"] } as AnyEvent;
    expect(validateAnyEvent(confirm)).toEqual([]);
    const log = [...stock, confirm];
    expect(undoOperation(opWith(log, confirm), log, derivePantry(log), ctx(NIGHT))).toEqual({ ok: false, reason: "Le conferme sugli allergeni non si annullano da qui." });
  });

  it("annullare non toglie mai un allergene dichiarato nel piano", () => {
    const structure = (id: string, at: string, allergens: string[]) =>
      ({ id, type: "planStructure", at, recordedAt: at, deviceId: "A", schemaVersion: 1, certainty: "measured", source: "manual", meals: [{ kind: "lunch" }], allergens }) as AnyEvent;
    const before = structure("s-1", NOON, ["latte"]);
    const widened = structure("s-2", LUNCH, ["latte", "arachidi"]);
    expect(validateAnyEvent(widened)).toEqual([]);
    const log = [...stock, before, widened];
    expect(undoOperation(opWith(log, widened), log, derivePantry(log), ctx(NIGHT))).toEqual({ ok: false, reason: "Toglierebbe un allergene o un'esclusione: cambiali dal Piano." });
    // una struttura che ne toglie uno, invece, si annulla: gli allergeni tornano di più
    const narrowed = structure("s-3", LATER, []);
    const log2 = [...log, narrowed];
    expect(undoOperation(opWith(log2, narrowed), log2, derivePantry(log2), ctx(NIGHT)).ok).toBe(true);
  });
});

describe("due telefoni", () => {
  /** A registra la cena; poi, senza sincronizzarsi, tutti e due correggono il pollo: B a 150 g, A (più tardi) a 180 g. */
  function twoCorrections() {
    const dinner = withDinner();
    const fromB = ok(changeConsumeQuantity(dinner.pollo, { value: 150, estimated: false }, 1000, ctx(LATER, "B"))).events;
    const fromA = ok(changeConsumeQuantity(dinner.pollo, { value: 180, estimated: false }, 1000, ctx(NIGHT, "A"))).events;
    const merged = mergeAllEvents([...dinner.log, ...fromA], [...dinner.log, ...fromB]).events;
    return { dinner, fromA, fromB, merged };
  }

  const counting = (log: readonly AnyEvent[], lotId: string) => {
    const voided = new Set(derivePantry(log).voidedEventIds);
    return log.filter((e): e is ConsumeEvent => e.type === "consume" && e.lotId === lotId && !voided.has(e.id)).map((c) => c.quantity.value);
  };

  it("due correzioni dello stesso consumo: vale la più recente, l'altra è «corretta dopo»; annullata quella, vale l'altra", () => {
    const { dinner, fromA, fromB, merged } = twoCorrections();
    expect(counting(merged, "pollo")).toEqual([180]);
    const states = (log: readonly AnyEvent[]) => [dinner.events[0], fromB[1], fromA[1]].map((e) => opWith(log, e).state);
    expect(states(merged)).toEqual(["changed", "changed", "active"]);
    expect(undoOperation(opWith(merged, fromB[1]), merged, derivePantry(merged), ctx("2026-11-16T22:00:00.000Z", "B")).ok).toBe(false);

    // B annulla la correzione di A: conta la sua, una volta sola
    const voids = undo(merged, opWith(merged, fromA[1]), "2026-11-16T22:00:00.000Z", "B");
    const undone = [...merged, ...voids];
    expect(counting(undone, "pollo")).toEqual([150]);
    expect(left(undone, "pollo")).toBe(850);
    expect(states(undone)).toEqual(["changed", "active", "undone"]);
    expect(snapshot(undone)).toEqual(snapshot([...dinner.log, ...fromB]));

    // e la rifà
    const redone = [...undone, ...redo(undone, opWith(undone, fromA[1]), "2026-11-16T22:10:00.000Z", "B")];
    expect(counting(redone, "pollo")).toEqual([180]);
    expect(snapshot(redone)).toEqual(snapshot(merged));

    // annullate tutte e due le correzioni, torna il consumo del pasto; poi il pasto si annulla per intero
    const none = [...undone, ...undo(undone, opWith(undone, fromB[1]), "2026-11-16T22:20:00.000Z", "A")];
    expect(counting(none, "pollo")).toEqual([200]);
    expect(snapshot(none)).toEqual(snapshot(dinner.log));
    expect(snapshot([...none, ...undo(none, opWith(none, dinner.events[0]), "2026-11-16T22:30:00.000Z", "A")])).toEqual(snapshot(stock));

    for (const [name, log] of Object.entries({ undone, redone, none })) {
      const expected = snapshot(log);
      const ops = opsOf(log);
      for (const seed of [11, 12, 13, 14, 15, 16]) {
        const mixed = shuffled(log, seededRandom(seed));
        expect(snapshot(mixed), name).toEqual(expected);
        expect(opsOf(mixed), name).toEqual(ops);
      }
    }
  });

  it("gli annullamenti arrivano prima degli eventi che annullano: il risultato è lo stesso", () => {
    const { fromA, merged } = twoCorrections();
    const voids = undo(merged, opWith(merged, fromA[1]), "2026-11-16T22:00:00.000Z", "B");
    const expected = snapshot([...merged, ...voids]);
    expect(snapshot([...voids, ...[...merged].reverse()])).toEqual(expected);
    expect(snapshot(mergeAllEvents(voids, merged).events)).toEqual(expected);
  });

  it("un sostituto arrivato senza il suo annullamento: annullando il pasto si annulla tutta la famiglia, niente ricompare", () => {
    const dinner = withDinner();
    // l'orologio di B è indietro: la sua correzione risulta registrata prima del consumo che corregge
    const fromB = ok(changeConsumeQuantity(dinner.pollo, { value: 150, estimated: false }, 1000, ctx("2026-11-16T18:00:00.000Z", "B"))).events;
    const stray = fromB[1] as ConsumeEvent;
    const log = [...dinner.log, stray];
    expect(supersededConsumes(log, new Set()).has(stray.id)).toBe(true);
    const op = opWith(log, dinner.events[0]);
    expect(op.state).toBe("active");
    const voids = undo(log, op);
    expect(voids.map((v) => v.targetEventId)).toContain(stray.id);
    const undone = [...log, ...voids];
    expect(left(undone, "pollo")).toBe(1000);
    expect(snapshot(undone)).toEqual(snapshot(stock));
    // anche quando poi arriva l'annullamento che mancava
    expect(snapshot([...undone, fromB[0]])).toEqual(snapshot(stock));
    expect(snapshot([...undone, ...redo(undone, opWith(undone, dinner.events[0]))])).toEqual(snapshot(log));
  });

  it("A annulla il pasto mentre B, non ancora sincronizzato, ne corregge una voce: la correzione di B si annulla e non resta niente", () => {
    const dinner = withDinner();
    const undoneOnA = [...dinner.log, ...undo(dinner.log, opWith(dinner.log, dinner.events[0]), LATER, "A")];
    const fromB = ok(changeConsumeQuantity(dinner.pollo, { value: 150, estimated: false }, 1000, ctx(NIGHT, "B"))).events;
    const merged = mergeAllEvents(undoneOnA, [...dinner.log, ...fromB]).events;
    // il consumo di B conta, ma il suo pasto è annullato: il pasto non è più «annullato per intero»
    expect(left(merged, "pollo")).toBe(850);
    expect(opWith(merged, dinner.events[0]).state).toBe("changed");
    const cleared = [...merged, ...undo(merged, opWith(merged, fromB[1]), "2026-11-16T22:00:00.000Z", "A")];
    expect(snapshot(cleared)).toEqual(snapshot(stock));
    for (const seed of [21, 22, 23]) expect(snapshot(shuffled(cleared, seededRandom(seed)))).toEqual(snapshot(stock));
  });

  it("A annulla un acquisto mentre B ne mangia: «Rifai» dell'acquisto rimette a posto anche il consumo di B", () => {
    const latte = purchase("p-latte", "2026-11-15T08:00:00.000Z", { deviceId: "A", lotId: "latte", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo" });
    const base = [...stock, latte];
    const onA = [...base, ...undo(base, opWith(base, latte), LATER, "A")];
    const onB = eat(base, "latte", 200, NIGHT, "B").log;
    const merged = mergeAllEvents(onA, onB).events;
    expect(derivePantry(merged).anomalies.map((x) => x.code)).toEqual(["unknown_lot"]);
    const redone = [...merged, ...redo(merged, opWith(merged, latte), "2026-11-16T22:00:00.000Z", "B")];
    expect(derivePantry(redone).anomalies).toEqual([]);
    expect(snapshot(redone)).toEqual(snapshot(onB));
  });

  it("molte azioni su due telefoni, in ordine casuale: annulla e rifai non contano mai due volte e non lasciano niente a metà", () => {
    for (const seed of [101, 404, 606]) {
      const random = seededRandom(seed);
      const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)];
      const logs: Record<"A" | "B", AnyEvent[]> = { A: [...stock], B: [...stock] };
      let clock = Date.parse(NOON);
      const kinds: MealKind[] = ["breakfast", "lunch", "dinner", "snack"];

      for (let step = 0; step < 50; step++) {
        const device = random() < 0.5 ? "A" : "B";
        const log = logs[device];
        clock += 2000 + Math.floor(random() * 600_000);
        const now = new Date(clock).toISOString();
        const c = ctx(now, device);
        const pantry = derivePantry(log);
        const diary = diaryOf(log);
        const lots = pantry.lots.filter((l) => l.remaining > 1);
        const voided = new Set(pantry.voidedEventIds);
        const eaten = log.filter((e): e is ConsumeEvent => e.type === "consume" && !voided.has(e.id) && e.mealId !== undefined);
        const write = (events: readonly AnyEvent[]) => {
          expect(events.every((e) => validateAnyEvent(e).length === 0)).toBe(true);
          log.push(...events);
        };

        const roll = random();
        if (roll < 0.2 && lots.length > 0) {
          const lot = pick(lots);
          const r = buildEaten([lot], { kind: "value", value: Math.max(1, Math.floor(lot.remaining * random() * 0.5)) }, c, diary);
          if (r.ok) write(r.events);
        } else if (roll < 0.3 && lots.length > 1) {
          const r = buildMealEvents({ kind: pick(kinds), picks: lots.slice(0, 2).map((lot) => ({ lot, choice: { kind: "value", value: 1 } as const })), freeItems: [{ name: "Pane", quantityText: "40 g" }] }, c);
          if (r.ok) write(r.events);
        } else if (roll < 0.45 && eaten.length > 0) {
          const target = pick(eaten);
          const lot = pantry.lots.find((l) => l.lotId === target.lotId);
          const available = (lot?.remaining ?? 0) + target.quantity.value;
          const r = changeConsumeQuantity(target, { value: Math.max(1, Math.floor(available * random())), estimated: false }, available, c);
          if (r.ok) write(r.events);
        } else if (roll < 0.55 && eaten.length > 0) {
          const r = moveConsumes([pick(eaten)], diary, { ...c, timeZone: TZ }, { kind: pick(kinds) });
          if (r.ok) write(r.events);
        } else if (roll < 0.6 && eaten.length > 0) {
          const r = removeConsume(pick(eaten), log, c);
          if (r.ok) write(r.events);
        } else if (roll < 0.65 && lots.length > 0) {
          const r = buildDiscard(pick(lots), { kind: "half" }, "other", c);
          if (r.ok) write(r.events);
        } else if (roll < 0.7) {
          write([createWater({ ml: 200 }, factory(now, device))]);
        } else if (roll < 0.85) {
          const ops = opsOf(log);
          if (ops.length > 0) {
            const op = pick(ops);
            const before = snapshot(log);
            const r = op.state === "undone" ? redoOperation(op, log, pantry, c) : undoOperation(op, log, pantry, c);
            if (r.ok) {
              expect(r.events.every((e) => e.type === "void")).toBe(true);
              const after = snapshot([...log, ...r.events]);
              expect(after.pantryAnomalies.length).toBeLessThanOrEqual(before.pantryAnomalies.length);
              expect(after.diaryAnomalies.length).toBeLessThanOrEqual(before.diaryAnomalies.length);
              write(r.events);
            } else {
              expect(r.reason).not.toBe("");
            }
          }
        } else {
          const merged = mergeAllEvents(logs.A, logs.B).events;
          logs.A = [...merged];
          logs.B = [...merged];
        }
      }

      const merged = mergeAllEvents(logs.A, logs.B).events;
      const base = snapshot(merged);
      const ops = opsOf(merged);
      const mixed = shuffled(merged, random);
      expect(snapshot(mixed)).toEqual(base);
      expect(opsOf(mixed)).toEqual(ops);

      const orphans = (log: readonly AnyEvent[]) => {
        const live = new Set(mealsOf(log).map((m) => m.mealId));
        const dead = new Set(derivePantry(log).voidedEventIds);
        const meals = new Set(log.filter((e) => e.type === "meal" && !new Set(diaryOf(log).voidedEventIds).has(e.id)).map((e) => (e as { mealId: string }).mealId));
        return log.filter((e) => e.type === "consume" && !dead.has(e.id) && e.mealId !== undefined && !live.has(e.mealId) && !meals.has(e.mealId)).length;
      };

      let tried = 0;
      let rounds = 0;
      const pantry = derivePantry(merged);
      for (const op of ops) {
        const c = ctx(new Date(clock + 3_600_000).toISOString(), random() < 0.5 ? "A" : "B");
        if (op.state === "changed") {
          expect(undoOperation(op, merged, pantry, c).ok).toBe(false);
          expect(redoOperation(op, merged, pantry, c).ok).toBe(false);
          continue;
        }
        const first = op.state === "undone" ? redoOperation(op, merged, pantry, c) : undoOperation(op, merged, pantry, c);
        expect(commandBlock(op, merged, pantry, c) === undefined || !first.ok).toBe(true);
        if (!first.ok) continue;
        tried++;
        const next = [...merged, ...first.events];
        const after = snapshot(next);
        expect(after.pantryAnomalies.length).toBeLessThanOrEqual(base.pantryAnomalies.length);
        expect(after.diaryAnomalies.length).toBeLessThanOrEqual(base.diaryAnomalies.length);
        expect(orphans(next)).toBeLessThanOrEqual(orphans(merged));
        expect(snapshot(shuffled(next, random))).toEqual(after);
        const flipped = opWith(next, op);
        expect(flipped.state).toBe(op.state === "undone" ? "active" : "undone");

        // e indietro
        const c2 = ctx(new Date(clock + 7_200_000).toISOString(), "A");
        const back = flipped.state === "undone" ? redoOperation(flipped, next, derivePantry(next), c2) : undoOperation(flipped, next, derivePantry(next), c2);
        if (!back.ok) {
          // si rifiuta solo di ricreare un'anomalia che c'era già prima (due telefoni che mangiano lo stesso alimento)
          expect(after.pantryAnomalies.length + after.diaryAnomalies.length, `seme ${seed}: ${back.reason}`).toBeLessThan(base.pantryAnomalies.length + base.diaryAnomalies.length);
          continue;
        }
        const round = [...next, ...back.events];
        const ended = snapshot(round);
        expect(snapshot(shuffled(round, random))).toEqual(ended);
        expect(ended.pantryAnomalies.length).toBeLessThanOrEqual(after.pantryAnomalies.length);
        expect(ended.diaryAnomalies.length).toBeLessThanOrEqual(after.diaryAnomalies.length);
        if (op.state === "active") {
          // annulla e poi rifai: lo stato derivato è esattamente quello di partenza
          rounds++;
          expect(ended).toEqual(base);
        } else {
          // un'azione che risultava annullata (anche da un «Togli»): rifatta e riannullata, si rifà uguale
          const c3 = ctx(new Date(clock + 10_800_000).toISOString(), "B");
          const again = redoOperation(opWith(round, op), round, derivePantry(round), c3);
          if (again.ok) expect(snapshot([...round, ...again.events])).toEqual(after);
        }
      }
      expect(tried).toBeGreaterThan(3);
      expect(rounds).toBeGreaterThan(2);
    }
  }, 120_000);
});

describe("«Rifai» riporta a subito prima dell'ultimo «Annulla»", () => {
  it("tolta una voce, poi tolto il pasto: «Rifai» rimette il pasto senza la voce tolta prima", () => {
    const dinner = withDinner();
    const removed = [...dinner.log, ...ok(removeConsume(dinner.pollo, dinner.log, ctx(LATER))).events];
    expect(left(removed, "pollo")).toBe(1000);
    const gone = [...removed, ...voidMeal(dinner.mealId, removed, factory(NIGHT))];
    expect(snapshot(gone)).toEqual(snapshot(stock));
    const op = opWith(gone, dinner.events[0]);
    expect(op.state).toBe("undone");
    // solo gli annullamenti dell'ultimo gruppo: quello che ha tolto il pollo resta in vigore
    expect(op.undoneBy).toHaveLength(3);
    const back = [...gone, ...redo(gone, op)];
    expect(snapshot(back)).toEqual(snapshot(removed));
    expect([left(back, "pollo"), left(back, "insalata"), left(back, "pasta")]).toEqual([1000, 150, 420]);
    expect(opWith(back, dinner.events[0]).state).toBe("changed");
  });

  it("due telefoni l'annullano ciascuno per conto suo: un solo «Rifai» la rimette", () => {
    const thrown = ok(buildDiscard(lotOf(stock, "yogurt"), { kind: "all" }, "expired", ctx(NOON))).events as AnyEvent[];
    const log = [...stock, ...thrown];
    const fromA = undo(log, opWith(log, thrown[0]), LATER, "A");
    const fromB = undo(log, opWith(log, thrown[0]), NIGHT, "B");
    const merged = mergeAllEvents([...log, ...fromA], [...log, ...fromB]).events;
    const op = opWith(merged, thrown[0]);
    expect([op.state, op.undoneBy?.length]).toEqual(["undone", 2]);
    const redone = [...merged, ...redo(merged, op, "2026-11-16T22:00:00.000Z")];
    expect(left(redone, "yogurt")).toBe(0);
    expect(opWith(redone, thrown[0]).state).toBe("active");
  });

  it("«Elimina dalla dispensa» tolto con un solo annullamento: «Rifai» su una delle sue righe le rimette tutte", () => {
    const latte = purchase("p-latte", "2026-11-12T08:00:00.000Z", { deviceId: "A", lotId: "latte", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo" });
    const base = [...stock, latte];
    const opened = ok(buildOpen(lotOf(base, "latte"), ctx(NOON))).events as AnyEvent[];
    const log0 = [...base, ...opened];
    const drunk = ok(buildConsume(lotOf(log0, "latte"), { kind: "value", value: 200 }, ctx(LUNCH))).events as AnyEvent[];
    const log = [...log0, ...drunk];
    const gone = [...log, ...(ok(buildRemoveMistaken(lotOf(log, "latte"), log, [], ctx(LATER))).events as AnyEvent[])];
    expect([latte, opened[0], drunk[0]].map((e) => opWith(gone, e).state)).toEqual(["undone", "undone", "undone"]);
    const back = [...gone, ...redo(gone, opWith(gone, drunk[0]))];
    expect(snapshot(back)).toEqual(snapshot(log));
    expect([latte, opened[0], drunk[0]].map((e) => opWith(back, e).state)).toEqual(["active", "active", "active"]);
  });

  it("sequenze casuali di «Togli», «Annulla» e «Rifai» su un pasto: dopo «Rifai» lo stato è quello di subito prima dell'ultimo «Annulla»", () => {
    let redone = 0;
    for (const seed of [7, 8, 9, 10, 11, 12, 13, 14]) {
      const random = seededRandom(seed);
      const stamped = seed % 2 === 0;
      const write = (events: readonly AnyEvent[]): AnyEvent[] => (stamped ? withOperationId(events, nextId()) : [...events]);
      const r = ok(
        buildMealEvents(
          {
            kind: "dinner",
            picks: ["pollo", "insalata", "pasta"].map((id) => ({ lot: lotOf(stock, id), choice: { kind: "text", text: "50 g" } as const })),
            freeItems: seed % 3 === 0 ? [{ name: "Pane", quantityText: "40 g" }] : [],
          },
          ctx(DINNER),
        ),
      );
      const meal = write(r.events);
      let log: AnyEvent[] = [...stock, ...meal];
      let clock = Date.parse(DINNER);
      /** Lo stato prima di ogni «Annulla» che ha cambiato qualcosa, dal più vecchio. */
      const before: ReturnType<typeof snapshot>[] = [];
      const annulla = (voids: readonly AnyEvent[]): void => {
        if (voids.length === 0) return;
        const was = snapshot(log);
        const next = [...log, ...write(voids)];
        // un «Annulla» che non cambia niente (tutto era già annullato) non è uno stato a cui tornare
        if (JSON.stringify(snapshot(next)) !== JSON.stringify(was)) before.push(was);
        log = next;
      };

      for (let step = 0; step < 30; step++) {
        clock += 60_000;
        const now = new Date(clock).toISOString();
        const op = opWith(log, meal[0]);
        const eaten = mealsOf(log).flatMap((m) => m.pantryConsumes);
        const roll = random();
        if (roll < 0.3 && eaten.length > 0) {
          const edit = removeConsume(eaten[Math.floor(random() * eaten.length)], log, ctx(now));
          if (edit.ok) annulla(edit.events);
        } else if (roll < 0.4) {
          annulla(voidMeal(r.mealId, log, factory(now)));
        } else if (roll < 0.5) {
          annulla(buildUndo(meal, ctx(now)));
        } else if (roll < 0.65) {
          const u = undoOperation(op, log, derivePantry(log), ctx(now));
          if (u.ok) annulla(u.events);
          else expect(op.state).not.toBe("active");
        } else {
          const u = redoOperation(op, log, derivePantry(log), ctx(now));
          if (!u.ok) {
            expect(op.state, u.reason).not.toBe("undone");
            continue;
          }
          expect(u.events.every((e) => e.type === "void")).toBe(true);
          log = [...log, ...write(u.events)];
          expect(snapshot(log), `seme ${seed}, passo ${step}`).toEqual(before.pop());
          redone++;
        }
        expect(derivePantry(log).anomalies).toEqual([]);
        expect(diaryOf(log).anomalies).toEqual([]);
      }
    }
    expect(redone).toBeGreaterThan(15);
  });
});

describe("ciò che l'elenco non mostra e ciò che non lascia a metà", () => {
  it("la migrazione dei codici a barre non è una riga, né con il segno né nei registri di prima; e segue il suo alimento", () => {
    const old = purchase("p-old", "2026-11-12T08:00:00.000Z", { deviceId: "A", lotId: "latte", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo", note: "Codice a barre 8001234567890" });
    const base = [...stock, old];
    const marked = legacyBarcodeUpdates(base, { now: NOON, deviceId: "A" }) as AnyEvent[];
    expect(marked.map((e) => [e.type, e.note])).toEqual([["updateLot", AUTOMATIC_NOTE]]);
    const unmarked = marked.map((e) => ({ ...e, note: undefined }) as AnyEvent);

    for (const migration of [marked, unmarked]) {
      const log = [...base, ...migration];
      expect(lotOf(log, "latte").barcode).toBe("8001234567890");
      expect(opsOf(log).map((o) => o.id)).toEqual(opsOf(base).map((o) => o.id));
      // l'acquisto si annulla lo stesso, e la migrazione va con lui; rifatto, il codice c'è ancora
      const op = opWith(log, old);
      expect(commandBlock(op, log, derivePantry(log), { now: NIGHT })).toBeUndefined();
      const voids = undo(log, op);
      expect(voids.map((v) => v.targetEventId).sort()).toEqual([old.id, migration[0].id].sort());
      const undone = [...log, ...voids];
      expect(snapshot(undone)).toEqual(snapshot(stock));
      expect(snapshot([...undone, ...redo(undone, opWith(undone, old))])).toEqual(snapshot(log));
    }
    // una correzione del codice fatta a mano resta una riga
    const byHand = correctLot(old, { barcode: "8076800195057" }, { lot: lotOf(base, "latte"), ...factory(NOON) }) as AnyEvent[];
    expect(opsOf([...base, ...byHand])[0].events.map((e) => e.id)).toEqual(byHand.map((e) => e.id));
  });

  it("una ricetta citata dal piano o da una preparazione non si annulla", () => {
    const recipe = recipeEvent("rc-1", "2026-11-14T08:00:00.000Z", { deviceId: "A", recipeId: "forno", title: "Pasta al forno" }) as AnyEvent;
    const reason = (log: readonly AnyEvent[]) => reasonOf(undoOperation(opWith(log, recipe), log, derivePantry(log), ctx(NIGHT)));
    const alone = [...stock, recipe];
    expect(reason(alone)).toBe("ok");

    const week = weekEv("pw-1", "2026-11-15T08:00:00.000Z", "2026-11-16", [plannedRecipe("2026-11-17", "dinner", "forno", 2)], { deviceId: "A" }) as AnyEvent;
    const planned = [...alone, week];
    expect(reason(planned)).toBe("La ricetta è usata nel piano.");
    // una settimana riscritta senza la ricetta non la cita più
    const rewritten = weekEv("pw-2", "2026-11-15T09:00:00.000Z", "2026-11-16", [], { deviceId: "A" }) as AnyEvent;
    expect(reason([...planned, rewritten])).toBe("ok");
    // e con una versione più recente della ricetta ne resta una valida: la prima però è «corretta dopo»
    const newer = recipeEvent("rc-2", "2026-11-15T10:00:00.000Z", { deviceId: "A", recipeId: "forno", title: "Pasta al forno, con besciamella" }) as AnyEvent;
    const twice = [...planned, newer];
    expect(opWith(twice, recipe).state).toBe("changed");
    expect(reasonOf(undoOperation(opWith(twice, newer), twice, derivePantry(twice), ctx(NIGHT)))).toBe("ok");

    const cooked = composePrep(
      { prepId: "prep-1", title: "Pasta al forno", recipeId: "forno", portions: 4, location: "frigo", ingredients: [{ lot: lotOf(alone, "pasta"), quantity: q(320) }] },
      { deviceId: "A", now: () => NOON, idGenerator: nextId },
    );
    if (!cooked.ok) throw new Error(JSON.stringify(cooked.errors));
    expect(reason([...alone, ...(cooked.events as AnyEvent[])])).toBe("La ricetta è usata in una preparazione.");
  });

  it("«Rifai» quando dell'alimento ne resta poco: dice che non ne resta abbastanza", () => {
    const thrown = ok(buildDiscard(lotOf(stock, "yogurt"), { kind: "all" }, "expired", ctx(NOON))).events as AnyEvent[];
    const log = [...stock, ...thrown];
    const undone = [...log, ...undo(log, opWith(log, thrown[0]), LATER)];
    const less = [...undone, ...ok(buildConsume(lotOf(undone, "yogurt"), { kind: "value", value: 100 }, ctx(NIGHT))).events];
    expect(left(less, "yogurt")).toBe(25);
    expect(redoOperation(opWith(less, thrown[0]), less, derivePantry(less), ctx("2026-11-16T22:00:00.000Z"))).toEqual({
      ok: false,
      reason: "Non si può rifare: non ne resta abbastanza.",
    });
  });

  it("«Rifai» di un consumo che dopo l'annullamento è stato segnato di nuovo a mano: non lo conta due volte", () => {
    const first = eat(stock, "pollo", 100, LUNCH);
    const undone = [...first.log, ...undo(first.log, opWith(first.log, first.consume), "2026-11-16T12:20:00.000Z")];
    const again = eat(undone, "pollo", 100, "2026-11-16T12:30:00.000Z");
    expect(left(again.log, "pollo")).toBe(900);
    expect(redoOperation(opWith(again.log, first.consume), again.log, derivePantry(again.log), ctx(LATER))).toEqual({
      ok: false,
      reason: "Non si può rifare: l'hai già segnato di nuovo.",
    });
    // una quantità diversa, o un altro momento, è un'altra cosa: si rifà
    const other = eat(undone, "pollo", 150, "2026-11-16T12:30:00.000Z");
    expect(left([...other.log, ...redo(other.log, opWith(other.log, first.consume), LATER)], "pollo")).toBe(750);
    const dinner = eat(undone, "pollo", 100, DINNER);
    expect(left([...dinner.log, ...redo(dinner.log, opWith(dinner.log, first.consume), LATER)], "pollo")).toBe(800);
  });

  it("annullare una correzione che lascerebbe la dispensa sotto zero: dice perché", () => {
    const eaten = eat(stock, "pollo", 300, LUNCH);
    const corrected = ok(buildQuantityCorrection({ lot: lotOf(eaten.log, "pollo"), creation: stock[0] as PurchaseEvent, remaining: 1100, log: eaten.log, ctx: ctx(LATER) })).events as AnyEvent[];
    const log1 = [...eaten.log, ...corrected];
    const log2 = [...log1, ...ok(buildConsume(lotOf(log1, "pollo"), { kind: "value", value: 1000 }, ctx(NIGHT))).events];
    expect(left(log2, "pollo")).toBe(100);
    expect(undoOperation(opWith(log2, corrected[1]), log2, derivePantry(log2), ctx("2026-11-16T22:00:00.000Z"))).toEqual({
      ok: false,
      reason: "Annullarla lascerebbe meno di zero: nel frattempo ne hai mangiato.",
    });
  });

  it("una conferma sugli allergeni non torna valida nemmeno attraverso una catena di annullamenti", () => {
    const confirm = { id: nextId(), type: "allergenConfirmation", at: NOON, recordedAt: NOON, deviceId: "A", schemaVersion: 1, certainty: "measured", source: "manual", action: "confirm", key: "k", ingredient: "Salsa", allergens: ["latte"] } as AnyEvent;
    const base = [...stock, confirm];
    // la conferma è stata tolta dentro una scrittura che contiene anche altro: annullare quella scrittura la rimetterebbe
    const mixed = withOperationId([...buildUndo([confirm], ctx(LUNCH)), createWater({ ml: 200 }, factory(LUNCH))], "op-mixed");
    const log = [...base, ...mixed];
    expect(opWith(log, mixed[1]).events).toHaveLength(2);
    expect(undoOperation(opWith(log, mixed[1]), log, derivePantry(log), ctx(NIGHT))).toEqual({ ok: false, reason: "Le conferme sugli allergeni non si annullano da qui." });
    expect(commandBlock(opWith(log, mixed[1]), log, derivePantry(log), { now: NIGHT })).toBe("Le conferme sugli allergeni non si annullano da qui.");
    // e una conferma tolta con un «Annulla» non si rifà
    const removed = [...base, ...buildUndo([confirm], ctx(LUNCH))];
    expect(opWith(removed, confirm).state).toBe("undone");
    expect(redoOperation(opWith(removed, confirm), removed, derivePantry(removed), ctx(NIGHT))).toEqual({ ok: false, reason: "Le conferme sugli allergeni non si annullano da qui." });
  });
});

/**
 * Come scrive `appendEvents`. «nuovo»: tutti gli eventi della chiamata ricevono lo stesso `opId`, anche chi ne portava
 * uno. «ereditato»: com'è stato per un periodo, e come resta nei registri già scritti: riceve l'`opId` solo chi non lo
 * ha, quindi un evento copiato da uno di prima si tiene quello dell'azione di prima.
 */
const WRITERS: Record<"nuovo" | "ereditato", (events: readonly AnyEvent[]) => AnyEvent[]> = {
  nuovo: (events) => stampOperationId(events, nextId()),
  ereditato: (events) => withOperationId(events, nextId()),
};
const MODES = ["nuovo", "ereditato"] as const;
const idsOf = (events: readonly AnyEvent[]): string[] => events.map((e) => e.id).sort();
const written = <E extends AnyEvent>(log: readonly AnyEvent[], e: Pick<AnyEvent, "id">): E => log.find((x) => x.id === e.id) as E;

/**
 * Due correzioni della stessa cosa, una dopo l'altra, ognuna scritta con una chiamata: due operazioni, ognuna con i suoi
 * eventi e nient'altro; la prima è «corretta dopo», la seconda si annulla; annullata la seconda la prima torna a valere
 * e si annulla anche lei; rifatte, tutto torna com'era. Dispensa e diario si controllano derivandoli.
 */
function expectTwoCorrections(
  mode: (typeof MODES)[number],
  log0: readonly AnyEvent[],
  first: (log: readonly AnyEvent[]) => readonly AnyEvent[],
  second: (log: readonly AnyEvent[], one: readonly AnyEvent[]) => readonly AnyEvent[],
): { log2: AnyEvent[]; one: AnyEvent[]; two: AnyEvent[] } {
  const write = WRITERS[mode];
  const one = write(first(log0));
  const log1 = [...log0, ...one];
  const two = write(second(log1, one));
  const log2 = [...log1, ...two];
  const fresh = (events: readonly AnyEvent[]) => events.find((e) => e.type !== "void") as AnyEvent;

  // nel registro di prima un evento copiato porta davvero l'`opId` di un'azione già scritta: è il difetto da leggere bene
  const earlier = new Set(log0.map(operationIdOf));
  const copied = [...one, ...two].filter((e) => e.type !== "void" && earlier.has(operationIdOf(e)));
  if (mode === "ereditato") expect(copied.length, "nessun evento con l'opId ereditato").toBeGreaterThanOrEqual(2);
  else expect(copied).toEqual([]);

  const [opOne, opTwo] = [opWith(log2, fresh(one)), opWith(log2, fresh(two))];
  expect(opOne.id).not.toBe(opTwo.id);
  expect(idsOf(opOne.events)).toEqual(idsOf(one));
  expect(idsOf(opTwo.events)).toEqual(idsOf(two));
  expect(opsOf(log2)).toHaveLength(opsOf(log0).length + 2);
  expect(opsOf(log0).map((o) => idsOf(opWith(log2, o).events))).toEqual(opsOf(log0).map((o) => idsOf(o.events)));
  expect([opOne.state, opTwo.state]).toEqual(["changed", "active"]);
  expect(commandBlock(opTwo, log2, derivePantry(log2), { now: NIGHT })).toBeUndefined();
  expect(commandBlock(opOne, log2, derivePantry(log2), { now: NIGHT })).toMatch(/corretta dopo: annulla prima la correzione/);
  for (const seed of [1, 2, 3]) {
    const mixed = shuffled(log2, seededRandom(seed));
    expect(opsOf(mixed).map((o) => [o.id, o.state, idsOf(o.events)])).toEqual(opsOf(log2).map((o) => [o.id, o.state, idsOf(o.events)]));
  }

  const at = (minutes: number) => new Date(Date.parse("2026-11-16T22:00:00.000Z") + minutes * 60_000).toISOString();
  const log3 = [...log2, ...write(undo(log2, opTwo, at(0)))];
  expect(snapshot(log3)).toEqual(snapshot(log1));
  expect([opWith(log3, fresh(one)).state, opWith(log3, fresh(two)).state]).toEqual(["active", "undone"]);
  expect(commandBlock(opWith(log3, fresh(one)), log3, derivePantry(log3), { now: at(1) })).toBeUndefined();
  const log4 = [...log3, ...write(undo(log3, opWith(log3, fresh(one)), at(10)))];
  expect(snapshot(log4)).toEqual(snapshot(log0));
  const log5 = [...log4, ...write(redo(log4, opWith(log4, fresh(one)), at(20)))];
  expect(snapshot(log5)).toEqual(snapshot(log1));
  const log6 = [...log5, ...write(redo(log5, opWith(log5, fresh(two)), at(30)))];
  expect(snapshot(log6)).toEqual(snapshot(log2));
  expect([opWith(log6, fresh(one)).state, opWith(log6, fresh(two)).state]).toEqual(["changed", "active"]);
  expect(derivePantry(log6).anomalies).toEqual([]);
  expect(diaryOf(log6).anomalies).toEqual([]);
  return { log2, one, two };
}

describe("ogni scrittura ha il suo identificativo: due correzioni di seguito sono due operazioni", () => {
  /** Gli acquisti e una cena, scritti ognuno con una chiamata. */
  function dinnerWritten(mode: (typeof MODES)[number]) {
    const write = WRITERS[mode];
    const dinner = withDinner();
    const log0 = [...write(stock), ...write(dinner.events)];
    return { log0, mealId: dinner.mealId, pollo: written<ConsumeEvent>(log0, dinner.pollo) };
  }

  for (const mode of MODES) {
    describe(mode === "nuovo" ? "scritte da adesso in poi" : "registro già scritto con l'opId ereditato", () => {
      it("1-2. rewriteMeal: pasto spostato alle 20:30, poi a ieri", () => {
        const { log0, mealId } = dinnerWritten(mode);
        const { log2, one, two } = expectTwoCorrections(
          mode,
          log0,
          (log) => ok(rewriteMeal(mealId, { minutes: 20 * 60 + 30 }, log, { ...ctx(LATER), timeZone: TZ })).events,
          (log) => ok(rewriteMeal(mealId, { date: "2026-11-15" }, log, { ...ctx(NIGHT), timeZone: TZ })).events,
        );
        expect([one, two].map((events) => events.map((e) => e.type))).toEqual([["void", "meal"], ["void", "meal"]]);
        expect(diaryOf(log2).days.map((d) => [d.date, d.meals.length])).toEqual([["2026-11-15", 1]]);
        expect(mealsOf(log2)[0].pantryConsumes).toHaveLength(3);
      });

      it("changeItem: una voce libera corretta due volte", () => {
        const { log0, mealId } = dinnerWritten(mode);
        expectTwoCorrections(
          mode,
          log0,
          (log) => ok(changeItem(mealId, 0, { quantity: q(60) }, log, ctx(LATER))).events,
          (log) => ok(changeItem(mealId, 0, { quantity: q(80) }, log, ctx(NIGHT))).events,
        );
      });

      it("appendItems: due aggiunte allo stesso pasto", () => {
        const { log0, mealId } = dinnerWritten(mode);
        const { log2 } = expectTwoCorrections(
          mode,
          log0,
          (log) => ok(appendItems(mealId, [{ name: "Mela", quantity: q(1, "pz"), certainty: "estimated" }], log, ctx(LATER))).events,
          (log) => ok(appendItems(mealId, [{ name: "Pizza", quantity: q(1, "pz"), certainty: "estimated" }], log, ctx(NIGHT))).events,
        );
        expect(mealsOf(log2)[0].items.map((i) => i.name)).toEqual(["Pane", "Mela", "Pizza"]);
      });

      it("3. changeConsumeQuantity: la quantità di una voce corretta due volte", () => {
        const { log0, pollo } = dinnerWritten(mode);
        const { log2 } = expectTwoCorrections(
          mode,
          log0,
          () => ok(changeConsumeQuantity(pollo, { value: 150, estimated: false }, 1000, ctx(LATER))).events,
          (_log, one) => ok(changeConsumeQuantity(one.find((e) => e.type === "consume") as ConsumeEvent, { value: 180, estimated: false }, 1000, ctx(NIGHT))).events,
        );
        expect(left(log2, "pollo")).toBe(820);
      });

      it("moveConsumes: una voce spostata a cena e poi tra gli spuntini", () => {
        const write = WRITERS[mode];
        const base = write(stock);
        const log0 = [...base, ...write(eat(base, "yogurt", 100, NOON).events)];
        const eaten = log0.find((e): e is ConsumeEvent => e.type === "consume") as ConsumeEvent;
        const { log2 } = expectTwoCorrections(
          mode,
          log0,
          (log) => ok(moveConsumes([eaten], diaryOf(log), { ...ctx(LATER), timeZone: TZ }, { kind: "dinner" })).events,
          (log, one) => ok(moveConsumes([one.find((e) => e.type === "consume") as ConsumeEvent], diaryOf(log), { ...ctx(NIGHT), timeZone: TZ }, { kind: "snack" })).events,
        );
        expect(mealsOf(log2).map((m) => [m.kind, m.pantryConsumes.length])).toEqual([["snack", 1]]);
        expect(left(log2, "yogurt")).toBe(25);
      });

      it("4. correctLot: l'ingresso resta una riga sua, e la modifica scritta un millisecondo dopo sta con la sua correzione", () => {
        const write = WRITERS[mode];
        const log0 = write(stock);
        const entry = (log: readonly AnyEvent[]) => log.filter((e): e is PurchaseEvent => e.type === "purchase" && e.lotId === "pollo").at(-1) as PurchaseEvent;
        const { log2, one } = expectTwoCorrections(
          mode,
          log0,
          (log) => correctLot(entry(log), { quantity: q(1200), productRef: "Pollo intero" }, { lot: lotOf(log, "pollo"), ...factory(LATER) }) as AnyEvent[],
          (log) => correctLot(entry(log), { quantity: q(900) }, { lot: lotOf(log, "pollo"), ...factory(NIGHT) }) as AnyEvent[],
        );
        expect(one.map((e) => [e.type, e.recordedAt])).toEqual([["void", LATER], ["purchase", LATER], ["updateLot", "2026-11-16T20:10:00.001Z"]]);
        expect(opWith(log2, { id: "p-pollo" }).events.map((e) => e.id).sort()).toEqual(stock.map((e) => e.id).sort());
        expect([lotOf(log2, "pollo").productRef, left(log2, "pollo")]).toEqual(["Pollo intero", 900]);
      });

      it("5. retimeDrink: un tè spostato due volte, con ciò che era stato scalato dalla dispensa", () => {
        const write = WRITERS[mode];
        const tea = purchase("p-te", BOUGHT, { deviceId: "A", lotId: "te", productRef: "Tè verde", quantity: q(40), location: "dispensa" });
        const base = write([...stock, tea]);
        const drink = write(buildDrink({ name: "Tè", ml: 200 }, { ...ctx(LUNCH), timeZone: TZ }).events);
        const log1 = [...base, ...drink];
        const dose = { quantity: { value: 2, unit: "g" as const }, certainty: "estimated" as const, text: "circa 2 g" };
        const log0 = [...log1, ...write(ok(buildDrinkConsume({ lot: lotOf(log1, "te"), dose }, drink[0].id, ctx("2026-11-16T12:12:00.000Z"))).events)];
        const retime = (log: readonly AnyEvent[], time: string, now: string): AnyEvent[] => {
          const entry = diaryOf(log).days[0].drinks[0] as DiaryDrink;
          return ok(retimeDrink(entry, "2026-11-16", time, { ...ctx(now), timeZone: TZ }, linkedConsumes(entry.eventId, log, derivePantry(log).voidedEventIds))).events;
        };
        const { log2, one, two } = expectTwoCorrections(mode, log0, (log) => retime(log, "08:15", LATER), (log) => retime(log, "09:30", NIGHT));
        expect([one, two].map((events) => events.map((e) => e.type))).toEqual([["void", "drink", "void", "consume"], ["void", "drink", "void", "consume"]]);
        expect(left(log2, "te")).toBe(38);
        expect(diaryOf(log2).days[0].drinks.map((d) => d.at)).toEqual(["2026-11-16T08:30:00.000Z"]);
      });
    });
  }

  it("2. il registro scritto a mano: annullamento con l'opId nuovo e pasto riscritto con quello di prima, stesso istante", () => {
    const base = { deviceId: "A", schemaVersion: 1, certainty: "measured", source: "manual" } as const;
    const meal = (id: string, recordedAt: string, at: string, opId: string, replaces?: string) =>
      ({ ...base, id, type: "meal", at, recordedAt, mealId: "cena", kind: "dinner", items: [{ name: "Pizza", quantity: q(1, "pz"), certainty: "estimated" }], opId, ...(replaces ? { replaces } : {}) }) as unknown as AnyEvent;
    const cancel = (id: string, recordedAt: string, targetEventId: string, opId: string) =>
      ({ ...base, id, type: "void", at: recordedAt, recordedAt, targetEventId, opId }) as unknown as AnyEvent;
    // gli id dei pasti riscritti vengono una volta dopo e una volta prima di quelli dei loro annullamenti
    const log = [
      meal("m1", DINNER, DINNER, "op-A"),
      cancel("v1", LATER, "m1", "op-B"),
      meal("m2", LATER, "2026-11-16T19:30:00.000Z", "op-A", "m1"),
      cancel("w2", NIGHT, "m2", "op-C"),
      meal("a3", NIGHT, "2026-11-15T19:30:00.000Z", "op-A", "m2"),
    ];
    expect(log.every((e) => validateAnyEvent(e).length === 0)).toBe(true);
    const rows = (events: readonly AnyEvent[]) => opsOf(events).map((o) => [idsOf(o.events), o.state]);
    expect(rows(log)).toEqual([[["a3", "w2"], "active"], [["m2", "v1"], "changed"], [["m1"], "changed"]]);
    for (const seed of [1, 2, 3, 4]) expect(rows(shuffled(log, seededRandom(seed)))).toEqual(rows(log));
    expect(groupWrites(log).map((g) => idsOf(g.events))).toEqual([["m1"], ["m2", "v1"], ["a3", "w2"]]);

    const pantry = derivePantry(log);
    const [latest, middle, oldest] = opsOf(log);
    expect(commandBlock(latest, log, pantry, { now: NIGHT })).toBeUndefined();
    expect(commandBlock(middle, log, pantry, { now: NIGHT })).toBe("È stata corretta dopo: annulla prima la correzione delle 22:00.");
    expect(commandBlock(oldest, log, pantry, { now: NIGHT })).toBe("È stata corretta dopo: annulla prima la correzione delle 22:00.");

    // annullata la seconda correzione, la prima torna con «Annulla»; e il diario è quello di dopo la prima
    const undone = [...log, ...stampOperationId(undo(log, latest, "2026-11-16T22:00:00.000Z"), "op-D")];
    expect(rows(undone)).toEqual([[["a3", "w2"], "undone"], [["m2", "v1"], "active"], [["m1"], "changed"]]);
    expect(snapshot(undone)).toEqual(snapshot(log.slice(0, 3)));
    expect(commandBlock(opWith(undone, { id: "m2" }), undone, derivePantry(undone), { now: NIGHT })).toBeUndefined();
    const back = [...undone, ...stampOperationId(undo(undone, opWith(undone, { id: "m2" }), "2026-11-16T22:10:00.000Z"), "op-E")];
    expect(snapshot(back)).toEqual(snapshot(log.slice(0, 1)));
    expect(rows(back).map((r) => r[1])).toEqual(["undone", "undone", "active"]);
    expect(snapshot([...back, ...redo(back, opWith(back, { id: "m2" }), "2026-11-16T22:20:00.000Z")])).toEqual(snapshot(log.slice(0, 3)));
  });

  it("un opId ereditato sull'altro telefono: la correzione fatta lì è una riga sua, e dice da dove viene", () => {
    const dinner = withDinner();
    const log0 = [...WRITERS.nuovo(stock), ...WRITERS.nuovo(dinner.events)];
    const theirs = WRITERS.ereditato(ok(rewriteMeal(dinner.mealId, { kind: "lunch", minutes: 13 * 60 }, log0, { ...ctx(DINNER, "B"), timeZone: TZ })).events);
    // l'orologio dell'altro telefono segna lo stesso istante del pasto: conta il dispositivo, non solo il tempo
    expect(theirs.map((e) => [e.type, e.deviceId, e.recordedAt])).toEqual([["void", "B", DINNER], ["meal", "B", DINNER]]);
    expect(operationIdOf(theirs[1])).toBe(operationIdOf(written(log0, dinner.events[0])));
    const log = [...log0, ...theirs];
    const op = opWith(log, theirs[1]);
    expect([idsOf(op.events), op.deviceId, op.state]).toEqual([idsOf(theirs), "B", "active"]);
    expect(opWith(log, dinner.events[0]).state).toBe("changed");
    expect(idsOf(opWith(log, dinner.events[0]).events)).toEqual(idsOf(dinner.events));
    expect(snapshot([...log, ...undo(log, op)])).toEqual(snapshot(log0));
  });

  it("un opId che torna da solo, molto dopo o da un altro telefono, apre una riga sua; due così, scritti insieme, una sola", () => {
    const at = (ms: number) => new Date(Date.parse(NOON) + ms).toISOString();
    const water = (ms: number, deviceId = "A") => createWater({ ml: 200 }, factory(at(ms), deviceId));
    const [first, near] = stampOperationId([water(0), water(1500)], "op-1");
    const [far] = stampOperationId([water(2000)], "op-1");
    const [elsewhere] = stampOperationId([water(5, "B")], "op-1");
    const pair = stampOperationId([water(60_000), water(60_001)], "op-1");
    const groups = groupWrites([...pair, elsewhere, far, near, first]);
    expect(groups.map((g) => idsOf(g.events))).toEqual([idsOf([first, near]), [elsewhere.id], [far.id], idsOf(pair)]);
    expect(groups.map((g) => g.at)).toEqual([at(0), at(5), at(2000), at(60_000)]);
  });

  it("8. due azioni vere una dopo l'altra, anche nello stesso istante, hanno identificativi diversi e restano due righe", () => {
    const at = (ms: number) => new Date(Date.parse(NOON) + ms).toISOString();
    const tap = (ms: number) => stampOperationId([createWater({ ml: 200 }, factory(at(ms)))], nextId());
    for (const gap of [0, 3, 300, 1500]) {
      const [one, two] = [tap(0), tap(gap)];
      const log = [...one, ...two];
      expect(opsOf(log).map((o) => o.events.map((e) => e.id)).sort()).toEqual([[one[0].id], [two[0].id]].sort());
      const undone = [...log, ...undo(log, opWith(log, two[0]))];
      expect(opsOf(undone).map((o) => [o.id, o.state]).sort()).toEqual([[one[0].id, "active"], [two[0].id, "undone"]].sort());
    }
    // e una correzione scritta nello stesso istante di un'altra azione non la porta con sé
    const dinner = withDinner();
    const log0 = [...WRITERS.nuovo(stock), ...WRITERS.nuovo(dinner.events)];
    const moved = WRITERS.nuovo(ok(rewriteMeal(dinner.mealId, { minutes: 20 * 60 + 30 }, log0, { ...ctx(LATER), timeZone: TZ })).events);
    const glass = WRITERS.nuovo([createWater({ ml: 200 }, factory(LATER))]);
    const log = [...log0, ...moved, ...glass];
    expect(idsOf(opWith(log, moved[1]).events)).toEqual(idsOf(moved));
    expect(idsOf(opWith(log, glass[0]).events)).toEqual(idsOf(glass));
  });
});

describe("un opId ereditato si riconosce dall'annullamento scritto con lui, non dall'ordine degli eventi", () => {
  const shift = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
  const legacy = WRITERS.ereditato;
  /** Un generatore di id con un prefisso: per far venire gli id di una scrittura prima o dopo quelli di un'altra. */
  const idsWith = (prefix: string) => () => `${prefix}-${String(++n).padStart(6, "0")}`;
  const rows = (log: readonly AnyEvent[]) => opsOf(log).map((o) => [o.id, o.state, idsOf(o.events)]);

  /** Una cena scritta dal telefono A; `withPantry`: con un alimento della dispensa oltre alla voce libera. */
  function dinnerOf(withPantry: boolean, idGenerator = nextId) {
    const base = legacy(stock);
    const built = ok(
      buildMealEvents(
        { kind: "dinner", picks: withPantry ? [{ lot: lotOf(base, "pollo"), choice: { kind: "text", text: "200 g" } }] : [], freeItems: [{ name: "Pizza", quantityText: "1 pz" }] },
        { now: DINNER, deviceId: "A", idGenerator },
      ),
    );
    const meal = legacy(built.events);
    return { base, mealId: built.mealId, meal, log0: [...base, ...meal] };
  }

  /**
   * La correzione è una riga sua, con i suoi due eventi; l'originale è «corretto dopo» e non si annulla; «Annulla»
   * sulla correzione riporta il pasto com'era (non lo toglie), e da lì l'originale si annulla per intero.
   */
  function expectCorrection(log0: readonly AnyEvent[], original: readonly AnyEvent[], correction: readonly AnyEvent[], base: readonly AnyEvent[]) {
    const log = [...log0, ...correction];
    expect(correction.map((e) => e.type)).toEqual(["void", "meal"]);
    expect(operationIdOf(correction[1])).toBe(operationIdOf(original[0]));
    expect(operationIdOf(correction[0])).not.toBe(operationIdOf(original[0]));

    const [first, second] = [opWith(log, original[0]), opWith(log, correction[1])];
    expect(idsOf(first.events)).toEqual(idsOf(original));
    expect(idsOf(second.events)).toEqual(idsOf(correction));
    expect([first.state, second.state]).toEqual(["changed", "active"]);
    expect(commandBlock(first, log, derivePantry(log), { now: NIGHT })).toMatch(/corretta dopo: annulla prima la correzione/);
    expect(commandBlock(second, log, derivePantry(log), { now: NIGHT })).toBeUndefined();
    for (const seed of [1, 2, 3, 4, 5]) expect(rows(shuffled(log, seededRandom(seed)))).toEqual(rows(log));

    const voids = undo(log, second, "2026-11-16T22:00:00.000Z");
    expect(voids.map((v) => v.targetEventId).sort()).toEqual(idsOf(correction));
    const back = [...log, ...stampOperationId(voids, nextId())];
    expect(snapshot(back)).toEqual(snapshot(log0));
    expect([opWith(back, original[0]).state, opWith(back, correction[1]).state]).toEqual(["active", "undone"]);
    const gone = [...back, ...stampOperationId(undo(back, opWith(back, original[0]), "2026-11-16T22:10:00.000Z"), nextId())];
    expect(snapshot(gone)).toEqual(snapshot(base));
    const again = [...back, ...stampOperationId(redo(back, opWith(back, correction[1]), "2026-11-16T22:20:00.000Z"), nextId())];
    expect(snapshot(again)).toEqual(snapshot(log));
  }

  it.each([false, true])("l'altro telefono ha l'orologio indietro: la sua correzione risulta scritta prima del pasto che corregge (con la dispensa: %s)", (withPantry) => {
    const { base, mealId, meal, log0 } = dinnerOf(withPantry);
    const theirs = legacy(ok(rewriteMeal(mealId, { minutes: 21 * 60 }, log0, { ...ctx(shift(DINNER, -300_000), "B"), timeZone: TZ })).events);
    expect(theirs.every((e) => e.deviceId === "B" && e.recordedAt < DINNER)).toBe(true);
    expectCorrection(log0, meal, theirs, base);
  });

  it("stesso istante su due telefoni, con gli id della correzione che vengono prima di quelli del pasto", () => {
    const { base, mealId, meal, log0 } = dinnerOf(false, idsWith("z"));
    const theirs = legacy(ok(rewriteMeal(mealId, { minutes: 21 * 60 }, log0, { now: DINNER, deviceId: "B", idGenerator: idsWith("a"), timeZone: TZ })).events);
    expect(theirs.every((e) => e.id < meal[0].id)).toBe(true);
    expectCorrection(log0, meal, theirs, base);
  });

  it("lo stesso telefono con l'orologio portato indietro tra il pasto e la correzione", () => {
    const { base, mealId, meal, log0 } = dinnerOf(true);
    const mine = legacy(ok(rewriteMeal(mealId, { minutes: 21 * 60 }, log0, { ...ctx(shift(DINNER, -60_000)), timeZone: TZ })).events);
    expectCorrection(log0, meal, mine, base);
  });

  it("una correzione a meno di due secondi dall'originale è una riga sua, e l'originale dice il motivo giusto", () => {
    const { base, meal, log0 } = dinnerOf(true);
    const eaten = meal.find((e): e is ConsumeEvent => e.type === "consume") as ConsumeEvent;
    const one = legacy(ok(changeConsumeQuantity(eaten, { value: 150, estimated: false }, 1000, ctx(shift(DINNER, 1500)))).events);
    const log1 = [...log0, ...one];
    expect(rows(log1).map((r) => r[2])).toEqual([idsOf(one), idsOf(meal), idsOf(base)]);
    expect(opWith(log1, meal[0]).state).toBe("changed");
    expect(commandBlock(opWith(log1, meal[0]), log1, derivePantry(log1), { now: NIGHT })).toBe("È stata corretta dopo: annulla prima la correzione delle 20:00.");
    expect(commandBlock(opWith(log1, one[1]), log1, derivePantry(log1), { now: NIGHT })).toBeUndefined();

    const two = legacy(ok(changeConsumeQuantity(one[1] as ConsumeEvent, { value: 180, estimated: false }, 1000, ctx(shift(DINNER, 3000)))).events);
    const log2 = [...log1, ...two];
    expect(rows(log2).map((r) => [r[1], r[2]])).toEqual([["active", idsOf(two)], ["changed", idsOf(one)], ["changed", idsOf(meal)], ["active", idsOf(base)]]);
    for (const seed of [1, 2, 3]) expect(rows(shuffled(log2, seededRandom(seed)))).toEqual(rows(log2));
    const log3 = [...log2, ...undo(log2, opWith(log2, two[1]), "2026-11-16T22:00:00.000Z")];
    expect(snapshot(log3)).toEqual(snapshot(log1));
    const log4 = [...log3, ...undo(log3, opWith(log3, one[1]), "2026-11-16T22:10:00.000Z")];
    expect(snapshot(log4)).toEqual(snapshot(log0));
    expect(snapshot([...log4, ...undo(log4, opWith(log4, meal[0]), "2026-11-16T22:20:00.000Z")])).toEqual(snapshot(base));
  });

  it("la copia arrivata senza il suo annullamento: non si indovina, né l'originale né la copia si annullano; arrivato l'annullamento, sì", () => {
    const { mealId, meal, log0 } = dinnerOf(false);
    const theirs = legacy(ok(rewriteMeal(mealId, { minutes: 21 * 60 }, log0, { ...ctx(shift(DINNER, -300_000), "B"), timeZone: TZ })).events);
    const partial = [...log0, theirs[1]];
    const reason = "Questa azione è stata corretta su un altro dispositivo: non si annulla da qui.";
    for (const seed of [0, 1, 2]) {
      const log = seed === 0 ? partial : shuffled(partial, seededRandom(seed));
      const pantry = derivePantry(log);
      for (const e of [meal[0], theirs[1]]) {
        const op = opWith(log, e);
        expect(op.events.map((x) => x.id)).toEqual([e.id]);
        expect(commandBlock(op, log, pantry, { now: NIGHT })).toBe(reason);
        expect(undoOperation(op, log, pantry, ctx(NIGHT))).toEqual({ ok: false, reason });
        expect(redoOperation(op, log, pantry, ctx(NIGHT))).toEqual({ ok: false, reason });
      }
      // ciò che non c'entra si annulla come sempre
      expect(commandBlock(opWith(log, { id: "p-pollo" }), log, pantry, { now: NIGHT })).toBeUndefined();
    }
    const whole = [...partial, theirs[0]];
    expect(commandBlock(opWith(whole, theirs[1]), whole, derivePantry(whole), { now: NIGHT })).toBeUndefined();
    expect(snapshot([...whole, ...undo(whole, opWith(whole, theirs[1]))])).toEqual(snapshot(log0));
  });

  it("lo stesso opId che torna molto dopo sullo stesso telefono, senza annullamento: due righe, nessuna si annulla", () => {
    const { meal, log0 } = dinnerOf(false);
    // come lo scriveva la correzione di un pasto tolto altrove a cui era rimasta una voce: la copia da sola
    const copy = { ...meal[0], id: "copia", recordedAt: LATER, replaces: meal[0].id } as AnyEvent;
    const log = [...log0, copy];
    const reason = "Questa azione è stata corretta in un modo che non riesco a ricostruire: non si annulla da qui.";
    for (const e of [meal[0], copy]) {
      const op = opWith(log, e);
      expect(op.events.map((x) => x.id)).toEqual([e.id]);
      expect(commandBlock(op, log, derivePantry(log), { now: NIGHT })).toBe(reason);
      expect(undoOperation(op, log, derivePantry(log), ctx(NIGHT))).toEqual({ ok: false, reason });
    }
  });

  it("due telefoni con gli orologi sfasati, scritture di prima e di adesso mescolate: «Annulla» e «Rifai» valgono sempre per una scrittura intera, mai per metà né per due", () => {
    const tried = { undo: 0, redo: 0, early: 0 };
    for (const seed of [11, 12, 13, 14, 15, 16]) {
      const random = seededRandom(seed);
      const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
      const offsets: Record<string, number> = { A: 0, B: pick([-420_000, -1500, 0, 90_000]) };
      let clock = Date.parse(DINNER);
      const writes: Set<string>[] = [];
      let log: AnyEvent[] = [];
      const write = (events: readonly AnyEvent[]) => {
        if (events.length === 0) return;
        const stamped = pick([WRITERS.nuovo, WRITERS.ereditato, WRITERS.ereditato])(events);
        writes.push(new Set(stamped.map((e) => e.id)));
        log = [...log, ...stamped];
      };
      const here = (deviceId: string) => ({ now: new Date(clock + offsets[deviceId]).toISOString(), deviceId, idGenerator: idsWith(pick(["a", "m", "z"])), timeZone: TZ });

      write(stock);
      const built = ok(buildMealEvents({ kind: "dinner", picks: [{ lot: lotOf(log, "pollo"), choice: { kind: "text", text: "200 g" } }], freeItems: [{ name: "Pizza", quantityText: "1 pz" }] }, here("A")));
      write(built.events);
      let last: readonly AnyEvent[] = [];

      for (let step = 0; step < 14; step++) {
        // a volte un attimo dopo, a volte minuti; e una volta ogni tanto l'orologio del telefono A torna indietro
        clock += pick([700, 1500, 40_000, 300_000]);
        if (random() < 0.1) offsets.A -= 123_457;
        const c = here(pick(["A", "B"]));
        const meal = mealsOf(log).find((m) => m.mealId === built.mealId);
        const roll = random();
        let edit: { ok: true; events: readonly AnyEvent[] } | { ok: false } = { ok: false };
        if (roll < 0.15 && last.length > 0) edit = { ok: true, events: buildUndo(last, c) };
        else if (!meal) continue;
        else if (roll < 0.4) edit = rewriteMeal(built.mealId, { minutes: 18 * 60 + Math.floor(random() * 240) }, log, c);
        else if (roll < 0.6) edit = meal.items.length > 0 ? changeItem(built.mealId, 0, { quantity: q(1 + Math.floor(random() * 5), "pz") }, log, c) : { ok: false };
        else if (roll < 0.8) edit = appendItems(built.mealId, [{ name: pick(["Mela", "Pane", "Riso"]), quantity: q(1, "pz"), certainty: "estimated" }], log, c);
        else if (meal.pantryConsumes.length > 0) edit = changeConsumeQuantity(written<ConsumeEvent>(log, meal.pantryConsumes[0]), { value: 100 + Math.floor(random() * 200), estimated: false }, 1000, c);
        if (!edit.ok || edit.events.length === 0) continue;
        last = edit.events;
        write(edit.events);

        const seen = random() < 0.5 ? log : shuffled(log, random);
        const pantry = derivePantry(seen);
        const writeOf = (id: string) => writes.find((w) => w.has(id)) as Set<string>;
        for (const op of opsOf(seen)) {
          // ogni riga è una scrittura intera
          expect(new Set(op.events.map((e) => e.id)), `seme ${seed}, passo ${step}`).toEqual(writeOf(op.events[0].id));
          const result = op.state === "undone" ? redoOperation(op, seen, pantry, ctx(NIGHT)) : undoOperation(op, seen, pantry, ctx(NIGHT));
          if (!result.ok) continue;
          tried[op.state === "undone" ? "redo" : "undo"]++;
          // una correzione che per l'orologio viene prima di ciò che corregge
          if (op.events.some((e) => e.type === "void" && (seen.find((x) => x.id === (e as VoidEvent).targetEventId)?.recordedAt ?? "") > e.recordedAt)) tried.early++;
          const touched = new Set(result.events.map((v) => v.targetEventId));
          const whole = writeOf(result.events[0].targetEventId);
          // ciò che si annulla sta tutto in una scrittura; e di un'azione in vigore si annulla tutto
          for (const id of touched) expect(whole.has(id), `seme ${seed}, passo ${step}: ${id}`).toBe(true);
          if (op.state === "active") expect(touched, `seme ${seed}, passo ${step}`).toEqual(whole);
          const after = [...seen, ...result.events];
          expect(derivePantry(after).anomalies).toEqual([]);
          expect(diaryOf(after).anomalies).toEqual([]);
        }
      }
    }
    // la prova non è a vuoto: si è annullato e rifatto davvero, anche correzioni registrate prima del loro bersaglio
    expect(tried.undo).toBeGreaterThan(60);
    expect(tried.redo).toBeGreaterThan(5);
    expect(tried.early).toBeGreaterThan(5);
  });
});

describe("con cinquantamila eventi", () => {
  it("l'elenco degli ultimi 14 giorni e «Annulla» restano svelti", () => {
    const start = Date.parse("2026-01-01T00:00:00.000Z");
    const history: AnyEvent[] = [];
    for (let i = 0; i < 50_000; i++) {
      const at = new Date(start + i * 500_000).toISOString();
      const id = `w-${String(i).padStart(6, "0")}`;
      const event = createWater({ ml: 200 }, { now: () => at, deviceId: i % 3 ? "A" : "B", idGenerator: () => id });
      history.push(...withOperationId([event], `op-${id}`));
    }
    const now = new Date(start + 50_000 * 500_000).toISOString();
    const bought = stock.map((e) => ({ ...e, at: now, recordedAt: now }) as AnyEvent);
    const base = [...history, ...bought];
    const dinner = withDinner(base, new Date(Date.parse(now) + 60_000).toISOString());
    const log = dinner.log;
    const later = new Date(Date.parse(now) + 3_600_000).toISOString();
    const pantry = derivePantry(log);

    let t = performance.now();
    const ops = groupOperations([...log], { since: new Date(Date.parse(now) - 14 * 86_400_000).toISOString() });
    const listed = performance.now() - t;
    expect(ops.length).toBeGreaterThan(2000);
    expect(ops[0].events.map((e) => e.type)).toEqual(["meal", "consume", "consume", "consume"]);

    // come al tocco: un registro appena letto, senza niente di già calcolato
    const fresh = [...log];
    t = performance.now();
    const result = undoOperation(ops[0], fresh, pantry, ctx(later));
    const undone = performance.now() - t;
    if (!result.ok) throw new Error(result.reason);
    expect(result.events).toHaveLength(4);
    expect(derivePantry([...log, ...result.events]).lots.map((l) => l.remaining).sort()).toEqual([1000, 125, 200, 500].sort());

    const after = [...log, ...result.events];
    t = performance.now();
    const again = redoOperation(opWith(after, dinner.events[0]), after, derivePantry(bought), ctx(later));
    const redone = performance.now() - t;
    expect(again.ok).toBe(true);

    expect(undone, `elenco ${listed.toFixed(0)} ms, annulla ${undone.toFixed(0)} ms, rifai ${redone.toFixed(0)} ms`).toBeLessThan(500);
    expect(listed).toBeLessThan(500);
  }, 60_000);
});
