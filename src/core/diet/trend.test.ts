import { describe, expect, it } from "vitest";
import { indicatorsOf } from "./indicators";
import { FAKE_TABLES, THRESHOLDS, fakeFrame, tally } from "./test-helpers";
import { trendOf, trendsOf } from "./trend";
import type { WeekFrame } from "./types";

describe("trendOf", () => {
  it("servono almeno 4 settimane con dati", () => {
    expect(trendOf([1, 2, 3])).toMatchObject({ direction: "insufficient", weeksWithData: 3 });
    expect(trendOf([1, null, 2, null, 3, null])).toMatchObject({ direction: "insufficient", weeksWithData: 3 });
  });

  it("le lacune restano null e non contano come zero", () => {
    const t = trendOf([2, null, 2, null, 2, 2]);
    expect(t).toMatchObject({ direction: "flat", weeksWithData: 4 });
    expect(t.values).toEqual([2, null, 2, null, 2, 2]);
  });

  it("su e giù confrontando la metà recente con quella vecchia", () => {
    expect(trendOf([1, 1, 2, 2]).direction).toBe("up");
    expect(trendOf([4, 4, 4, 2, 2, 2]).direction).toBe("down");
    // dispari: quella di mezzo resta fuori.
    expect(trendOf([1, 1, 100, 1, 1]).direction).toBe("flat");
  });

  it("una variazione sotto il 15% è piatta", () => {
    expect(trendOf([1, 1, 1.1, 1.1]).direction).toBe("flat");
    expect(trendOf([1, 1, 1.2, 1.2]).direction).toBe("up");
    expect(trendOf([0, 0, 0, 0]).direction).toBe("flat");
    expect(trendOf([0, 0, 1, 1]).direction).toBe("up");
  });

  it("soglie personalizzate", () => {
    expect(trendOf([1, 2], { trendMinWeeks: 2, trendMinRelativeChange: 0.15 }).direction).toBe("up");
  });
});

describe("trendsOf", () => {
  function week(servings: number | undefined, extra: Partial<Omit<WeekFrame, "indicators">> = {}): WeekFrame {
    const base = fakeFrame(extra);
    const f = servings === undefined ? base : { ...base, rowTallies: { ...base.rowTallies, fish: tally({ servings }) } };
    return { ...f, indicators: indicatorsOf(f, 2000, THRESHOLDS, FAKE_TABLES) };
  }

  it("esclude la settimana in corso e mette null dove i dati sono insufficienti", () => {
    const weeks = [
      week(1),
      week(1, { daysWithData: 2, completeDays: 2 }),
      week(1),
      week(3),
      week(3),
      week(9, { inProgress: true }),
    ];
    const t = trendsOf(weeks, THRESHOLDS)["group:fish"];
    expect(t?.values).toEqual([1, null, 1, 3, 3]);
    expect(t?.direction).toBe("up");
  });
});
