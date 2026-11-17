// La tabella nutrizionale come la vede chi la rivede: campi di testo, uno per valore. Serve sia alla bozza letta da una foto
// sia ai valori scritti a mano. Da qui nascono i valori da salvare solo quando l'utente conferma; prima, nulla tocca la
// scheda del prodotto. Un campo vuoto vuol dire «non indicato», mai zero.
import { canonicalAllergens } from "@/core/allergens";
import {
  KJ_PER_KCAL,
  NUTRIENT_FIELDS,
  blocksConfirm,
  checkLabelNutrients,
  parseDecimal,
  scaleToPer100,
  type LabelBasis,
  type LabelNutrients,
  type LabelReading,
  type NutrientField,
  type ReadProblem,
} from "@/core/ai";
import { applyLabelValues, type LabelValues, type Nutrients, type Product } from "@/core/catalog";

export interface LabelForm {
  /** Un testo per valore, com'è scritto nel campo: vuoto = non riportato. */
  values: Record<NutrientField, string>;
  /** Con la sola energia, senza macro con cui confrontarla: l'utente conferma che sono kcal e non kJ. */
  kcalConfirmed: boolean;
  /** I kJ, facoltativi: servono al controllo di coerenza e, se le kcal mancano, a calcolarle. */
  energyKj: string;
  basis: LabelBasis;
  /** La porzione, se i valori sono per porzione: serve a riportarli a 100. */
  serving: string;
  servingUnit: "g" | "ml";
  name: string;
  ingredients: string;
  /** Lingua degli ingredienti, due lettere; vuota = non nota. */
  ingredientsLang: string;
  /** «È tutto l'elenco degli ingredienti»: senza questa conferma l'elenco resta parziale e il controllo degli allergeni dice «incerto». */
  ingredientsComplete: boolean;
  allergens: string;
  traces: string;
}

export const NUTRIENT_LABELS: Record<NutrientField, { label: string; unit: string }> = {
  energyKcal: { label: "Energia", unit: "kcal" },
  fat: { label: "Grassi", unit: "g" },
  saturatedFat: { label: "di cui saturi", unit: "g" },
  carbohydrates: { label: "Carboidrati", unit: "g" },
  sugars: { label: "di cui zuccheri", unit: "g" },
  fiber: { label: "Fibre", unit: "g" },
  proteins: { label: "Proteine", unit: "g" },
  salt: { label: "Sale", unit: "g" },
};

const text = (n: number | undefined) => (n === undefined ? "" : String(n).replace(".", ","));

function blankValues(): Record<NutrientField, string> {
  const values = {} as Record<NutrientField, string>;
  for (const f of NUTRIENT_FIELDS) values[f] = "";
  return values;
}

/** Il modulo vuoto, per scrivere i valori a mano. Si parte da «per 100 g», la forma più comune. */
export function emptyForm(): LabelForm {
  return {
    values: blankValues(),
    kcalConfirmed: false,
    energyKj: "",
    basis: "100g",
    serving: "",
    servingUnit: "g",
    name: "",
    ingredients: "",
    ingredientsLang: "",
    ingredientsComplete: false,
    allergens: "",
    traces: "",
  };
}

/** La bozza di partenza: ciò che il modello ha letto. Ingredienti e nome si propongono solo se la scheda non li ha già. */
export function formFromReading(reading: LabelReading, product: Product | undefined): LabelForm {
  const values = blankValues();
  // si parte dai valori già sulla scheda, come per la modifica a mano: la foto sostituisce ciò che riporta e lascia il resto
  const existing = product?.nutrients;
  const keep = existing !== undefined && ((reading.basis === "100g" && existing.per === "100g") || (reading.basis === "100ml" && existing.per === "100ml"));
  for (const f of NUTRIENT_FIELDS) values[f] = text(reading.nutrients[f] ?? (keep ? existing[f] : undefined));
  return {
    values,
    kcalConfirmed: false,
    ingredientsComplete: false,
    energyKj: text(reading.energyKj),
    basis: reading.basis,
    serving: text(reading.serving?.value),
    servingUnit: reading.serving?.unit ?? "g",
    name: product?.name ? "" : (reading.name ?? ""),
    ingredients: product?.ingredientsText ? "" : (reading.ingredients ?? ""),
    ingredientsLang: product?.ingredientsText ? "" : (reading.ingredientsLang ?? ""),
    allergens: reading.allergens.join(", "),
    traces: reading.traces.join(", "),
  };
}

/** Per correggere dopo: parte dai valori già sulla scheda. */
export function formFromProduct(product: Product): LabelForm {
  const form = emptyForm();
  const n = product.nutrients;
  if (n) {
    for (const f of NUTRIENT_FIELDS) form.values[f] = text(n[f]);
    form.basis = n.per;
  }
  if (product.serving) {
    form.serving = text(product.serving.value);
    form.servingUnit = product.serving.unit === "ml" ? "ml" : "g";
  }
  return form;
}

export interface FormNumbers {
  /** I valori validi; le kcal sono quelle scritte o, se mancano, quelle calcolate dai kJ. */
  nutrients: LabelNutrients;
  kj?: number;
  /** Le kcal vengono dai kJ: lo si dice. */
  derivedKcal: boolean;
  invalid: Array<NutrientField | "energyKj" | "serving">;
}

/** Numeri validi dei campi, e quali campi hanno un testo che non è un numero. */
export function numbersOf(form: LabelForm): FormNumbers {
  const nutrients: LabelNutrients = {};
  const invalid: FormNumbers["invalid"] = [];
  for (const f of NUTRIENT_FIELDS) {
    const raw = form.values[f].trim();
    if (raw === "") continue;
    const n = parseDecimal(raw);
    if (n === undefined) invalid.push(f);
    else nutrients[f] = n;
  }
  let kj: number | undefined;
  const rawKj = form.energyKj.trim();
  if (rawKj !== "") {
    const n = parseDecimal(rawKj);
    if (n === undefined) invalid.push("energyKj");
    else kj = n;
  }
  let derivedKcal = false;
  if (nutrients.energyKcal === undefined && kj !== undefined && kj >= 0) {
    nutrients.energyKcal = Math.round(kj / KJ_PER_KCAL);
    derivedKcal = true;
  }
  if (form.basis === "serving" && form.serving.trim() !== "" && !(servingOf(form) > 0)) invalid.push("serving");
  return { nutrients, ...(kj !== undefined ? { kj } : {}), derivedKcal, invalid };
}

const servingOf = (form: LabelForm): number => parseDecimal(form.serving.trim()) ?? 0;

/** Tutti i problemi di adesso: campi non numerici e controlli di plausibilità, ricalcolati a ogni modifica. */
export function liveProblems(form: LabelForm): ReadProblem[] {
  const { nutrients, invalid, kj, derivedKcal } = numbersOf(form);
  const out: ReadProblem[] = invalid.map((f) => ({
    code: "invalid_value",
    severity: "error",
    message: f === "energyKj" ? "kJ: scrivi un numero (per esempio 2240)." : f === "serving" ? "Porzione: scrivi un numero (per esempio 30)." : `${NUTRIENT_LABELS[f].label}: scrivi un numero (per esempio 12,5).`,
    field: f,
  }));
  out.push(
    ...checkLabelNutrients({
      nutrients,
      basis: form.basis,
      kcalConfirmed: form.kcalConfirmed,
      energyDerived: derivedKcal,
      ...(kj !== undefined ? { energyKj: kj } : {}),
    }),
  );
  if (derivedKcal) {
    out.push({ code: "derived", severity: "info", message: `Le kcal (${nutrients.energyKcal}) sono calcolate dai kJ, dividendo per ${String(KJ_PER_KCAL).replace(".", ",")}.`, field: "energyKcal" });
  }
  return out;
}

const splitList = (value: string): string[] =>
  value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== "");

/** Si può salvare: nessun errore, e qualcosa da salvare. */
export function canConfirm(form: LabelForm): boolean {
  const { nutrients } = numbersOf(form);
  const something = Object.keys(nutrients).length > 0 || form.ingredients.trim() !== "" || splitList(form.allergens).length + splitList(form.traces).length > 0;
  return something && !blocksConfirm(liveProblems(form));
}

/** Per porzione → per 100, su richiesta dell'utente. Senza porzione valida non fa nulla. */
export function rescaled(form: LabelForm): LabelForm {
  const serving = servingOf(form);
  if (!(serving > 0)) return form;
  const { nutrients, kj } = numbersOf(form);
  // le kcal calcolate dai kJ non erano scritte: non si trasformano in un valore scritto
  const written = { ...nutrients };
  if (form.values.energyKcal.trim() === "") delete written.energyKcal;
  const scaled = scaleToPer100(written, serving);
  const values = { ...form.values };
  for (const f of NUTRIENT_FIELDS) if (scaled[f] !== undefined) values[f] = text(scaled[f]);
  return {
    ...form,
    values,
    energyKj: kj !== undefined ? text(Math.round((kj * 100) / serving)) : form.energyKj,
    basis: form.servingUnit === "ml" ? "100ml" : "100g",
  };
}

/** Identificatori di Open Food Facts per le 14 voci dell'allegato II, a partire dalle chiavi italiane dei controlli. */
const OFF_TAGS: Record<string, string> = {
  glutine: "gluten",
  latte: "milk",
  uova: "eggs",
  pesce: "fish",
  crostacei: "crustaceans",
  molluschi: "molluscs",
  arachidi: "peanuts",
  "frutta a guscio": "nuts",
  soia: "soybeans",
  sedano: "celery",
  senape: "mustard",
  sesamo: "sesame-seeds",
  lupini: "lupin",
  solfiti: "sulphur-dioxide-and-sulphites",
};

/** «latte» → «milk». Una voce che non si riconosce resta com'è: il controllo dirà che non la riconosce, e chiederà di guardare l'etichetta. */
export function allergenTags(list: string): string[] {
  const out: string[] = [];
  for (const item of splitList(list)) {
    const keys = canonicalAllergens(item);
    const tags = keys.length > 0 ? keys.map((k) => OFF_TAGS[k]).filter((t): t is string => t !== undefined) : [item.toLowerCase().slice(0, 60)];
    for (const t of tags) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** I valori da salvare, dal modulo confermato. */
export function valuesFromForm(form: LabelForm, product: Product | undefined): LabelValues {
  const { nutrients } = numbersOf(form);
  const values: LabelValues = {};
  if (Object.keys(nutrients).length > 0 && (form.basis === "100g" || form.basis === "100ml")) {
    const n: Nutrients = { per: form.basis, certainty: "label" };
    for (const f of NUTRIENT_FIELDS) {
      const v = nutrients[f];
      if (v !== undefined) n[f] = f === "energyKcal" ? Math.round(v) : Math.round(v * 100) / 100;
    }
    values.nutrients = n;
    // un campo che c'era sulla scheda e ora è vuoto è stato tolto di proposito (lo si vede nel modulo, che parte dai valori della scheda)
    const old = product?.nutrients;
    if (old && old.per === form.basis) {
      const cleared = NUTRIENT_FIELDS.filter((f) => old[f] !== undefined && n[f] === undefined);
      if (cleared.length > 0) values.clearNutrients = cleared;
    }
  }
  const ingredients = form.ingredients.trim();
  if (ingredients !== "" && !product?.ingredientsText) {
    values.ingredientsComplete = form.ingredientsComplete;
    values.ingredientsText = ingredients.slice(0, 4000);
    if (/^[a-z]{2,3}$/.test(form.ingredientsLang)) values.ingredientsLang = form.ingredientsLang;
  }
  const allergens = allergenTags(form.allergens);
  const traces = allergenTags(form.traces);
  if (allergens.length > 0) values.allergens = allergens;
  if (traces.length > 0) values.traces = traces;
  if (form.name.trim() !== "" && !product?.name) values.name = form.name.trim().slice(0, 80);
  return values;
}

/** La scheda come diventerebbe confermando: serve a mostrare subito il controllo degli allergeni sugli ingredienti. */
export function draftProduct(form: LabelForm, product: Product | undefined, barcode: string, now: string, by: "photo" | "manual" = "photo"): Product {
  return applyLabelValues(product, barcode, valuesFromForm(form, product), now, by);
}
