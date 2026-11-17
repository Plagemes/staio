import { describe, expect, it } from "vitest";
import { mealInstant, mealTargetQuery, parseMealTarget, todayHref } from "./mealTarget";

describe("parseMealTarget", () => {
  it("legge momento e giorno passato", () => {
    expect(parseMealTarget("lunch", "2026-11-14", "2026-11-17")).toEqual({ kind: "lunch", pastDate: "2026-11-14" });
  });
  it("ignora valori non validi, oggi e il futuro", () => {
    expect(parseMealTarget("brunch", "2026-11-17", "2026-11-17")).toEqual({ kind: null, pastDate: null });
    expect(parseMealTarget(null, "2026-11-20", "2026-11-17").pastDate).toBeNull();
    expect(parseMealTarget(null, "ieri", "2026-11-17").pastDate).toBeNull();
  });
});

describe("mealTargetQuery e todayHref", () => {
  it("porta avanti ciò che c'è", () => {
    expect(mealTargetQuery("dinner", "2026-11-14")).toBe("?momento=dinner&giorno=2026-11-14");
    expect(mealTargetQuery("dinner", null)).toBe("?momento=dinner");
    expect(mealTargetQuery(null, null)).toBe("");
  });
  it("torna a Oggi sul giorno giusto", () => {
    expect(todayHref(null)).toBe("/app");
    expect(todayHref("2026-11-14")).toBe("/app?giorno=2026-11-14");
  });
});

describe("mealInstant", () => {
  it("costruisce l'istante all'ora locale del giorno", () => {
    expect(mealInstant("2026-11-14", "13:00", "Europe/Rome")).toBe("2026-11-14T12:00:00.000Z");
    expect(mealInstant("2026-11-14", "boh", "Europe/Rome")).toBeUndefined();
  });
});
