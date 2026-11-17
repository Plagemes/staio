import { describe, expect, it } from "vitest";
import { deriveDiary } from "@/core/diary";
import { derivePlan, type PlannedEntry } from "@/core/plan";
import { generateId, voidEvent } from "@/core/ledger";
import { meal } from "@/core/diary/test-helpers";
import { buildClearDayType, buildWeek } from "./edit";
import { buildDropMeal, buildMoveMeal, buildMoveMealAnywhere, missedThisWeek, slotText, slotsToMoveTo } from "./moveMeal";

const W = "2026-11-16";
const ctx = { now: "2026-11-17T08:00:00.000Z", deviceId: "dev-a" };
const food = (date: string, meal: PlannedEntry["meal"], name: string): PlannedEntry => ({
  date,
  meal,
  item: { kind: "food", name, quantity: { value: 100, unit: "g" } },
});
const entries = [food("2026-11-16", "lunch", "Riso"), food("2026-11-17", "dinner", "Zuppa")];
const from = { date: "2026-11-16", meal: "lunch" } as const;

describe("spostare un pasto del piano", () => {
  it("scrive un solo evento della settimana con il pasto sul nuovo posto", () => {
    const r = buildMoveMeal(W, entries, from, { date: "2026-11-19", meal: "dinner" }, ctx);
    if (!r.ok) throw new Error("atteso ok");
    expect(r.events).toHaveLength(1);
    expect(r.events[0].type).toBe("planWeek");
    const week = derivePlan(r.events).weeks[0];
    expect(week.entries.map((e) => `${e.date}|${e.meal}`)).toEqual(["2026-11-17|dinner", "2026-11-19|dinner"]);
    expect(r.message).toBe("Spostato: da lunedì 16 nov, pranzo a giovedì 19 nov, cena.");
  });

  it("l'annullamento fa tornare la versione di prima", () => {
    const base = buildMoveMeal(W, entries, from, { date: "2026-11-18", meal: "lunch" }, { ...ctx, now: "2026-11-17T08:00:00.000Z" });
    const next = buildMoveMeal(W, entries, from, { date: "2026-11-19", meal: "lunch" }, { ...ctx, now: "2026-11-17T09:00:00.000Z" });
    if (!base.ok || !next.ok) throw new Error("atteso ok");
    const undo = buildClearDayType(next.events[0].id, "2026-11-19", { ...ctx, now: "2026-11-17T10:00:00.000Z" });
    if (!undo.ok) throw new Error("atteso ok");
    const week = derivePlan([...base.events, ...next.events, ...undo.events]).weeks[0];
    expect(week.entries.find((e) => e.item.kind === "food" && e.item.name === "Riso")?.date).toBe("2026-11-18");
  });

  it("dice in italiano perché non si può spostare", () => {
    const taken = buildMoveMeal(W, entries, from, { date: "2026-11-17", meal: "dinner" }, ctx);
    expect(taken).toEqual({ ok: false, error: "Quel momento ha già un pasto pianificato: scegline uno libero." });
    expect(buildMoveMeal(W, entries, from, { date: "2026-11-30", meal: "lunch" }, ctx).ok).toBe(false);
  });

  it("toglie dal piano un pasto", () => {
    const r = buildDropMeal(W, entries, from, ctx);
    if (!r.ok) throw new Error("atteso ok");
    expect(derivePlan(r.events).weeks[0].entries).toHaveLength(1);
    expect(r.message).toBe(`Tolto dal piano: ${slotText(from)}.`);
  });
});

describe("pasti non fatti di questa settimana", () => {
  // martedì 17 nov, 22:00 a Roma: tutti i momenti di oggi sono passati
  const NOW = "2026-11-17T21:00:00.000Z";
  const args = { weekEntries: entries, now: NOW, timeZone: "Europe/Rome", today: "2026-11-17" };

  it("il pranzo di ieri senza diario e la cena di oggi già passata sono proposti; il futuro no", () => {
    const r = missedThisWeek({ ...args, diary: deriveDiary([]) });
    expect(r.map((m) => `${m.date}|${m.meal}|${m.reason}`)).toEqual(["2026-11-16|lunch|not_logged", "2026-11-17|dinner|not_logged"]);
  });

  it("la cena di oggi non è ancora «non registrata» nel primo pomeriggio", () => {
    const r = missedThisWeek({ ...args, now: "2026-11-17T12:00:00.000Z", diary: deriveDiary([]) });
    expect(r.map((m) => m.date)).toEqual(["2026-11-16"]);
  });

  it("i posti dove spostare escludono il passato, quello di partenza e quelli già pianificati", () => {
    const slots = slotsToMoveTo({ ...args, now: "2026-11-17T12:00:00.000Z", diary: deriveDiary([]), weekStart: W, from: { date: "2026-11-16", meal: "lunch" } });
    expect(slots[0]).toEqual({ date: "2026-11-17", meal: "lunch" }); // la colazione di oggi è già passata
    expect(slots).not.toContainEqual({ date: "2026-11-17", meal: "dinner" }); // occupato dalla zuppa
    expect(slots.every((s) => s.date >= "2026-11-17")).toBe(true);
  });
});

describe("spostare alla settimana successiva", () => {
  const NEXT = "2026-11-23";
  const next = { weekStart: NEXT, entries: [] as PlannedEntry[] };
  const to = { date: "2026-11-24", meal: "lunch" } as const;

  it("scrive le due settimane nello stesso gruppo di eventi, senza doppi conteggi", () => {
    const r = buildMoveMealAnywhere({ weekStart: W, entries }, next, from, to, ctx);
    if (!r.ok) throw new Error("atteso ok");
    expect(r.events.map((e) => e.type)).toEqual(["planWeek", "planWeek"]);
    const state = derivePlan(r.events);
    const all = state.weeks.flatMap((w) => w.entries);
    expect(all.filter((e) => e.item.kind === "food" && e.item.name === "Riso")).toHaveLength(1);
    expect(state.weeks.find((w) => w.weekStart === W)?.entries.some((e) => e.meal === "lunch" && e.date === "2026-11-16")).toBe(false);
    expect(state.weeks.find((w) => w.weekStart === NEXT)?.entries.map((e) => `${e.date}|${e.meal}`)).toEqual(["2026-11-24|lunch"]);
  });

  it("annullando i due eventi il pasto torna dov'era", () => {
    const base = buildWeek(W, entries, { ...ctx, now: "2026-11-17T07:00:00.000Z" }, "");
    const moved = buildMoveMealAnywhere({ weekStart: W, entries }, next, from, to, ctx);
    if (!base.ok || !moved.ok) throw new Error("atteso ok");
    const undo = moved.events.map((e) => voidEvent({ id: e.id, deviceId: "dev-a" }, { idGenerator: generateId, now: () => "2026-11-17T09:00:00.000Z", deviceId: "dev-a" }));
    const state = derivePlan([...base.events, ...moved.events, ...undo]);
    expect(state.weeks.find((w) => w.weekStart === W)?.entries).toHaveLength(entries.length);
    expect(state.weeks.find((w) => w.weekStart === NEXT)).toBeUndefined();
  });

  it("dentro la settimana resta un solo evento; un errore non scrive nulla", () => {
    const same = buildMoveMealAnywhere({ weekStart: W, entries }, next, from, { date: "2026-11-19", meal: "lunch" }, ctx);
    if (!same.ok) throw new Error("atteso ok");
    expect(same.events).toHaveLength(1);
    const busy = buildMoveMealAnywhere({ weekStart: W, entries }, { weekStart: NEXT, entries: [food("2026-11-24", "lunch", "X")] }, from, to, ctx);
    expect(busy).toEqual({ ok: false, error: "Quel momento ha già un pasto pianificato: scegline uno libero." });
  });

  it("i posti liberi comprendono la settimana successiva", () => {
    const args = { weekEntries: entries, now: "2026-11-17T12:00:00.000Z", timeZone: "Europe/Rome", today: "2026-11-17", diary: deriveDiary([]), weekStart: W, from };
    const slots = slotsToMoveTo({ ...args, nextWeek: next });
    expect(slots).toContainEqual({ date: "2026-11-23", meal: "breakfast" });
    expect(slots.at(-1)).toEqual({ date: "2026-11-29", meal: "dinner" });
    expect(slotsToMoveTo(args).some((s) => s.date >= NEXT)).toBe(false);
  });
});

describe("pasto mangiato in un altro momento dello stesso giorno", () => {
  const NOW = "2026-11-17T21:00:00.000Z";
  const week = [food("2026-11-17", "lunch", "Riso")];
  const args = { weekEntries: week, now: NOW, timeZone: "Europe/Rome", today: "2026-11-17" };
  const eatenAt = (iso: string, kind: "lunch" | "dinner", name: string) =>
    meal(`ev-${kind}`, iso, { mealId: kind, kind, items: [{ name, quantity: { value: 80, unit: "g" }, certainty: "estimated" }] });

  it("pianificato a pranzo, mangiato a cena: non risulta mancato", () => {
    const diary = deriveDiary([eatenAt("2026-11-17T18:30:00.000Z", "dinner", "Riso")]);
    expect(missedThisWeek({ ...args, diary }).map((m) => m.meal)).toEqual(["lunch"]);
    expect(missedThisWeek({ ...args, diary, adherence: {} })).toEqual([]);
  });

  it("se a cena si è mangiato altro, il pranzo resta tra i non fatti", () => {
    const diary = deriveDiary([eatenAt("2026-11-17T18:30:00.000Z", "dinner", "Pizza")]);
    expect(missedThisWeek({ ...args, diary, adherence: {} }).map((m) => m.meal)).toEqual(["lunch"]);
  });
});
