import { describe, expect, expectTypeOf, it } from "vitest";
import {
  ADVICE_RULE_IDS,
  DIET_GROUPS,
  DIET_THRESHOLDS,
  ENERGY_LEVELS,
  GROUP_ROW_IDS,
  GUIDELINE_ROW_IDS,
  INDICATOR_STATUSES,
  MEASURE_INDICATOR_IDS,
  MEASURE_ROW_IDS,
  PORTION_KEYS,
  PROCESSING_LEVELS,
  ROW_INDICATOR,
  SOURCE_IDS,
  TARGET_KINDS,
  UNCLASSIFIED,
  type AdviceAction,
  type AdviceActionKind,
  type DietGroup,
  type GuidelineRowId,
  type IndicatorId,
  type WeekFrame,
} from "./types";

const lists: Record<string, readonly (string | number)[]> = {
  DIET_GROUPS,
  UNCLASSIFIED,
  PORTION_KEYS,
  GUIDELINE_ROW_IDS,
  TARGET_KINDS,
  INDICATOR_STATUSES,
  MEASURE_INDICATOR_IDS,
  ADVICE_RULE_IDS,
  SOURCE_IDS,
  ENERGY_LEVELS,
  PROCESSING_LEVELS,
};

describe("contratto di core/diet", () => {
  it("gli elenchi non hanno doppioni", () => {
    for (const [name, list] of Object.entries(lists)) {
      expect(new Set(list).size, name).toBe(list.length);
    }
  });

  it("ha le dimensioni del progetto", () => {
    expect(DIET_GROUPS).toHaveLength(23);
    expect(PORTION_KEYS).toHaveLength(33);
    expect(GUIDELINE_ROW_IDS).toHaveLength(30);
    expect(ADVICE_RULE_IDS).toHaveLength(12);
  });

  it("i non classificati non sono gruppi", () => {
    for (const u of UNCLASSIFIED) expect(DIET_GROUPS as readonly string[]).not.toContain(u);
  });

  it("le righe si dividono senza sovrapporsi tra gruppi e misure", () => {
    const groups = new Set<string>(GROUP_ROW_IDS);
    for (const id of MEASURE_ROW_IDS) expect(groups.has(id)).toBe(false);
    expect(Object.keys(ROW_INDICATOR).sort()).toEqual([...MEASURE_ROW_IDS].sort());
  });

  it("le soglie sono quelle dichiarate e non si modificano", () => {
    expect(DIET_THRESHOLDS).toEqual({
      minDaysWithData: 4,
      minCompleteDays: 4,
      minCoverage: 0.7,
      belowDays: 6,
      belowCoverage: 0.8,
      trendMinWeeks: 4,
      trendMinRelativeChange: 0.15,
    });
    expect(Object.isFrozen(DIET_THRESHOLDS)).toBe(true);
  });

  it("i tipi derivano dagli elenchi", () => {
    expectTypeOf<DietGroup>().toEqualTypeOf<(typeof DIET_GROUPS)[number]>();
    expectTypeOf<GuidelineRowId>().toEqualTypeOf<(typeof GUIDELINE_ROW_IDS)[number]>();
    expectTypeOf<"group:legumes">().toMatchTypeOf<IndicatorId>();
    expectTypeOf<"vegFruit">().toMatchTypeOf<IndicatorId>();
    expectTypeOf<"group:salt">().not.toMatchTypeOf<IndicatorId>();
    expectTypeOf<AdviceActionKind>().toEqualTypeOf<AdviceAction["kind"]>();
    expectTypeOf<WeekFrame["tallies"]>().toEqualTypeOf<Readonly<Record<DietGroup, WeekFrame["tallies"][DietGroup]>>>();
  });
});
