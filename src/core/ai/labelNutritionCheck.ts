// Controlli di plausibilità sui valori di una tabella nutrizionale, letti dal modello o corretti dall'utente.
// Non correggono mai niente: dicono cosa non torna. `error` impedisce di confermare (valore impossibile, base dei valori
// da scegliere); `warning` avvisa e basta, perché un'etichetta può contenere errori e un prodotto può avere alcol.
import { problem, type ReadProblem } from "./labelShared";
import { KJ_PER_KCAL, type LabelBasis, type LabelNutrients, type NutrientField } from "./labelNutritionParse";

/** Tolleranza sulla somma dei macronutrienti, per gli arrotondamenti dell'etichetta. */
export const MACRO_SUM_TOLERANCE_G = 1;
/** Sotto o sopra questo scarto, kcal e macro non tornano: il maggiore tra un valore fisso e una quota. */
export const ENERGY_TOLERANCE_KCAL = 25;
export const ENERGY_TOLERANCE_SHARE = 0.2;
/** Il grasso puro ha circa 900 kcal per 100 g: oltre, non è un valore per 100 g. */
export const MAX_KCAL_PER_100 = 900;
/** Oltre questo valore l'energia non è credibile per nessuna base. */
export const MAX_KCAL_ANY = 5000;
/** Quanto kcal e kJ possono scostarsi tra loro (le etichette arrotondano). */
export const KJ_KCAL_TOLERANCE = 0.15;
const SUBSET_TOLERANCE_G = 0.15;

export interface CheckInput {
  nutrients: LabelNutrients;
  /** Base scelta per i valori; `serving` e `unclear` non si possono confermare. */
  basis: LabelBasis;
  energyKj?: number;
  /** L'utente ha confermato che l'energia è in kcal (serve quando non ci sono macro con cui confrontarla). */
  kcalConfirmed?: boolean;
  /** Le kcal sono calcolate dai kJ: l'unità è nota. */
  energyDerived?: boolean;
}

/** Kcal attese dai macro (Atwater: 4 per proteine e carboidrati, 9 per i grassi, 2 per le fibre). */
export function expectedKcal(n: LabelNutrients): number | undefined {
  if (n.proteins === undefined || n.carbohydrates === undefined || n.fat === undefined) return undefined;
  return 4 * n.proteins + 4 * n.carbohydrates + 9 * n.fat + 2 * (n.fiber ?? 0);
}

export const kjToKcal = (kj: number): number => Math.round(kj / KJ_PER_KCAL);

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

const FIELD_NAMES: Record<NutrientField, string> = {
  energyKcal: "Energia",
  fat: "Grassi",
  saturatedFat: "Saturi",
  carbohydrates: "Carboidrati",
  sugars: "Zuccheri",
  fiber: "Fibre",
  proteins: "Proteine",
  salt: "Sale",
};

/** Riporta i valori per porzione a 100 (g o ml). Lo fa solo l'utente, con un tocco: mai da sola. */
export function scaleToPer100(n: LabelNutrients, serving: number): LabelNutrients {
  if (!(serving > 0)) return n;
  const factor = 100 / serving;
  const out: LabelNutrients = {};
  for (const key of Object.keys(n) as NutrientField[]) {
    const v = n[key];
    if (v !== undefined) out[key] = key === "energyKcal" ? Math.round(v * factor) : Math.round(v * factor * 100) / 100;
  }
  return out;
}

export function checkLabelNutrients(input: CheckInput): ReadProblem[] {
  const { nutrients: n, basis } = input;
  const out: ReadProblem[] = [];
  const fields = Object.keys(n) as NutrientField[];

  const hasValues = fields.some((f) => n[f] !== undefined);
  if (!hasValues) return out;
  if (basis === "serving") {
    out.push(problem("per_serving", "error", "Questi valori sono per porzione, non per 100: qui servono quelli per 100 g o 100 ml. Cerca l'altra colonna, oppure riportali a 100 se conosci la porzione."));
  } else if (basis === "unclear") {
    out.push(problem("basis_unclear", "error", "Non è chiaro se i valori sono per 100 g o per 100 ml: scegli."));
  }

  for (const f of fields) {
    const v = n[f];
    if (v === undefined) continue;
    if (!Number.isFinite(v) || v < 0) {
      out.push(problem("invalid_value", "error", `${FIELD_NAMES[f]}: il valore non è valido.`, f));
    } else if (f !== "energyKcal" && basis !== "serving" && v > 100) {
      out.push(problem("implausible", "error", `${FIELD_NAMES[f]}: più di 100 g su 100 g non può essere. Controlla la virgola.`, f));
    }
  }

  const expected = expectedKcal(n);
  const kcal = n.energyKcal;
  let kjSuspected = false;
  if (kcal !== undefined && Number.isFinite(kcal) && kcal >= 0) {
    const ratio = expected !== undefined && expected > 20 ? kcal / expected : undefined;
    const sameAsKj = input.energyKj !== undefined && kcal > 100 && Math.abs(kcal - input.energyKj) <= input.energyKj * 0.02;
    const ratioKj = ratio !== undefined && kcal > 100 && ratio >= 3.6 && ratio <= 4.8;
    const tooHigh = (kcal > MAX_KCAL_PER_100 && basis !== "serving") || kcal > MAX_KCAL_ANY;
    if (sameAsKj || ratioKj) {
      kjSuspected = true;
      // uguali ai kJ letti, o oltre il possibile: impossibile da salvare così; dai soli macro: avviso
      out.push(
        problem(
          "kj_as_kcal",
          sameAsKj || tooHigh ? "error" : "warning",
          `Le kcal (${fmt(kcal)}) sembrano kJ: ${sameAsKj ? `sono uguali ai kJ letti, ne verrebbero circa ${fmt(kjToKcal(kcal))}` : `dai macro ne verrebbero circa ${fmt(expected as number)}`}. Se sono kJ, dividi per ${String(KJ_PER_KCAL).replace(".", ",")}.`,
          "energyKcal",
        ),
      );
    } else if (tooHigh) {
      kjSuspected = true;
      out.push(problem("energy_high", "error", `${fmt(kcal)} kcal su 100 sono troppe (il grasso puro ne ha circa 900). Possono essere kJ, o un valore per porzione: correggi.`, "energyKcal"));
    }
    const noMacros = n.fat === undefined && n.carbohydrates === undefined && n.proteins === undefined;
    const kjBacked = input.energyKj !== undefined && input.energyKj > 0 && Math.abs(input.energyKj - kcal * KJ_PER_KCAL) <= input.energyKj * KJ_KCAL_TOLERANCE;
    if (!kjSuspected && noMacros && !kjBacked && !input.kcalConfirmed && !input.energyDerived) {
      out.push(problem("energy_unit", "error", `Ho solo l'energia (${fmt(kcal)}), senza grassi, carboidrati o proteine con cui confrontarla: non posso sapere se sono kcal o kJ. Conferma che sono kcal.`, "energyKcal"));
    }
  }

  const known = [n.fat, n.carbohydrates, n.proteins, n.fiber, n.salt].filter((v): v is number => v !== undefined && Number.isFinite(v));
  if (known.length >= 2) {
    const sum = known.reduce((a, b) => a + b, 0);
    if (sum > 100 + MACRO_SUM_TOLERANCE_G) {
      out.push(problem("macro_sum", "warning", `Grassi, carboidrati, proteine, fibre e sale sommano ${fmt(sum)} g su 100 g: non può essere. Controlla se un valore è per porzione o è stato letto male.`));
    }
  }
  if (n.sugars !== undefined && n.carbohydrates !== undefined && n.sugars > n.carbohydrates + SUBSET_TOLERANCE_G) {
    out.push(problem("sugars_over_carbs", "warning", `Gli zuccheri (${fmt(n.sugars)} g) sono più dei carboidrati (${fmt(n.carbohydrates)} g), ma ne sono una parte.`, "sugars"));
  }
  if (n.saturatedFat !== undefined && n.fat !== undefined && n.saturatedFat > n.fat + SUBSET_TOLERANCE_G) {
    out.push(problem("saturated_over_fat", "warning", `I saturi (${fmt(n.saturatedFat)} g) sono più dei grassi (${fmt(n.fat)} g), ma ne sono una parte.`, "saturatedFat"));
  }

  if (!kjSuspected && kcal !== undefined && expected !== undefined && Number.isFinite(kcal)) {
    const tolerance = Math.max(ENERGY_TOLERANCE_KCAL, ENERGY_TOLERANCE_SHARE * Math.max(kcal, expected));
    if (Math.abs(kcal - expected) > tolerance) {
      out.push(problem("energy_macros", "warning", `Le kcal (${fmt(kcal)}) non tornano con i macro, che ne darebbero circa ${fmt(expected)}. Se il prodotto contiene alcol o polioli la differenza è normale; altrimenti ricontrolla i numeri.`, "energyKcal"));
    }
  }
  if (!kjSuspected && kcal !== undefined && input.energyKj !== undefined && input.energyKj > 0) {
    if (Math.abs(input.energyKj - kcal * KJ_PER_KCAL) > input.energyKj * KJ_KCAL_TOLERANCE) {
      out.push(problem("kj_kcal", "warning", `kJ (${fmt(input.energyKj)}) e kcal (${fmt(kcal)}) non coincidono: dovrebbero essere nel rapporto di ${String(KJ_PER_KCAL).replace(".", ",")}.`, "energyKcal"));
    }
  }
  return out;
}

/** Vero se tra i problemi ce n'è uno che impedisce di confermare. */
export const blocksConfirm = (problems: readonly ReadProblem[]): boolean => problems.some((p) => p.severity === "error");
