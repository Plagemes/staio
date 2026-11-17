// Parti comuni alle letture dalle etichette (data di scadenza, tabella nutrizionale): i problemi trovati nella risposta e
// l'estrazione del JSON. Ciò che torna dal modello è una bozza da far rivedere, mai un dato fidato.
export { extractPayload } from "./mealPhraseShared";

export type ReadProblemCode =
  | "no_json"
  | "salvaged"
  | "truncated"
  | "no_date"
  | "discarded"
  | "low_confidence"
  | "month_only"
  | "past"
  | "far_future"
  | "kind_unclear"
  | "no_table"
  | "basis_unclear"
  | "per_serving"
  | "serving_as_100"
  | "invalid_value"
  | "derived"
  | "approximate"
  | "implausible"
  | "macro_sum"
  | "sugars_over_carbs"
  | "saturated_over_fat"
  | "energy_macros"
  | "kj_as_kcal"
  | "kj_kcal"
  | "energy_high"
  | "energy_unit"
  | "ingredients_partial";

export interface ReadProblem {
  code: ReadProblemCode;
  /** `error` impedisce di confermare finché non lo si corregge; `warning` merita attenzione; `info` è solo una nota. */
  severity: "error" | "warning" | "info";
  message: string;
  /** Campo a cui si riferisce, se ce n'è uno. */
  field?: string;
}

export function problem(code: ReadProblemCode, severity: ReadProblem["severity"], message: string, field?: string): ReadProblem {
  return { code, severity, message, ...(field !== undefined ? { field } : {}) };
}
