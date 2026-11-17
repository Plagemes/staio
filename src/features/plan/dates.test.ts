import { describe, expect, it } from "vitest";
import { dayHeading, dayMonth, weekChoices, weekRangeText, whenText } from "./dates";

describe("dates", () => {
  it("dà le tre settimane a partire da oggi, sempre di lunedì", () => {
    const w = weekChoices("2026-11-18");
    expect(w.map((x) => x.start)).toEqual(["2026-11-09", "2026-11-16", "2026-11-23"]);
    expect(w.map((x) => x.id)).toEqual(["previous", "current", "next"]);
  });

  it("scrive i giorni in italiano", () => {
    expect(dayMonth("2026-11-16")).toBe("16 nov");
    expect(dayHeading("2026-11-16", "2026-11-16")).toBe("Lunedì 16 nov, oggi");
    expect(dayHeading("2026-11-17", "2026-11-16")).toBe("Martedì 17 nov, domani");
    expect(dayHeading("2026-11-19", "2026-11-16")).toBe("Giovedì 19 nov");
    expect(weekRangeText("2026-11-16")).toBe("16 nov – 22 nov");
  });

  it("dice quando serve una cosa", () => {
    expect(whenText("2026-11-16", "2026-11-16")).toBe("oggi");
    expect(whenText("2026-11-17", "2026-11-16")).toBe("domani");
    expect(whenText("2026-11-19", "2026-11-16")).toBe("giovedì");
    expect(whenText("2026-11-30", "2026-11-16")).toBe("il 30 nov");
  });
});
