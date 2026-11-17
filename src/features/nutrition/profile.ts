// Profilo per scegliere i riferimenti: sesso, età e scelte tra varianti. Logica pura.
import {
  resolveReferences,
  type Profile,
  type ReferenceKind,
  type ReferenceWithVariant,
  type Sex,
  type NutrientKey,
} from "@/core/nutrition";

export const PROFILE_SETTING_KEY = "nutritionProfile";
/** I riferimenti dei dati valgono dai 18 anni in su. */
export const MIN_PROFILE_AGE = 18;
export const MAX_PROFILE_AGE = 120;

/** Come si conserva: l'età è quella dichiarata nel giorno `savedOn`, poi invecchia da sola. */
export interface NutritionProfile {
  sex: Sex;
  age: number;
  /** Data di calendario `YYYY-MM-DD` in cui è stata scritta l'età. */
  savedOn: string;
  /** Scelte tra varianti, per chiave `nutriente:tipo` (per esempio `zincMg:PRI`). */
  variants: Record<string, string>;
}

export function isNutritionProfile(value: unknown): value is NutritionProfile {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  return (
    (p.sex === "female" || p.sex === "male") &&
    typeof p.age === "number" &&
    Number.isFinite(p.age) &&
    typeof p.savedOn === "string" &&
    typeof p.variants === "object" &&
    p.variants !== null &&
    Object.values(p.variants).every((v) => typeof v === "string")
  );
}

export type AgeReading = { ok: true; value: number } | { ok: false; error: string };

export function parseAge(text: string): AgeReading {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return { ok: false, error: "Scrivi l'età in anni, per esempio 42." };
  const age = Number(t);
  if (age < MIN_PROFILE_AGE) {
    return { ok: false, error: `I valori di riferimento che uso valgono dai ${MIN_PROFILE_AGE} anni in su: per te non so confrontare.` };
  }
  if (age > MAX_PROFILE_AGE) return { ok: false, error: "Controlla l'età." };
  return { ok: true, value: age };
}

/** Età di oggi: quella dichiarata più gli anni interi passati da allora (a ricorrenza di calendario). */
export function currentAge(profile: Pick<NutritionProfile, "age" | "savedOn">, today: string): number {
  if (today <= profile.savedOn) return profile.age;
  const years = Number(today.slice(0, 4)) - Number(profile.savedOn.slice(0, 4));
  const passed = today.slice(5) >= profile.savedOn.slice(5) ? years : years - 1;
  return profile.age + Math.max(0, passed);
}

/** Il profilo come lo vuole il motore. */
export function toEngineProfile(profile: NutritionProfile, today: string): Profile {
  return { sex: profile.sex, ageYears: currentAge(profile, today), variants: profile.variants };
}

export const variantKey = (nutrient: NutrientKey, kind: ReferenceKind): string => `${nutrient}:${kind}`;

export interface VariantChoice {
  key: string;
  nutrient: NutrientKey;
  kind: ReferenceKind;
  /** `chosen`: scelta dal profilo; `default`: applicata la predefinita del motore. */
  how: "chosen" | "default";
  applied?: string;
  options: { variant: string; amount?: number }[];
}

/**
 * Le scelte tra varianti che esistono per questo profilo, prese dai dati: se per il profilo non c'è
 * alcuna ambiguità (per esempio un uomo non ha il ferro in due varianti) l'elenco è vuoto.
 */
export function variantChoices(references: readonly ReferenceWithVariant[], profile: Profile): VariantChoice[] {
  const out: VariantChoice[] = [];
  for (const r of resolveReferences(references, profile)) {
    if (!r.variant) continue;
    const options = r.variant.options.flatMap((o) => (o.variant !== undefined ? [{ variant: o.variant, ...(o.amount !== undefined ? { amount: o.amount } : {}) }] : []));
    if (options.length < 2) continue;
    out.push({
      key: variantKey(r.reference.nutrient, r.reference.kind),
      nutrient: r.reference.nutrient,
      kind: r.reference.kind,
      how: r.variant.how,
      ...(r.variant.applied !== undefined ? { applied: r.variant.applied } : {}),
      options,
    });
  }
  return out;
}

/** Profilo senza la scelta indicata (torna alla variante predefinita). */
export function withVariant(profile: NutritionProfile, key: string, variant: string | null): NutritionProfile {
  const variants = { ...profile.variants };
  if (variant === null) delete variants[key];
  else variants[key] = variant;
  return { ...profile, variants };
}
