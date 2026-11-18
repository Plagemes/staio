// Sequenze casuali di correzioni su tre telefoni che ogni tanto si uniscono. Non si controlla un risultato preciso ma
// le regole che devono valere sempre, qualunque cosa succeda e in qualunque ordine arrivino gli eventi.
import { describe, expect, it } from "vitest";
import { derivePantry, mergeEvents, type EventLike } from "../ledger";
import { consumeRoots } from "../ledger/supersede";
import { computeIntake, createResolver } from "../nutrition";
import { FAKE_FOODS } from "../nutrition/test-helpers";
import { deriveDiary } from "./derive";
import {
  appendItems,
  changeConsumeQuantity,
  changeItem,
  currentMeal,
  moveItem,
  removeConsume,
  removeItem,
  rewriteMeal,
  type EditContext,
} from "./editMeal";
import { activeConsumes } from "./log";
import { pantryMealReport } from "./pantry";
import { moveConsumes } from "./placeConsume";
import { consume, meal, purchase, seededRandom, shuffled, voidOf } from "./test-helpers";
import { voidMeal } from "./voidMeal";

const D = "2026-03-10";
const TZ = { timeZone: "UTC" };
const at = (hhmm: string) => `${D}T${hhmm}:00.000Z`;
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

type Log = unknown[];
const KINDS = ["breakfast", "lunch", "dinner", "snack"] as const;
const INITIAL = { "lot-1": 400, "lot-2": 500 } as const;

const start: Log = [
  purchase("p1", at("06:00"), { lotId: "lot-1", productRef: "Petto di pollo", quantity: q(INITIAL["lot-1"]), location: "frigo" }),
  purchase("p2", at("06:00"), { lotId: "lot-2", productRef: "Riso", quantity: q(INITIAL["lot-2"]), location: "dispensa" }),
  meal("m1", at("13:00"), { mealId: "meal-1", kind: "lunch", items: [{ name: "Pizza", quantity: q(1, "pz"), certainty: "estimated" }], certainty: "estimated" }),
  consume("c1", at("13:00"), { lotId: "lot-1", quantity: q(150), mealId: "meal-1" }),
  consume("c2", at("13:00"), { lotId: "lot-2", quantity: q(80), mealId: "meal-1" }),
  meal("m2", at("20:00"), { mealId: "meal-2", kind: "dinner" }),
  consume("c3", at("20:00"), { lotId: "lot-1", quantity: q(100), mealId: "meal-2" }),
];

const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });

function view(log: Log) {
  const state = deriveDiary(log, TZ);
  const report = pantryMealReport(state, log);
  const intake = computeIntake(log, resolver, TZ);
  return {
    meals: report.meals.map((m) => ({
      mealId: m.mealId,
      kind: m.kind,
      at: m.at,
      items: m.items.map((i) => `${i.name}:${i.quantity.value}`),
      consumes: m.pantryConsumes.map((c) => `${c.lotId}:${c.quantity.value}`),
      removed: m.removedLines,
      revived: m.revived,
      others: (m.otherVersions ?? []).map((v) => v.eventId),
    })),
    orphans: report.orphanConsumes.map((c) => `${c.lotId}:${c.quantity.value}`),
    remaining: Object.fromEntries(derivePantry(log as never[]).lots.map((l) => [l.lotId, l.remaining])),
    mealLines: intake.days.flatMap((d) => d.meals.flatMap((m) => m.lines.map((l) => `${m.mealId}:${l.quantity.value}`))).sort(),
    standalone: intake.days.flatMap((d) => d.standalone.map((l) => l.quantity.value)),
    anomalies: state.anomalies.map((a) => a.code).sort(),
  };
}

/** Quante volte, nelle sequenze, si sono viste le situazioni che le regole devono reggere. */
const seen = { revived: 0, conflicts: 0, merges: 0 };

/** Le regole che valgono su ogni registro, anche su quello di un solo telefono a metà strada. */
function checkRules(log: Log, label: string) {
  const v = view(log);
  if (v.meals.some((m) => m.revived)) seen.revived++;
  if (v.meals.some((m) => m.others.length > 0)) seen.conflicts++;
  else if (v.anomalies.includes("duplicate_meal")) seen.merges++;
  // nessun consumo valido resta fuori dal diario, né conta nei nutrienti come voce senza pasto
  expect(v.orphans, `${label}: consumi fuori dal diario`).toEqual([]);
  expect(v.standalone, `${label}: voci senza pasto nei nutrienti`).toEqual([]);
  // un pasto compare una volta sola
  expect(new Set(v.meals.map((m) => m.mealId)).size, `${label}: pasti doppi`).toBe(v.meals.length);
  // la dispensa scala esattamente ciò che il diario mostra, una volta
  for (const lotId of Object.keys(INITIAL) as (keyof typeof INITIAL)[]) {
    const shown = v.meals
      .flatMap((m) => m.consumes)
      .filter((c) => c.startsWith(`${lotId}:`))
      .reduce((sum, c) => sum + Number(c.split(":")[1]), 0);
    expect(INITIAL[lotId] - v.remaining[lotId], `${label}: ${lotId} dispensa e diario`).toBeCloseTo(shown, 6);
  }
  // i nutrienti contano le stesse voci del diario
  const lines = v.meals.flatMap((m) => [...m.items, ...m.consumes].map((x) => `${m.mealId}:${x.split(":")[1]}`)).sort();
  expect(v.mealLines, `${label}: nutrienti e diario`).toEqual(lines);
  // di ogni voce della dispensa vale un consumo solo, e le voci non aumentano mai
  const active = activeConsumes(log);
  const roots = consumeRoots(log);
  expect(new Set(active.map((c) => roots.get(c.id))).size, `${label}: due consumi per una voce`).toBe(active.length);
  expect(active.length, `${label}: voci in più`).toBeLessThanOrEqual(3);
  // ciò che si vede si può correggere: per ogni pasto mostrato `currentMeal` dà le stesse voci
  for (const m of v.meals) {
    const cur = currentMeal(m.mealId, log);
    expect(cur, `${label}: ${m.mealId} mostrato ma non correggibile`).toBeDefined();
    expect((cur?.meal.items ?? []).map((i) => `${i.name}:${i.quantity.value}`), `${label}: voci di ${m.mealId}`).toEqual(m.items);
    expect(cur?.consumes.map((c) => `${c.lotId}:${c.quantity.value}`), `${label}: consumi di ${m.mealId}`).toEqual(m.consumes);
    expect([cur?.meal.kind, cur?.meal.at], `${label}: momento di ${m.mealId}`).toEqual([m.kind, m.at]);
  }
  return v;
}

describe("sequenze casuali su tre telefoni", () => {
  it("nessun consumo resta fuori dal diario, niente si conta due volte, il risultato è lo stesso in qualunque ordine", () => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 150; seed++) {
      const random = seededRandom(seed);
      const pick = <T,>(list: readonly T[]): T => list[Math.floor(random() * list.length)];
      const devices = ["A", "B", "C"];
      const logs: Record<string, Log> = { A: [...start], B: [...start], C: [...start] };
      const last: Record<string, { id: string }[]> = {};
      // gli orologi dei telefoni non sono d'accordo
      const skew: Record<string, number> = { A: 0, B: Math.floor(random() * 20) - 10, C: Math.floor(random() * 20) - 10 };
      let minute = 14 * 60;
      let n = 0;
      const trace: string[] = [];

      for (let step = 0; step < 9; step++) {
        minute += 1 + Math.floor(random() * 3);
        const device = pick(devices);
        if (random() < 0.2) {
          const other = pick(devices.filter((d) => d !== device));
          const merged = mergeEvents(logs[device] as EventLike[], logs[other] as EventLike[]).events as Log;
          logs[device] = [...merged];
          logs[other] = [...merged];
          trace.push(`${device}<>${other}`);
          continue;
        }
        const local = minute + skew[device];
        const now = `${D}T${String(Math.floor(local / 60)).padStart(2, "0")}:${String(local % 60).padStart(2, "0")}:00.000Z`;
        const c: EditContext = { deviceId: device, now, idGenerator: () => `${device}${seed}-${String(++n).padStart(3, "0")}`, timeZone: "UTC" };
        const log = logs[device];
        const state = deriveDiary(log, TZ);
        const meals = pantryMealReport(state, log).meals;
        if (meals.length === 0) continue;
        const m = pick(meals);
        const cur = currentMeal(m.mealId, log);
        if (!cur) throw new Error(`seme ${seed}: ${m.mealId} mostrato ma non correggibile`);
        const count = cur.meal.items?.length ?? 0;
        const op = pick(["qty", "removeConsume", "moveConsume", "changeItem", "append", "rewrite", "removeItem", "moveItem", "voidMeal", "undo"]);
        let events: { id: string }[] = [];
        if (op === "qty" && cur.consumes.length > 0) {
          const target = pick(cur.consumes);
          const left = derivePantry(log as never[]).lots.find((l) => l.lotId === target.lotId)?.remaining ?? 0;
          const r = changeConsumeQuantity(target, { value: 1 + Math.floor(random() * 120), estimated: random() < 0.5 }, left + target.quantity.value, c);
          if (r.ok) events = r.events;
        } else if (op === "removeConsume" && cur.consumes.length > 0) {
          const r = removeConsume(pick(cur.consumes), log, c);
          if (r.ok) events = r.events;
        } else if (op === "moveConsume" && cur.consumes.length > 0) {
          const r = moveConsumes([pick(cur.consumes)], state, c, { kind: pick(KINDS) });
          if (r.ok) events = r.events;
        } else if (op === "changeItem" && count > 0) {
          const r = changeItem(m.mealId, Math.floor(random() * count), { quantity: q(1 + Math.floor(random() * 4), "pz") }, log, c);
          if (r.ok) events = r.events;
        } else if (op === "append") {
          const r = appendItems(m.mealId, [{ name: pick(["Pane", "Mela", "Noci"]), quantity: q(1 + Math.floor(random() * 3), "pz"), certainty: "estimated" }], log, c);
          if (r.ok) events = r.events;
        } else if (op === "rewrite") {
          const r = rewriteMeal(m.mealId, { kind: pick(KINDS), minutes: Math.floor(random() * 1440) }, log, c);
          if (r.ok) events = r.events;
        } else if (op === "removeItem" && count > 0) {
          const r = removeItem(m.mealId, Math.floor(random() * count), log, c);
          if (r.ok) events = r.events;
        } else if (op === "moveItem" && count > 0) {
          const r = moveItem(m.mealId, Math.floor(random() * count), { kind: pick(KINDS) }, log, state, c);
          if (r.ok) events = r.events;
        } else if (op === "voidMeal") {
          events = voidMeal(m.mealId, log, { deviceId: device, now: () => now, idGenerator: c.idGenerator });
        } else if (op === "undo" && (last[device]?.length ?? 0) > 0) {
          events = last[device].map((e) => voidOf((c.idGenerator as () => string)(), now, e.id, { deviceId: device }));
        }
        if (events.length === 0) continue;
        logs[device] = [...log, ...events];
        last[device] = events;
        counts[op] = (counts[op] ?? 0) + 1;
        trace.push(`${device} ${op} ${m.mealId}`);
        checkRules(logs[device], `seme ${seed} su ${device} dopo ${trace.join(" | ")}`);
      }

      const union = [...logs.A, ...logs.B, ...logs.C];
      const merged = mergeEvents(mergeEvents(logs.A as EventLike[], logs.B as EventLike[]).events, logs.C as EventLike[]).events as Log;
      const reference = checkRules(merged, `seme ${seed} unito dopo ${trace.join(" | ")}`);
      for (let i = 0; i < 4; i++) expect(view(shuffled(union, random)), `seme ${seed}: ordine di arrivo`).toEqual(reference);
    }
    // le situazioni difficili sono capitate davvero: pasti ricomparsi, versioni in conflitto, versioni unite
    expect(seen.revived).toBeGreaterThan(5);
    expect(seen.conflicts).toBeGreaterThan(5);
    expect(seen.merges).toBeGreaterThan(5);
    // ogni tipo di correzione è stato provato davvero
    for (const op of ["qty", "removeConsume", "moveConsume", "changeItem", "append", "rewrite", "removeItem", "moveItem", "voidMeal", "undo"]) {
      expect(counts[op] ?? 0, op).toBeGreaterThan(10);
    }
  }, 120_000);
});
