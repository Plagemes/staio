import { describe, expect, it } from "vitest";
import { addDays } from "../diary";
import { indicatorsOf } from "./indicators";
import { summarizePeriod } from "./period";
import { FAKE_TABLES, THRESHOLDS, fakeFrame, tally } from "./test-helpers";
import type { WeekFrame } from "./types";

function week(weekStart: string, legumes: number, extra: Partial<Omit<WeekFrame, "indicators">> = {}): WeekFrame {
  const base = fakeFrame({ weekStart, weekEnd: addDays(weekStart, 6), ...extra });
  const f = { ...base, rowTallies: { ...base.rowTallies, legumes: tally({ servings: legumes }) } };
  return { ...f, indicators: indicatorsOf(f, 2000, THRESHOLDS, FAKE_TABLES) };
}

describe("summarizePeriod", () => {
  const weeks = [
    week("2026-10-19", 9),
    week("2026-10-26", 1),
    week("2026-11-02", 3),
    week("2026-11-09", 5),
    week("2026-11-16", 2, { daysWithData: 2, completeDays: 2 }),
  ];

  it("conta le settimane che si sovrappongono al periodo e quelle con dati sufficienti", () => {
    const s = summarizePeriod({ weeks }, "2026-10-28", "2026-11-20");
    expect(s).toMatchObject({ from: "2026-10-28", to: "2026-11-20", weeks: 4, sufficientWeeks: 3 });
    const legumes = s.indicators.find((i) => i.id === "group:legumes");
    // settimane sufficienti: 1 (sotto), 3 (dentro), 5 (sopra); quella con 2 giorni non conta.
    expect(legumes).toEqual({ id: "group:legumes", within: 1, below: 1, above: 1, mean: 3 });
  });

  it("senza settimane sufficienti non c'è media", () => {
    const s = summarizePeriod({ weeks }, "2026-11-16", "2026-11-22");
    expect(s).toMatchObject({ weeks: 1, sufficientWeeks: 0 });
    expect(s.indicators.find((i) => i.id === "group:legumes")).toEqual({
      id: "group:legumes",
      within: 0,
      below: 0,
      above: 0,
    });
  });

  it("periodo senza settimane", () => {
    expect(summarizePeriod({ weeks }, "2025-01-01", "2025-01-31")).toEqual({
      from: "2025-01-01",
      to: "2025-01-31",
      weeks: 0,
      sufficientWeeks: 0,
      indicators: [],
    });
  });
});
