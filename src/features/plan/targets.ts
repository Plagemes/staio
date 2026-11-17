// Obiettivi giornalieri: dai campi di testo agli obiettivi del piano e ritorno. Nessun valore predefinito:
// i campi restano vuoti finché l'utente non li compila. Il valore di riferimento del profilo è solo un'informazione.
import type { NutrientKey, ResolvedReference } from "@/core/nutrition";
import type { NutrientTargets, TargetRange } from "@/core/plan";
import { REFERENCE_KIND_LABELS, formatNutrient } from "../nutrition/labels";

/** I nutrienti per cui si possono scrivere obiettivi, nell'ordine in cui compaiono. */
export const TARGET_NUTRIENTS: readonly NutrientKey[] = [
  "energyKcal",
  "proteinG",
  "carbsG",
  "fatG",
  "saturatedFatG",
  "sugarsG",
  "fiberG",
  "saltG",
];

export interface TargetField {
  min: string;
  max: string;
}

export type TargetForm = Partial<Record<NutrientKey, TargetField>>;

/** "1800", "1.800", "1800,5": un numero non negativo, o `null`. */
export function parseAmount(text: string): number | null {
  const t = text.trim().replace(/\s+/g, "");
  if (t === "") return null;
  const normalized = /^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export type TargetsReading =
  | { ok: true; targets: NutrientTargets }
  | { ok: false; errors: Partial<Record<NutrientKey, string>> };

export function targetsFromForm(form: TargetForm): TargetsReading {
  const targets: NutrientTargets = {};
  const errors: Partial<Record<NutrientKey, string>> = {};
  for (const key of TARGET_NUTRIENTS) {
    const field = form[key];
    if (!field) continue;
    const minText = field.min.trim();
    const maxText = field.max.trim();
    if (minText === "" && maxText === "") continue;
    const min = minText === "" ? undefined : parseAmount(minText);
    const max = maxText === "" ? undefined : parseAmount(maxText);
    if (min === null || max === null) {
      errors[key] = "Scrivi un numero, per esempio 90 o 1,5.";
      continue;
    }
    if (min !== undefined && max !== undefined && min > max) {
      errors[key] = "Il minimo non può superare il massimo.";
      continue;
    }
    const range: TargetRange = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
    targets[key] = range;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, targets };
}

const show = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));

export function formFromTargets(targets: NutrientTargets | undefined): TargetForm {
  const form: TargetForm = {};
  for (const key of TARGET_NUTRIENTS) {
    const t = targets?.[key];
    form[key] = { min: show(t?.min), max: show(t?.max) };
  }
  return form;
}

/**
 * Il riferimento del profilo accanto a un campo: "Riferimento per il tuo profilo: 63 g (assunzione raccomandata, EFSA)".
 * Mai per l'energia: non c'è un obiettivo di energia da proporre.
 */
export function referenceHint(resolved: readonly ResolvedReference[], nutrient: NutrientKey): string | undefined {
  if (nutrient === "energyKcal") return undefined;
  const parts: string[] = [];
  for (const { reference: r } of resolved) {
    if (r.nutrient !== nutrient) continue;
    if (r.amount !== undefined && r.amount > 0) {
      parts.push(`${formatNutrient(nutrient, r.amount)} al giorno (${REFERENCE_KIND_LABELS[r.kind]}, ${r.source.body})`);
    } else if (r.percentEnergy && (r.percentEnergy.min !== undefined || r.percentEnergy.max !== undefined)) {
      const { min, max } = r.percentEnergy;
      const range = min !== undefined && max !== undefined ? `${min}–${max}` : min !== undefined ? `almeno ${min}` : `al massimo ${max}`;
      parts.push(`${range}% dell'energia (${REFERENCE_KIND_LABELS[r.kind]}, ${r.source.body})`);
    }
  }
  return parts.length > 0 ? `Riferimento per il tuo profilo: ${parts.join("; ")}.` : undefined;
}
