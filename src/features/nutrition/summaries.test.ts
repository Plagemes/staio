import { describe, expect, it } from "vitest";
import type { ProteinSpread } from "@/core/nutrition";
import { FOODS } from "@/core/nutrition/data/foods";
import { createFoodSearch, nameStartsWith } from "./candidates";
import type { ComparisonRow, NutritionRows } from "./prepare";
import { FEW_DATA, comparisonGateText, otherNutrientsTitle, splitComparisons, spreadSummary, unresolvedTitle, varietySummary } from "./summaries";

const spread = (over: Partial<ProteinSpread>): ProteinSpread =>
  ({ from: "2026-11-12", to: "2026-11-18", daysWithData: 5, completeDays: 5, moments: [], topIsMajority: false, partial: false, ...over }) as ProteinSpread;
const moments = (shares: [string, number][]) => shares.map(([moment, share]) => ({ moment, share })) as unknown as ProteinSpread["moments"];

describe("i riepiloghi delle righe richiuse", () => {
  it("proteine: il momento che prevale, o nessuno; senza giorni completi «pochi dati»", () => {
    expect(spreadSummary(spread({ top: "lunch", topIsMajority: true, moments: moments([["lunch", 0.734], ["dinner", 0.266]]) }))).toBe("soprattutto a pranzo (73%)");
    expect(spreadSummary(spread({ top: "dinner", topIsMajority: false, moments: moments([["dinner", 0.4], ["lunch", 0.35], ["breakfast", 0.25]]) }))).toBe(
      "nessun momento prevale (il più alto 40%)",
    );
    expect(spreadSummary(spread({ completeDays: 0, top: undefined }))).toBe(FEW_DATA);
  });

  it("varietà: il numero della settimana, o «pochi dati»", () => {
    expect(varietySummary({ empty: false, headline: "12 vegetali diversi", coverage: "", trend: "" })).toBe("12 vegetali diversi in 7 giorni");
    expect(varietySummary({ empty: true, headline: "", coverage: "", trend: "" })).toBe("pochi dati");
  });

  it("i titoli con il numero", () => {
    expect(unresolvedTitle(2)).toBe("Voci non riconosciute (2)");
    expect(unresolvedTitle(0)).toBe("Voci non riconosciute");
    expect(otherNutrientsTitle(9)).toBe("Altri nutrienti (9)");
  });

  it("al massimo sei confronti in vista; il resto, le note e i dati insufficienti nella riga richiusa", () => {
    const row = (i: number, kind: ComparisonRow["kind"]) => ({ id: `n${i}:${kind}`, kind }) as ComparisonRow;
    const rows: NutritionRows = {
      compared: Array.from({ length: 10 }, (_, i) => row(i, "compared")),
      notes: [row(20, "note")],
      insufficient: [row(30, "insufficient"), row(31, "insufficient")],
    };
    const split = splitComparisons(rows);
    expect(split.shown.map((r) => r.id)).toEqual(["n0:compared", "n1:compared", "n2:compared", "n3:compared", "n4:compared", "n5:compared"]);
    expect(split.more).toHaveLength(4);
    expect(split.hidden).toBe(7);
    const few = splitComparisons({ compared: rows.compared.slice(0, 3), notes: [], insufficient: [] });
    expect(few.shown).toHaveLength(3);
    expect(few.hidden).toBe(0);
  });

  it("perché il confronto non c'è, in una riga", () => {
    expect(comparisonGateText({ hasProfile: false, completeDays: 7, required: 5 })).toBe("Per il confronto servono sesso ed età.");
    expect(comparisonGateText({ hasProfile: true, completeDays: 2, required: 5 })).toBe("Per il confronto servono almeno 5 giorni contati: ne hai 2.");
    expect(comparisonGateText({ hasProfile: true, completeDays: 5, required: 5 })).toBeUndefined();
  });

  it("nessun giudizio nei riepiloghi", () => {
    const texts = [spreadSummary(spread({ top: "lunch", topIsMajority: true, moments: moments([["lunch", 0.9]]) })), comparisonGateText({ hasProfile: true, completeDays: 1, required: 5 })];
    for (const t of texts) expect(t).not.toMatch(/troppo|poco|bene|dovresti/i);
  });
});

describe("11. le proposte di alimento sulla tabella vera", () => {
  const search = createFoodSearch(FOODS);
  const ids = (query: string) => search.groups(query).flatMap((g) => g.options.map((o) => o.id));

  it("«pizza» e «pizza margherita» non propongono la mozzarella", () => {
    for (const q of ["pizza", "pizza margherita", "Pizza Margherita"]) {
      expect(ids(q).some((id) => id.startsWith("mozzarella"))).toBe(false);
    }
  });

  it("«pasta» propone i gemelli secca e cotta affiancati, in testa", () => {
    const first = search.groups("pasta")[0];
    expect(first.twins).toBe(true);
    expect(first.options.map((o) => o.id).sort()).toEqual(["pasta-cotta", "pasta-secca"]);
  });

  it("«mozzarella» propone una mozzarella", () => {
    expect(ids("mozzarella").some((id) => id.startsWith("mozzarella"))).toBe(true);
  });

  it("una parola scritta deve essere l'inizio di una parola del nome, fuori dalle parentesi", () => {
    expect(nameStartsWith("Mozzarella per pizza", "mozz")).toBe(true);
    expect(nameStartsWith("Mozzarella (per pizza)", "pizza")).toBe(false);
    expect(nameStartsWith("Pasta di semola, secca", "pasta secca")).toBe(true);
    expect(nameStartsWith("Pasta di semola, secca", "asta")).toBe(false);
  });
});
