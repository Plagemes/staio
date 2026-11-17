import { describe, expect, it } from "vitest";
import { deriveDiary } from "@/core/diary";
import { derivePlan, type PlannedEntry } from "@/core/plan";
import { buildClearDayType } from "./edit";
import { buildDropMeal, buildMoveMeal, missedThisWeek, slotText, slotsToMoveTo } from "./moveMeal";

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
