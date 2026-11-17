import { describe, expect, it } from "vitest";
import type { ConstraintsResult } from "@/core/plan";
import { constraintLines } from "./verify";

const nameOfRef = () => "Panino";

describe("righe della verifica con le conferme", () => {
  it("un ingrediente confermato è una riga distinta, con la data e la precisazione che l'app non ha verificato", () => {
    const result: ConstraintsResult = {
      ok: true,
      verified: true,
      violations: [],
      unverified: [],
      confirmed: [
        { date: "2026-03-09", meal: "lunch", item: { name: "Prosciutto cotto" }, via: { kind: "recipe", id: "p" }, terms: ["latte", "glutine"], confirmedAt: "2026-03-05T12:00:00.000Z" },
      ],
    };
    const lines = constraintLines(result, nameOfRef);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.kind).toBe("confirmed");
    expect(lines[0]?.text).toContain("Prosciutto cotto (da Panino): confermato da te il");
    expect(lines[0]?.text).toContain("per latte e glutine");
    expect(lines[0]?.text).toContain("l'app non l'ha verificato");
  });

  it("dopo le violazioni e i dubbi dello stesso giorno", () => {
    const result: ConstraintsResult = {
      ok: false,
      verified: false,
      violations: [{ code: "allergen", date: "2026-03-09", meal: "lunch", term: "latte", item: { name: "Burro" } }],
      unverified: [{ code: "unknown_allergens", date: "2026-03-09", meal: "lunch", item: { name: "Crema" } }],
      confirmed: [{ date: "2026-03-09", meal: "lunch", item: { name: "Prosciutto cotto" }, terms: ["latte"], confirmedAt: "2026-03-05T12:00:00.000Z" }],
    };
    expect(constraintLines(result, nameOfRef).map((l) => l.kind)).toEqual(["violation", "unverified", "confirmed"]);
  });
});
