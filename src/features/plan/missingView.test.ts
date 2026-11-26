import { describe, expect, it } from "vitest";
import type { Lot } from "@/core/ledger";
import type { MissingLine } from "@/core/plan";
import type { PrepRecord } from "@/core/prep";
import { coveredText, listedText, missingLineText, missingSummary, portionsLeftOf, stockLines } from "./missingView";

const line = (name: string, needed: number, have: number, unit: MissingLine["unit"] = "g"): MissingLine => ({ key: name, name, unit, needed, have, missing: Math.max(0, needed - have), for: [] });

describe("missingView", () => {
  it("riassunto: i primi nomi, poi «e altri N»", () => {
    expect(missingSummary({ lines: [line("passata", 400, 0), line("basilico", 10, 0)], unresolved: [] })).toBe("Manca: passata, basilico");
    expect(missingSummary({ lines: ["a", "b", "c", "d", "e"].map((n) => line(n, 1, 0)), unresolved: [] })).toBe("Manca: a, b, c e altri 2");
  });

  it("riassunto: tutto in casa, o non so che cosa serve", () => {
    expect(missingSummary({ lines: [], unresolved: [] })).toBe("Hai tutto in casa");
    expect(missingSummary({ lines: [], unresolved: [{ date: "2026-11-18", meal: "dinner", item: { kind: "recipe", recipeId: "x", servings: 1 } }] })).toBe("Non so che cosa serve");
  });

  it("una riga: servono, ne hai", () => {
    expect(missingLineText(line("passata", 400, 0))).toBe("passata · servono 400 g, ne hai 0");
    expect(missingLineText(line("pasta", 500, 120))).toBe("pasta · servono 500 g, ne hai 120 g");
  });

  it("hai già", () => {
    expect(coveredText({ covered: [] })).toBeUndefined();
    expect(coveredText({ covered: [line("pasta", 80, 500), line("olio", 10, 100, "ml")] })).toBe("Hai già: pasta, olio.");
  });

  it("avviso della spesa", () => {
    expect(listedText(1)).toBe("Aggiunta alla spesa: 1 voce.");
    expect(listedText(3)).toBe("Aggiunte alla spesa: 3 voci.");
  });

  it("dispensa e porzioni pronte dai lotti", () => {
    const lots = [
      { lotId: "l1", productRef: "Pasta", unit: "g", remaining: 300, status: "active" },
      { lotId: "l2", productRef: "Pasta", unit: "g", remaining: 200, status: "active" },
      { lotId: "lp", productRef: "Zuppa", unit: "pz", remaining: 3, status: "active" },
    ] as unknown as Lot[];
    expect(stockLines(lots)).toContainEqual({ name: "Pasta", unit: "g", quantity: 500 });
    const preps = [{ prepId: "zuppa", batchLotId: "lp" }] as unknown as PrepRecord[];
    expect(portionsLeftOf(preps, lots)("zuppa")).toBe(3);
    expect(portionsLeftOf(preps, lots)("altra")).toBe(0);
  });
});
