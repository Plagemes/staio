import { describe, expect, it } from "vitest";
import { analyzeMealTiming, formatMinutes } from "./timing";
import { analyze, caffeineOn, day, rng, shuffled } from "./test-helpers";

function regularWeek(days: number, dinner: (i: number) => string = () => "19:30"): unknown[] {
  const events: unknown[] = [];
  for (let i = 0; i < days; i++) {
    events.push(...day(i, { times: { breakfast: "07:30", lunch: "12:30", dinner: dinner(i) } }));
  }
  return events;
}

describe("analyzeMealTiming", () => {
  it("finestra alimentare, medie e regolarità sui giorni completi", () => {
    const { diary } = analyze(regularWeek(10));
    const r = analyzeMealTiming(diary);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.days).toHaveLength(10);
    expect(r.firstMeal.mean).toBe(7 * 60 + 30);
    expect(r.lastMeal.mean).toBe(19 * 60 + 30);
    expect(r.eatingWindow.mean).toBe(12 * 60);
    expect(r.regularity.firstMealSdMinutes).toBe(0);
    expect(r.lateDinner.days).toBe(0);
    expect(r.basis).toMatchObject({ usedDays: 10, excludedDays: 0 });
    expect(formatMinutes(r.firstMeal.mean)).toBe("07:30");
  });

  it("conta le cene tardive e misura la variabilità", () => {
    const { diary } = analyze(regularWeek(10, (i) => (i % 2 === 0 ? "21:30" : "19:00")));
    const r = analyzeMealTiming(diary);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.lateDinner).toMatchObject({ days: 5, of: 10, share: 0.5 });
    expect(r.regularity.lastMealSdMinutes).toBeGreaterThan(60);
  });

  it("l'ultima caffeina conta solo i giorni in cui è registrata", () => {
    const events = regularWeek(8);
    events.push(caffeineOn(0, "08:00"), caffeineOn(0, "15:30"), caffeineOn(1, "09:00"), caffeineOn(2, "17:00"));
    const { diary } = analyze(events);
    const r = analyzeMealTiming(diary);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.lastCaffeine?.n).toBe(3);
    expect(r.lastCaffeine?.mean).toBeCloseTo((15.5 * 60 + 9 * 60 + 17 * 60) / 3, 1);
    expect(r.daysWithoutCaffeineRecord).toBe(5);
  });

  it("esclude e conta i giorni con vuoti", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 12; i++) {
      events.push(...day(i, i < 4 ? { skip: ["lunch"], times: { dinner: "23:30" } } : {}));
    }
    const { diary } = analyze(events);
    const r = analyzeMealTiming(diary);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.basis).toMatchObject({ periodDays: 12, usedDays: 8, excludedDays: 4 });
    expect(r.lateDinner.days).toBe(0);
  });

  it("un pasto dichiarato non tracciato rende il giorno incompleto", () => {
    const events: unknown[] = [];
    for (let i = 0; i < 9; i++) events.push(...day(i, i === 0 ? { untrackedKinds: ["lunch"] } : {}));
    const r = analyzeMealTiming(analyze(events).diary);
    if (r.status !== "ok") throw new Error("atteso ok");
    expect(r.days).toHaveLength(8);
  });

  it("dati insufficienti con pochi giorni completi", () => {
    const r = analyzeMealTiming(analyze(regularWeek(4)).diary);
    expect(r.status).toBe("insufficient");
    if (r.status === "insufficient") {
      expect(r.reasons).toEqual(["few_complete_days"]);
      expect(r).not.toHaveProperty("firstMeal");
    }
    expect(analyzeMealTiming(analyze([]).diary).status).toBe("insufficient");
  });

  it("non dipende dall'ordine degli eventi", () => {
    const events = regularWeek(10, (i) => (i % 3 === 0 ? "21:15" : "20:00"));
    const a = analyzeMealTiming(analyze(events).diary);
    const b = analyzeMealTiming(analyze(shuffled(events, rng(4))).diary);
    expect(b).toEqual(a);
  });

  it("dice l'ultimo giorno usato e segnala come datato un risultato vecchio", () => {
    const { diary } = analyze(regularWeek(10));
    const fresh = analyzeMealTiming(diary, { today: "2026-03-13" });
    if (fresh.status !== "ok") throw new Error("atteso ok");
    expect(fresh.basis.lastDataDate).toBe("2026-03-11");
    expect(fresh.freshness).toMatchObject({ daysBehind: 2, dated: false });
    expect(fresh.warnings).toEqual([]);

    const old = analyzeMealTiming(diary, { today: "2026-04-20" });
    if (old.status !== "ok") throw new Error("atteso ok");
    expect(old.freshness.dated).toBe(true);
    expect(old.warnings[0]).toMatch(/datato/);

    const unknown = analyzeMealTiming(diary);
    if (unknown.status !== "ok") throw new Error("atteso ok");
    expect(unknown.freshness.referenceDate).toBeUndefined();
    expect(unknown.freshness.dated).toBe(false);
  });
});
