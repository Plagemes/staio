// Varianti dello stesso valore di riferimento, con dati FINTI.
import { describe, expect, it } from "vitest";
import type { NutrientTotal } from "./amounts";
import {
  applicableReferences,
  compareWithReferences,
  resolveReferences,
  type ComparableDay,
  type Profile,
  type ReferenceWithVariant,
} from "./reference";
import type { NutrientKey, ReferenceKind } from "./types";

const SOURCE = { body: "FINTO", document: "solo test", url: "https://example.invalid" };

const ref = (
  nutrient: NutrientKey,
  kind: ReferenceKind,
  extra: Partial<ReferenceWithVariant> = {},
): ReferenceWithVariant => ({ nutrient, kind, ageMin: 18, ageMax: 64, source: SOURCE, ...extra });

const v = (
  nutrient: NutrientKey,
  kind: ReferenceKind,
  variant: string,
  amount?: number,
): ReferenceWithVariant =>
  ref(nutrient, kind, { variant, note: `nota ${variant}`, ...(amount !== undefined ? { amount } : {}) });

const total = (value: number): NutrientTotal => ({
  value,
  missingShare: 0,
  shareBy: "weight",
  missingCount: 0,
  count: 1,
  partial: false,
  certainty: "estimated",
});

const days: ComparableDay[] = [1, 2, 3, 4, 5].map((n) => ({
  date: `2026-03-0${n}`,
  complete: true,
  totals: { zincMg: total(9), niacinMg: total(5) },
}));

const woman: Profile = { sex: "female", ageYears: 30 };

const refs: ReferenceWithVariant[] = [
  v("zincMg", "PRI", "A", 10),
  v("zincMg", "PRI", "B", 12),
  v("zincMg", "PRI", "C", 8),
  v("niacinMg", "UL", "forma-1", 900),
  v("niacinMg", "UL", "forma-2", 10),
  v("niacinMg", "UL", "forma-3"),
];

describe("varianti (dati finti)", () => {
  it("senza scelta: PRI con l'importo più alto, UL con il più basso, e lo dice", () => {
    const [zinc, niacin] = resolveReferences(refs, woman);
    expect(zinc.reference.variant).toBe("B");
    expect(zinc.variant).toMatchObject({ applied: "B", how: "default" });
    expect(zinc.variant?.options.map((o) => o.variant)).toEqual(["A", "B", "C"]);
    expect(niacin.reference.variant).toBe("forma-2");
    expect(niacin.variant).toMatchObject({ how: "default" });
    expect(niacin.variant?.options).toHaveLength(3);
  });

  it("applicableReferences dà una sola voce per nutriente e tipo", () => {
    expect(applicableReferences(refs, woman).map((r) => r.variant)).toEqual(["B", "forma-2"]);
  });

  it("la scelta del profilo prevale, per nutriente o per nutriente e tipo", () => {
    const a = resolveReferences(refs, { ...woman, variants: { zincMg: "C" } });
    expect(a[0].reference.variant).toBe("C");
    expect(a[0].variant?.how).toBe("chosen");
    const b = resolveReferences(refs, { ...woman, variants: { zincMg: "C", "zincMg:PRI": "A" } });
    expect(b[0].reference.variant).toBe("A");
    const c = resolveReferences(refs, { ...woman, variants: { "niacinMg:UL": "forma-1" } });
    expect(c[1].reference.variant).toBe("forma-1");
    expect(c[1].variant?.how).toBe("chosen");
  });

  it("una scelta inesistente è ignorata e segnalata", () => {
    const [zinc] = resolveReferences(refs, { ...woman, variants: { zincMg: "Z" } });
    expect(zinc.variant).toMatchObject({ applied: "B", how: "default", requested: "Z" });
  });

  it("le voci senza importo non entrano nella scelta predefinita", () => {
    const [, ul] = resolveReferences(refs, woman);
    expect(ul.reference.amount).toBe(10);
    const only = [v("niacinMg", "UL", "x"), v("niacinMg", "UL", "y")];
    expect(resolveReferences(only, woman)[0].reference.variant).toBe("x");
  });

  it("le varianti si distinguono solo a parità di sesso ed età: la voce più specifica vince", () => {
    const mixed = [
      v("ironMg", "PRI", "generica", 99),
      { ...v("ironMg", "PRI", "donna-1", 16), sex: "female" as const },
      { ...v("ironMg", "PRI", "donna-2", 11), sex: "female" as const },
    ];
    const [r] = resolveReferences(mixed, woman);
    expect(r.reference.variant).toBe("donna-1");
    expect(r.variant?.options.map((o) => o.variant)).toEqual(["donna-1", "donna-2"]);
    expect(resolveReferences(mixed, { sex: "male", ageYears: 30 })[0].variant).toBeUndefined();
  });

  it("il confronto riporta variante applicata, alternative e nota", () => {
    const zinc = compareWithReferences(days, refs, woman)[0];
    expect(zinc).toMatchObject({ status: "compared", note: "nota B" });
    expect(zinc.variant).toMatchObject({ applied: "B", how: "default" });
    expect(zinc.status === "compared" && zinc.outcome).toMatchObject({ referenceAmount: 12 });
    const chosen = compareWithReferences(days, refs, { ...woman, variants: { zincMg: "C" } })[0];
    expect(chosen.status === "compared" && chosen.outcome).toMatchObject({ referenceAmount: 8 });
    expect(chosen.variant?.how).toBe("chosen");
  });

  it("una voce senza importo resta no_amount e porta la nota", () => {
    const out = compareWithReferences(
      days,
      [{ ...ref("niacinMg", "UL"), note: "solo in nota" }],
      woman,
    );
    expect(out[0]).toMatchObject({ status: "not_comparable", reason: "no_amount", note: "solo in nota" });
    expect(out[0].variant).toBeUndefined();
  });

  it("senza varianti il risultato non porta informazioni di variante", () => {
    const out = compareWithReferences(days, [ref("zincMg", "PRI", { amount: 10 })], woman);
    expect(out[0].variant).toBeUndefined();
  });
});
