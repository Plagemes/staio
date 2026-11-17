import { describe, expect, it } from "vitest";
import type { NutrientTotal, NutrientTotals } from "./amounts";
import {
  applicableReferences,
  compareWithReferences,
  type ComparableDay,
  type Profile,
} from "./reference";
import type { NutrientKey, ReferenceKind, ReferenceValue } from "./types";

// Valori di riferimento FINTI: servono solo a provare la logica.
const SOURCE = { body: "FINTO", document: "solo test", url: "https://example.invalid" };

const ref = (
  nutrient: NutrientKey,
  kind: ReferenceKind,
  extra: Partial<ReferenceValue> = {},
): ReferenceValue => ({ nutrient, kind, ageMin: 18, ageMax: 64, source: SOURCE, ...extra });

const total = (value: number, extra: Partial<NutrientTotal> = {}): NutrientTotal => ({
  value,
  missingShare: 0,
  shareBy: "weight",
  missingCount: 0,
  count: 1,
  partial: false,
  certainty: "estimated",
  ...extra,
});

const day = (n: number, totals: NutrientTotals, complete = true): ComparableDay => ({
  date: `2026-03-${String(n).padStart(2, "0")}`,
  complete,
  totals,
});

const woman: Profile = { sex: "female", ageYears: 30 };

describe("applicableReferences", () => {
  const refs = [
    ref("ironMg", "PRI", { sex: "female", amount: 18 }),
    ref("ironMg", "PRI", { sex: "male", amount: 11 }),
    ref("ironMg", "PRI", { amount: 99, ageMin: 0, ageMax: 120 }),
    ref("calciumMg", "PRI", { amount: 950, ageMin: 25, ageMax: 64 }),
    ref("calciumMg", "PRI", { amount: 1000, ageMin: 18, ageMax: 24 }),
    ref("calciumMg", "UL", { amount: 2500 }),
    ref("fiberG", "AI", { amount: 25, ageMin: 18, ageMax: undefined }),
  ];

  it("sceglie per sesso ed età, estremi inclusi", () => {
    const f = applicableReferences(refs, woman);
    expect(f.find((r) => r.nutrient === "ironMg")?.amount).toBe(18);
    expect(f.find((r) => r.nutrient === "calciumMg" && r.kind === "PRI")?.amount).toBe(950);
    expect(applicableReferences(refs, { sex: "male", ageYears: 24 }).find((r) => r.nutrient === "calciumMg" && r.kind === "PRI")?.amount).toBe(1000);
    expect(applicableReferences(refs, { sex: "male", ageYears: 64 }).some((r) => r.nutrient === "fiberG")).toBe(true);
  });

  it("tiene PRI e UL dello stesso nutriente e scarta ciò che non vale", () => {
    const f = applicableReferences(refs, woman);
    expect(f.filter((r) => r.nutrient === "calciumMg").map((r) => r.kind).sort()).toEqual(["PRI", "UL"]);
    expect(applicableReferences(refs, { sex: "female", ageYears: 10 })).toEqual([
      refs[2],
    ]);
  });

  it("un valore senza età massima vale per ogni età sopra il minimo", () => {
    expect(applicableReferences(refs, { sex: "female", ageYears: 90 }).some((r) => r.nutrient === "fiberG")).toBe(true);
  });
});

describe("compareWithReferences: PRI, AI, UL", () => {
  const refs = [
    ref("ironMg", "PRI", { amount: 20 }),
    ref("fiberG", "AI", { amount: 25 }),
    ref("calciumMg", "UL", { amount: 2500 }),
  ];
  const days = [1, 2, 3, 4, 5, 6].map((n) =>
    day(n, {
      ironMg: total(10 + n), // media 13,5
      fiberG: total(20, { missingShare: 0.2, certainty: "label" }),
      calciumMg: total(n === 6 ? 3000 : 2000),
    }),
  );

  it("PRI e AI: quota coperta dell'assunzione media", () => {
    const out = compareWithReferences(days, refs, woman);
    const iron = out.find((o) => o.nutrient === "ironMg");
    expect(iron).toMatchObject({ status: "compared", completeDays: 6, daysWithData: 6 });
    expect(iron?.status === "compared" && iron.outcome).toEqual({
      kind: "PRI",
      intake: 13.5,
      referenceAmount: 20,
      coveredShare: 0.675,
    });
    const fiber = out.find((o) => o.nutrient === "fiberG");
    expect(fiber?.status === "compared" && fiber.outcome).toMatchObject({ kind: "AI", coveredShare: 0.8 });
    expect(fiber?.status === "compared" && fiber.averageMissingShare).toBe(0.2);
    expect(fiber?.status === "compared" && fiber.certainty).toBe("label");
  });

  it("l'assunzione sopra il riferimento dà una quota maggiore di 1, non un giudizio", () => {
    const out = compareWithReferences(days, [ref("ironMg", "PRI", { amount: 10 })], woman);
    expect(out[0].status === "compared" && out[0].outcome).toMatchObject({ coveredShare: 1.35 });
  });

  it("UL: superamento della media e giorni oltre il limite", () => {
    const out = compareWithReferences(days, refs, woman).find((o) => o.nutrient === "calciumMg");
    expect(out?.status === "compared" && out.outcome).toMatchObject({
      kind: "UL",
      exceeds: false,
      daysOver: 1,
      limit: 2500,
    });
    const high = days.map((d) => ({ ...d, totals: { calciumMg: total(2600) } }));
    const over = compareWithReferences(high, refs, woman).find((o) => o.nutrient === "calciumMg");
    expect(over?.status === "compared" && over.outcome).toMatchObject({ exceeds: true, daysOver: 6 });
  });

  it("riporta il valore di riferimento usato, con la fonte", () => {
    const out = compareWithReferences(days, refs, woman);
    expect(out[0].reference.source.body).toBe("FINTO");
  });
});

describe("compareWithReferences: dati insufficienti", () => {
  const refs = [ref("ironMg", "PRI", { amount: 20 })];

  it("con meno giorni completi della soglia non dà un numero", () => {
    const days = [1, 2, 3, 4].map((n) => day(n, { ironMg: total(10) }));
    const out = compareWithReferences(days, refs, woman);
    expect(out[0]).toMatchObject({
      status: "insufficient_data",
      reason: "few_complete_days",
      required: 5,
      completeDays: 4,
    });
    expect("outcome" in out[0]).toBe(false);
  });

  it("i giorni parziali non contano, nemmeno se numerosi", () => {
    const days = [
      ...[1, 2, 3, 4].map((n) => day(n, { ironMg: total(10) })),
      ...[5, 6, 7, 8, 9].map((n) => day(n, { ironMg: total(1) }, false)),
    ];
    const out = compareWithReferences(days, refs, woman);
    expect(out[0]).toMatchObject({ status: "insufficient_data", completeDays: 4, periodDays: 9 });
    const enough = compareWithReferences([...days, day(10, { ironMg: total(20) })], refs, woman);
    // La media usa solo i giorni completi: (4 * 10 + 20) / 5 = 12.
    expect(enough[0].status === "compared" && enough[0].outcome).toMatchObject({ intake: 12 });
  });

  it("la soglia è un parametro", () => {
    const days = [1, 2, 3].map((n) => day(n, { ironMg: total(10) }));
    expect(compareWithReferences(days, refs, woman)[0].status).toBe("insufficient_data");
    expect(compareWithReferences(days, refs, woman, { minCompleteDays: 3 })[0].status).toBe("compared");
  });

  it("giorni completi senza il dato del nutriente non valgono zero: dati insufficienti", () => {
    const days = [
      ...[1, 2, 3].map((n) => day(n, { ironMg: total(10) })),
      ...[4, 5, 6].map((n) => day(n, { energyKcal: total(2000) })),
    ];
    const out = compareWithReferences(days, refs, woman);
    expect(out[0]).toMatchObject({
      status: "insufficient_data",
      reason: "few_days_with_data",
      completeDays: 6,
      daysWithData: 3,
    });
  });

  it("il periodo si può restringere", () => {
    const days = [1, 2, 3, 4, 5, 6].map((n) => day(n, { ironMg: total(10) }));
    const out = compareWithReferences(days, refs, woman, { from: "2026-03-03", to: "2026-03-06" });
    expect(out[0]).toMatchObject({ status: "insufficient_data", periodDays: 4 });
  });
});

describe("compareWithReferences: intervalli come quota dell'energia", () => {
  const days = [1, 2, 3, 4, 5].map((n) =>
    day(n, { energyKcal: total(2000), proteinG: total(100), fatG: total(100) }),
  );

  it("calcola la quota dell'energia e la posizione rispetto all'intervallo", () => {
    const refs = [
      ref("proteinG", "RI", { percentEnergy: { min: 10, max: 20 } }),
      ref("fatG", "RI", { percentEnergy: { min: 20, max: 35 } }),
      ref("carbsG", "RI", { percentEnergy: { min: 45 } }),
    ];
    const out = compareWithReferences(days, refs, woman);
    // Proteine: 100 g * 4 kcal / 2000 kcal = 20%. Grassi: 100 * 9 / 2000 = 45%.
    expect(out[0].status === "compared" && out[0].outcome).toMatchObject({
      kind: "RI",
      percentOfEnergy: 20,
      position: "within_range",
    });
    expect(out[1].status === "compared" && out[1].outcome).toMatchObject({
      percentOfEnergy: 45,
      position: "above_range",
    });
    expect(out[2]).toMatchObject({ status: "insufficient_data", reason: "few_days_with_data" });
  });

  it("sotto il minimo", () => {
    const out = compareWithReferences(
      days,
      [ref("proteinG", "RI", { percentEnergy: { min: 25 } })],
      woman,
    );
    expect(out[0].status === "compared" && out[0].outcome).toMatchObject({ position: "below_range" });
  });

  it("non si esprime come quota dell'energia ciò che non porta energia", () => {
    const out = compareWithReferences(
      days,
      [ref("calciumMg", "RI", { percentEnergy: { min: 1 } }), ref("proteinG", "RI", {})],
      woman,
    );
    expect(out[0]).toMatchObject({ status: "not_comparable", reason: "nutrient_without_energy" });
    expect(out[1]).toMatchObject({ status: "not_comparable", reason: "no_energy_range" });
  });

  it("un PRI senza importo non è confrontabile", () => {
    const out = compareWithReferences(days, [ref("proteinG", "PRI", {})], woman);
    expect(out[0]).toMatchObject({ status: "not_comparable", reason: "no_amount" });
  });

  it("senza giorni completi dice dati insufficienti anche per gli intervalli", () => {
    const out = compareWithReferences(
      days.map((d) => ({ ...d, complete: false })),
      [ref("proteinG", "RI", { percentEnergy: { min: 10 } })],
      woman,
    );
    expect(out[0]).toMatchObject({ status: "insufficient_data", reason: "few_complete_days" });
  });
});
