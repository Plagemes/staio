// Confronto dell'assunzione con i valori di riferimento. Parla di assunzione rispetto a un
// riferimento, mai di carenza, e si calcola solo sui giorni completi.

import { worseCertainty, type Certainty } from "../ledger";
import { roundValue, type NutrientTotals } from "./amounts";
import type { NutrientKey, ReferenceKind, ReferenceValue, Sex } from "./types";

/**
 * Valore di riferimento con l'eventuale discriminante `variant`: usato quando l'ente dà più valori
 * per lo stesso nutriente, tipo, sesso ed età (per esempio secondo la dieta o la forma chimica).
 * I valori possibili sono dati, non codice: li decide il file dei riferimenti.
 */
export type ReferenceWithVariant = ReferenceValue & { variant?: string };

export interface Profile {
  sex: Sex;
  /** Età in anni (anche con decimali). */
  ageYears: number;
  /**
   * Scelte facoltative tra varianti, con chiave il nutriente (`"zincMg"`) oppure nutriente e tipo
   * (`"niacinMg:UL"`, che prevale) e come valore il nome della variante, così com'è nei dati.
   * Una scelta che non corrisponde a nessuna variante disponibile è ignorata e segnalata.
   */
  variants?: Readonly<Record<string, string>>;
}

/** Il valore si applica al profilo: sesso uguale (o non specificato) ed età nell'intervallo. */
function applies(ref: ReferenceValue, profile: Profile): boolean {
  if (ref.sex !== undefined && ref.sex !== profile.sex) return false;
  if (!Number.isFinite(profile.ageYears)) return false;
  if (profile.ageYears < ref.ageMin) return false;
  return ref.ageMax === undefined || profile.ageYears <= ref.ageMax;
}

const specificity = (ref: ReferenceValue): number =>
  (ref.sex !== undefined ? 1000 : 0) + ref.ageMin - (ref.ageMax ?? 200) / 1000;

const hasAmount = (ref: ReferenceValue): boolean =>
  typeof ref.amount === "number" && Number.isFinite(ref.amount) && ref.amount > 0;

export interface VariantOption {
  variant?: string;
  amount?: number;
  note?: string;
}

/** Presente quando per il profilo esistono più varianti dello stesso valore. */
export interface VariantInfo {
  /** Variante applicata. */
  applied?: string;
  /**
   * `chosen`: scelta dal profilo. `default`: nessuna scelta valida, applicata quella predefinita
   * (PRI e AI: l'importo più alto; UL: il più basso).
   */
  how: "chosen" | "default";
  /** Tutte le varianti disponibili, quella applicata compresa, perché l'interfaccia possa farle scegliere. */
  options: VariantOption[];
  /** Variante richiesta dal profilo ma non disponibile. */
  requested?: string;
}

export interface ResolvedReference {
  reference: ReferenceWithVariant;
  variant?: VariantInfo;
}

function requestedVariant(profile: Profile, ref: ReferenceValue): string | undefined {
  return profile.variants?.[`${ref.nutrient}:${ref.kind}`] ?? profile.variants?.[ref.nutrient];
}

/**
 * Valori applicabili a un profilo, uno per coppia nutriente e tipo, con l'esito della scelta tra
 * varianti. Si prende il gruppo più specifico (con sesso indicato, poi con l'intervallo di età più
 * stretto). Se nel gruppo restano più varianti: vale la scelta del profilo, altrimenti quella
 * predefinita (PRI e AI: importo più alto, UL: più basso; le voci senza importo non si
 * ordinano). Senza varianti, a parità vale il primo. L'ordine dell'elenco di ingresso è mantenuto.
 */
export function resolveReferences(
  references: readonly ReferenceWithVariant[],
  profile: Profile,
): ResolvedReference[] {
  const groups = new Map<string, ReferenceWithVariant[]>();
  for (const ref of references) {
    if (!applies(ref, profile)) continue;
    const key = `${ref.nutrient}|${ref.kind}`;
    const list = groups.get(key);
    if (list) list.push(ref);
    else groups.set(key, [ref]);
  }
  const out: ResolvedReference[] = [];
  for (const group of groups.values()) {
    const top = Math.max(...group.map(specificity));
    const tops = group.filter((r) => specificity(r) === top);
    if (tops.length === 1 || tops.every((r) => r.variant === undefined)) {
      out.push({ reference: tops[0] });
      continue;
    }
    const requested = requestedVariant(profile, tops[0]);
    const picked = requested !== undefined ? tops.find((r) => r.variant === requested) : undefined;
    let reference = picked;
    if (!reference) {
      const ranked = tops.filter(hasAmount);
      const sign = tops[0].kind === "UL" ? 1 : -1;
      ranked.sort((a, b) => sign * ((a.amount as number) - (b.amount as number)));
      reference = ranked[0] ?? tops[0];
    }
    out.push({
      reference,
      variant: {
        ...(reference.variant !== undefined ? { applied: reference.variant } : {}),
        how: picked ? "chosen" : "default",
        options: tops.map((r) => ({
          ...(r.variant !== undefined ? { variant: r.variant } : {}),
          ...(r.amount !== undefined ? { amount: r.amount } : {}),
          ...(r.note !== undefined ? { note: r.note } : {}),
        })),
        ...(requested !== undefined && !picked ? { requested } : {}),
      },
    });
  }
  return out.sort((a, b) => references.indexOf(a.reference) - references.indexOf(b.reference));
}

/** Come `resolveReferences`, senza l'esito sulle varianti. */
export function applicableReferences(
  references: readonly ReferenceWithVariant[],
  profile: Profile,
): ReferenceWithVariant[] {
  return resolveReferences(references, profile).map((r) => r.reference);
}

/**
 * Energia per grammo dei nutrienti che portano energia (fattori di conversione del Reg. UE
 * 1169/2011, allegato XIV): servono a esprimere un nutriente come quota dell'energia.
 */
export const ENERGY_KCAL_PER_G: Partial<Record<NutrientKey, number>> = {
  proteinG: 4,
  carbsG: 4,
  sugarsG: 4,
  fatG: 9,
  saturatedFatG: 9,
  monounsaturatedFatG: 9,
  polyunsaturatedFatG: 9,
  omega3G: 9,
  fiberG: 2,
  alcoholG: 7,
};

/** Ciò che serve di una giornata per il confronto; `DayIntake` lo soddisfa. */
export interface ComparableDay {
  date: string;
  complete: boolean;
  totals: NutrientTotals;
}

export const DEFAULT_MIN_COMPLETE_DAYS = 5;

export interface CompareOptions {
  /** Giorni completi minimi, e giorni con il dato, per dare un numero. Predefinito 5. */
  minCompleteDays?: number;
  /** Primo giorno del periodo (`YYYY-MM-DD`, incluso). */
  from?: string;
  /** Ultimo giorno del periodo (incluso). */
  to?: string;
}

interface ComparisonBase {
  nutrient: NutrientKey;
  kind: ReferenceKind;
  reference: ReferenceWithVariant;
  /** Nota del valore di riferimento (condizioni d'uso, limiti), per mostrarla accanto al numero. */
  note?: string;
  /** Presente se il valore è una scelta tra più varianti: quale è stata applicata e le alternative. */
  variant?: VariantInfo;
  /** Giorni del periodo presenti nei dati. */
  periodDays: number;
  /** Di cui completi. */
  completeDays: number;
  /** Giorni completi in cui il nutriente ha almeno un dato. */
  daysWithData: number;
}

export type InsufficientReason =
  /** Meno giorni completi della soglia. */
  | "few_complete_days"
  /** Abbastanza giorni completi, ma troppo pochi con il dato del nutriente (o dell'energia). */
  | "few_days_with_data";

export type NotComparableReason =
  /** Il valore di riferimento non ha un importo utilizzabile. */
  | "no_amount"
  /** Intervallo senza minimo né massimo, o senza quota dell'energia. */
  | "no_energy_range"
  /** Il nutriente non porta energia: non si può esprimere come quota dell'energia. */
  | "nutrient_without_energy"
  /** Energia totale nulla. */
  | "no_energy";

export type ComparisonOutcome =
  | {
      kind: "PRI" | "AI";
      /** Media giornaliera sui giorni completi con il dato. */
      intake: number;
      referenceAmount: number;
      /** Assunzione divisa per il riferimento: 0,8 = l'80% del riferimento; può superare 1. */
      coveredShare: number;
    }
  | {
      kind: "UL";
      intake: number;
      limit: number;
      /** Assunzione divisa per il limite. */
      ratio: number;
      /** La media supera il limite. */
      exceeds: boolean;
      /** Giorni completi in cui il singolo giorno supera il limite. */
      daysOver: number;
    }
  | {
      kind: "RI";
      /** Quota dell'energia che viene dal nutriente, in percento. */
      percentOfEnergy: number;
      min?: number;
      max?: number;
      position: "below_range" | "within_range" | "above_range";
    };

export type ReferenceComparison =
  | (ComparisonBase & { status: "insufficient_data"; reason: InsufficientReason; required: number })
  | (ComparisonBase & {
      status: "not_comparable";
      reason: NotComparableReason;
      /**
       * Solo per le voci "solo nota" (`no_amount`): assunzione media giornaliera, mostrabile accanto
       * alla nota. C'è solo con giorni completi e giorni con il dato non sotto la soglia, come per
       * ogni altra riga; sotto la soglia il risultato è `insufficient_data` e nessuna media esce.
       */
      intake?: number;
    })
  | (ComparisonBase & {
      status: "compared";
      outcome: ComparisonOutcome;
      /** Media della quota mancante di dato nei giorni usati: più è alta, meno il numero è solido. */
      averageMissingShare: number;
      certainty: Certainty;
    });

const mean = (xs: readonly number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/**
 * Confronta l'assunzione media del periodo con i valori di riferimento applicabili al profilo.
 *
 * Contano solo i giorni completi. Con meno giorni completi della soglia (o, per un nutriente, con
 * meno giorni che ne portano il dato) il risultato è `insufficient_data`, senza numero.
 * Un giorno senza dato per il nutriente non vale zero: è escluso da quella media.
 * PRI e AI danno la quota coperta, UL il superamento, RI la quota dell'energia rispetto
 * all'intervallo.
 */
export function compareWithReferences(
  days: readonly ComparableDay[],
  references: readonly ReferenceWithVariant[],
  profile: Profile,
  options: CompareOptions = {},
): ReferenceComparison[] {
  const min = options.minCompleteDays ?? DEFAULT_MIN_COMPLETE_DAYS;
  const period = days.filter(
    (d) =>
      (options.from === undefined || d.date >= options.from) &&
      (options.to === undefined || d.date <= options.to),
  );
  const complete = period.filter((d) => d.complete);

  return resolveReferences(references, profile).map(({ reference, variant }): ReferenceComparison => {
    const nutrient = reference.nutrient;
    const withData = complete.filter((d) => d.totals[nutrient] !== undefined);
    const base: ComparisonBase = {
      nutrient,
      kind: reference.kind,
      reference,
      ...(reference.note !== undefined ? { note: reference.note } : {}),
      ...(variant ? { variant } : {}),
      periodDays: period.length,
      completeDays: complete.length,
      daysWithData: withData.length,
    };
    const insufficient = (reason: InsufficientReason): ReferenceComparison => ({
      ...base,
      status: "insufficient_data",
      reason,
      required: min,
    });
    const notComparable = (reason: NotComparableReason): ReferenceComparison => ({
      ...base,
      status: "not_comparable",
      reason,
    });

    if (complete.length < min) return insufficient("few_complete_days");

    if (reference.kind === "RI") {
      const range = reference.percentEnergy;
      if (!range || (range.min === undefined && range.max === undefined)) {
        return notComparable("no_energy_range");
      }
      const factor = ENERGY_KCAL_PER_G[nutrient];
      if (factor === undefined) return notComparable("nutrient_without_energy");
      const both = complete.filter(
        (d) => d.totals[nutrient] !== undefined && d.totals.energyKcal !== undefined,
      );
      if (both.length < min) return { ...base, daysWithData: both.length, status: "insufficient_data", reason: "few_days_with_data", required: min };
      let nutrientKcal = 0;
      let energyKcal = 0;
      for (const d of both) {
        nutrientKcal += (d.totals[nutrient]?.value ?? 0) * factor;
        energyKcal += d.totals.energyKcal?.value ?? 0;
      }
      if (energyKcal <= 0) return { ...base, daysWithData: both.length, status: "not_comparable", reason: "no_energy" };
      const percent = roundValue((nutrientKcal / energyKcal) * 100);
      const position =
        range.min !== undefined && percent < range.min
          ? "below_range"
          : range.max !== undefined && percent > range.max
            ? "above_range"
            : "within_range";
      const shares = both.map((d) =>
        Math.max(d.totals[nutrient]?.missingShare ?? 0, d.totals.energyKcal?.missingShare ?? 0),
      );
      const certainties = both.flatMap((d) => [d.totals[nutrient]?.certainty, d.totals.energyKcal?.certainty]);
      return {
        ...base,
        daysWithData: both.length,
        status: "compared",
        outcome: {
          kind: "RI",
          percentOfEnergy: percent,
          ...(range.min !== undefined ? { min: range.min } : {}),
          ...(range.max !== undefined ? { max: range.max } : {}),
          position,
        },
        averageMissingShare: roundValue(mean(shares)),
        certainty: worst(certainties),
      };
    }

    const amount = reference.amount;
    if (withData.length < min) return insufficient("few_days_with_data");
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      return {
        ...base,
        status: "not_comparable",
        reason: "no_amount",
        intake: roundValue(mean(withData.map((d) => d.totals[nutrient]?.value ?? 0))),
      };
    }

    const values = withData.map((d) => d.totals[nutrient]?.value ?? 0);
    const intake = roundValue(mean(values));
    const averageMissingShare = roundValue(
      mean(withData.map((d) => d.totals[nutrient]?.missingShare ?? 0)),
    );
    const certainty = worst(withData.map((d) => d.totals[nutrient]?.certainty));
    if (reference.kind === "UL") {
      return {
        ...base,
        status: "compared",
        outcome: {
          kind: "UL",
          intake,
          limit: amount,
          ratio: roundValue(intake / amount),
          exceeds: intake > amount,
          daysOver: values.filter((v) => v > amount).length,
        },
        averageMissingShare,
        certainty,
      };
    }
    return {
      ...base,
      status: "compared",
      outcome: {
        kind: reference.kind,
        intake,
        referenceAmount: amount,
        coveredShare: roundValue(intake / amount),
      },
      averageMissingShare,
      certainty,
    };
  });
}

function worst(items: readonly (Certainty | undefined)[]): Certainty {
  let out: Certainty = "measured";
  for (const c of items) if (c !== undefined) out = worseCertainty(out, c);
  return out;
}
