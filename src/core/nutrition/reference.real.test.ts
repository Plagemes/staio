// Integrazione con i valori di riferimento REALI (data/reference.ts): controlla solo che il motore
// li accetti tutti senza errori e che le varianti siano risolte. Nessun numero scritto qui: ogni
// atteso si ricava dai dati. I test con dati finti stanno in reference.test.ts e
// reference.variants.test.ts.
import { describe, expect, it } from "vitest";
import type { NutrientTotal, NutrientTotals } from "./amounts";
import { REFERENCE_VALUES } from "./data/reference";
import {
  applicableReferences,
  compareWithReferences,
  resolveReferences,
  type ComparableDay,
  type Profile,
  type ReferenceWithVariant,
} from "./reference";
import { NUTRIENT_KEYS } from "./types";

const refs: readonly ReferenceWithVariant[] = REFERENCE_VALUES;
const groupKey = (r: ReferenceWithVariant): string => `${r.nutrient}|${r.kind}`;

const total = (value: number): NutrientTotal => ({
  value,
  missingShare: 0,
  shareBy: "weight",
  missingCount: 0,
  count: 1,
  partial: false,
  certainty: "estimated",
});
const totals: NutrientTotals = Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, total(100)]));
const days: ComparableDay[] = [1, 2, 3, 4, 5].map((n) => ({
  date: `2026-03-0${n}`,
  complete: true,
  totals,
}));

const profiles: Profile[] = [
  { sex: "female", ageYears: 18 },
  { sex: "female", ageYears: 35 },
  { sex: "female", ageYears: 60 },
  { sex: "male", ageYears: 18 },
  { sex: "male", ageYears: 45 },
  { sex: "male", ageYears: 90 },
];

describe("valori di riferimento reali", () => {
  it("il motore li accetta tutti, per ogni profilo, senza errori", () => {
    for (const profile of profiles) {
      const out = compareWithReferences(days, refs, profile);
      expect(out.length).toBeGreaterThan(0);
      for (const c of out) {
        // 5 giorni completi con ogni dato: mai "dati insufficienti".
        expect(["compared", "not_comparable"]).toContain(c.status);
        if (c.status === "compared") {
          for (const x of Object.values(c.outcome)) {
            if (typeof x === "number") expect(Number.isFinite(x)).toBe(true);
          }
        }
      }
    }
  });

  it("per ogni profilo c'è una sola voce per nutriente e tipo", () => {
    for (const profile of profiles) {
      const keys = applicableReferences(refs, profile).map(groupKey);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("ogni voce senza importo e senza intervallo è non confrontabile e porta la sua nota", () => {
    const noAmount = refs.filter((r) => r.kind !== "RI" && r.amount === undefined);
    expect(noAmount.length).toBeGreaterThan(0);
    for (const profile of profiles) {
      for (const c of compareWithReferences(days, noAmount, profile)) {
        expect(c).toMatchObject({ status: "not_comparable", reason: "no_amount" });
        expect(c.note).toBe(c.reference.note);
      }
    }
  });

  it("gli intervalli come quota dell'energia sono confrontati", () => {
    const ri = refs.filter((r) => r.kind === "RI" && r.percentEnergy);
    expect(ri.length).toBeGreaterThan(0);
    for (const c of compareWithReferences(days, ri, profiles[1])) {
      expect(c.status === "compared" && c.outcome.kind).toBe("RI");
    }
  });

  it("le varianti sono risolte: predefinita più alta per PRI e AI, più bassa per UL, dichiarata", () => {
    const variantGroups = new Set(refs.filter((r) => r.variant !== undefined).map(groupKey));
    expect(variantGroups.size).toBeGreaterThan(0);
    let withInfo = 0;
    for (const profile of profiles) {
      for (const r of resolveReferences(refs, profile)) {
        if (!r.variant) continue;
        withInfo++;
        expect(variantGroups.has(groupKey(r.reference))).toBe(true);
        expect(r.variant.how).toBe("default");
        expect(r.variant.options.length).toBeGreaterThan(1);
        expect(r.variant.applied).toBe(r.reference.variant);
        const amounts = r.variant.options.flatMap((o) => (o.amount !== undefined ? [o.amount] : []));
        if (amounts.length > 0) {
          const expected = r.reference.kind === "UL" ? Math.min(...amounts) : Math.max(...amounts);
          expect(r.reference.amount).toBe(expected);
        }
      }
    }
    expect(withInfo).toBeGreaterThan(0);
  });

  it("la scelta di ciascuna variante presente nei dati viene applicata", () => {
    let chosen = 0;
    for (const profile of profiles) {
      for (const r of resolveReferences(refs, profile)) {
        if (!r.variant) continue;
        for (const option of r.variant.options) {
          if (option.variant === undefined) continue;
          const group = refs.filter((x) => groupKey(x) === groupKey(r.reference));
          const [again] = resolveReferences(group, {
            ...profile,
            variants: { [`${r.reference.nutrient}:${r.reference.kind}`]: option.variant },
          });
          expect(again.reference.variant).toBe(option.variant);
          expect(again.variant?.how).toBe("chosen");
          chosen++;
        }
      }
    }
    expect(chosen).toBeGreaterThan(0);
  });
});
