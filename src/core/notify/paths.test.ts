import { describe, expect, it } from "vitest";
import { isQuiet } from "./prefs";
import { safeAppPath } from "./paths";

describe("safeAppPath", () => {
  it("accetta pagine sotto /app, con query e ancora", () => {
    expect(safeAppPath("/app")).toBe("/app");
    expect(safeAppPath("/app/dispensa")).toBe("/app/dispensa");
    expect(safeAppPath("/app/impostazioni/avvisi?x=1#a")).toBe("/app/impostazioni/avvisi?x=1#a");
  });

  it("rifiuta tutto il resto e ripiega su /app", () => {
    for (const bad of [
      "https://evil.example/app",
      "//evil.example/app",
      "/\\evil.example",
      "/appendice",
      "/api/ricetta",
      "/app/../api/x",
      "/app/%2e%2e/api",
      "javascript:alert(1)",
      "app/dispensa",
      "/app/a\nb",
      "",
      null,
      42,
    ]) {
      expect(safeAppPath(bad)).toBe("/app");
    }
  });
});

describe("isQuiet", () => {
  const night = { enabled: true, from: "22:00", to: "08:00" };
  it("attraversa la mezzanotte", () => {
    expect(isQuiet(23 * 60, night)).toBe(true);
    expect(isQuiet(3 * 60, night)).toBe(true);
    expect(isQuiet(8 * 60, night)).toBe(false);
    expect(isQuiet(12 * 60, night)).toBe(false);
  });
  it("finestra nello stesso giorno e disattivata", () => {
    expect(isQuiet(13 * 60, { enabled: true, from: "13:00", to: "15:00" })).toBe(true);
    expect(isQuiet(15 * 60, { enabled: true, from: "13:00", to: "15:00" })).toBe(false);
    expect(isQuiet(23 * 60, { ...night, enabled: false })).toBe(false);
  });
});
