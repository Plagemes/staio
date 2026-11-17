// Righe di riferimento "solo nota" (senza importo): nessuna media sotto la soglia. Dati FINTI.
import { describe, expect, it } from "vitest";
import type { NutrientTotal } from "./amounts";
import { compareWithReferences, type ComparableDay, type Profile } from "./reference";
import type { ReferenceValue } from "./types";

const noteOnly: ReferenceValue = {
  nutrient: "folateUg",
  kind: "UL",
  ageMin: 18,
  source: { body: "FINTO", document: "solo test", url: "https://example.invalid" },
  note: "vale solo per l'acido folico aggiunto",
};

const total = (value: number): NutrientTotal => ({
  value,
  missingShare: 0,
  shareBy: "weight",
  missingCount: 0,
  count: 1,
  partial: false,
  certainty: "estimated",
});

const day = (n: number, value: number | undefined, complete = true): ComparableDay => ({
  date: `2026-03-0${n}`,
  complete,
  totals: value === undefined ? {} : { folateUg: total(value) },
});

const woman: Profile = { sex: "female", ageYears: 30 };

describe("riferimenti senza importo", () => {
  it("con meno giorni completi della soglia: dati insufficienti, nessuna media", () => {
    const days = [1, 2, 3, 4].map((n) => day(n, 100));
    const [c] = compareWithReferences(days, [noteOnly], woman);
    expect(c).toMatchObject({ status: "insufficient_data", reason: "few_complete_days" });
    expect("intake" in c).toBe(false);
  });

  it("i giorni parziali non portano la media sopra la soglia", () => {
    const days = [...[1, 2, 3, 4].map((n) => day(n, 100)), day(5, 900, false), day(6, 900, false)];
    const [c] = compareWithReferences(days, [noteOnly], woman);
    expect(c.status).toBe("insufficient_data");
    expect("intake" in c).toBe(false);
  });

  it("con giorni completi ma troppo pochi con il dato: dati insufficienti", () => {
    const days = [day(1, 100), day(2, 100), day(3, undefined), day(4, undefined), day(5, undefined)];
    const [c] = compareWithReferences(days, [noteOnly], woman);
    expect(c).toMatchObject({ status: "insufficient_data", reason: "few_days_with_data", daysWithData: 2 });
    expect("intake" in c).toBe(false);
  });

  it("sopra la soglia resta non confrontabile, con la nota e la media dei soli giorni completi", () => {
    const days = [...[1, 2, 3, 4, 5].map((n) => day(n, 100 + n)), day(6, 900, false)];
    const [c] = compareWithReferences(days, [noteOnly], woman);
    expect(c).toMatchObject({
      status: "not_comparable",
      reason: "no_amount",
      note: "vale solo per l'acido folico aggiunto",
      intake: 103,
    });
  });

  it("la soglia è un parametro anche per queste righe", () => {
    const days = [1, 2, 3].map((n) => day(n, 100));
    expect(compareWithReferences(days, [noteOnly], woman)[0].status).toBe("insufficient_data");
    expect(compareWithReferences(days, [noteOnly], woman, { minCompleteDays: 3 })[0]).toMatchObject({
      status: "not_comparable",
      intake: 100,
    });
  });
});
