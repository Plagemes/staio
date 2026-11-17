// Valori letti da una foto dell'etichetta e confermati dall'utente: come entrano nella scheda di un prodotto.
// Funzioni pure. La scheda resta quella di Open Food Facts; ciò che viene dalla foto la sostituisce e lo dice
// (`labelPhoto`), così una rilettura dal servizio non lo cancella.
import type { LabelPhoto, Nutrients, Product } from "./types";

export interface LabelValues {
  /** Valori per 100 g o 100 ml, già confermati. */
  nutrients?: Nutrients;
  ingredientsText?: string;
  /** Lingua dell'elenco degli ingredienti (due lettere). */
  ingredientsLang?: string;
  /**
   * L'utente ha confermato che è tutto l'elenco, dalla prima all'ultima voce. Senza conferma l'elenco resta marcato parziale
   * e il controllo degli allergeni dice «incerto» per ciò che non trova.
   */
  ingredientsComplete?: boolean;
  /** Valori che l'utente ha tolto di proposito dai nutrienti già sulla scheda: un campo vuoto, di per sé, non cancella nulla. */
  clearNutrients?: ReadonlyArray<Exclude<keyof Nutrients, "per" | "certainty">>;
  /** Allergeni e tracce dichiarati, con gli stessi identificatori di `Product.allergens` quando si riconoscono. */
  allergens?: string[];
  traces?: string[];
  /** Usato solo se la scheda non ha un nome. */
  name?: string;
  /** La scheda nasce da un alimento senza codice a barre: il codice è locale (vedi `Product.localFromName`). */
  localFromName?: true;
}

const union = (a: readonly string[] | undefined, b: readonly string[] | undefined): string[] | undefined => {
  const out = [...new Set([...(a ?? []), ...(b ?? [])])];
  return out.length > 0 ? out : undefined;
};

/** Vero se la scheda ha i valori che servono al calcolo: energia e i tre macronutrienti. */
export function hasFullNutrients(product: Pick<Product, "nutrients">): boolean {
  const n = product.nutrients;
  return n !== undefined && n.energyKcal !== undefined && n.fat !== undefined && n.carbohydrates !== undefined && n.proteins !== undefined;
}

/**
 * La scheda con i valori confermati. Senza scheda (Open Food Facts non conosce il codice) ne nasce una nuova, solo col codice.
 * Allergeni e tracce si sommano a quelli già dichiarati: dalla foto non si toglie mai un allergene.
 */
export function applyLabelValues(
  product: Product | undefined,
  barcode: string,
  values: LabelValues,
  now: string,
  by: "photo" | "manual" = "photo",
): Product {
  const base: Product = product ?? { barcode, fetchedAt: now, source: by === "manual" ? "manual" : "label_photo" };
  const next: Product = { ...base };
  const meta: LabelPhoto = { ...(base.labelPhoto ?? {}), readAt: now, by };

  if (values.nutrients) {
    // campo per campo: ciò che la lettura non riporta resta com'è sulla scheda (se la base è la stessa, 100 g o 100 ml)
    const old = base.nutrients;
    const merged: Nutrients = old && old.per === values.nutrients.per ? { ...old, ...values.nutrients } : { ...values.nutrients };
    if (old && old.per === values.nutrients.per) for (const key of values.clearNutrients ?? []) delete merged[key];
    next.nutrients = { ...merged, certainty: "label" };
    meta.nutrients = true;
  }
  if (values.ingredientsText !== undefined && values.ingredientsText.trim() !== "") {
    next.ingredientsText = values.ingredientsText;
    if (values.ingredientsLang) next.ingredientsLang = values.ingredientsLang;
    else delete next.ingredientsLang;
    // «non risulta» solo se l'utente ha confermato che l'elenco è intero; altrimenti resta parziale e il controllo dice «incerto»
    if (values.ingredientsComplete === true) delete next.ingredientsTruncated;
    else next.ingredientsTruncated = true;
    next.safetyFields = true;
    meta.ingredients = true;
  }
  if (values.allergens !== undefined || values.traces !== undefined) {
    const allergens = union(next.allergens, values.allergens);
    const traces = union(next.traces, values.traces);
    if (allergens) next.allergens = allergens;
    if (traces) next.traces = traces;
    if (values.allergens?.length || values.traces?.length) meta.allergens = true;
  }
  if (values.name && !next.name) {
    next.name = values.name;
    meta.name = true;
  }
  if (values.localFromName && !product) next.localFromName = true;
  next.labelPhoto = meta;
  return next;
}

/** Una scheda appena riletta dal servizio non perde ciò che l'utente ha confermato da una foto. */
export function keepLabelValues(fresh: Product, stored: Product | undefined): Product {
  const meta = stored?.labelPhoto;
  if (!stored || !meta) return fresh;
  const out: Product = { ...fresh, labelPhoto: meta };
  if (meta.nutrients && stored.nutrients) out.nutrients = stored.nutrients;
  if (meta.ingredients && stored.ingredientsText) {
    out.ingredientsText = stored.ingredientsText;
    if (stored.ingredientsLang) out.ingredientsLang = stored.ingredientsLang;
    else delete out.ingredientsLang;
    if (stored.ingredientsTruncated) out.ingredientsTruncated = true;
    else delete out.ingredientsTruncated;
    out.safetyFields = true;
  }
  if (meta.allergens) {
    const allergens = union(fresh.allergens, stored.allergens);
    const traces = union(fresh.traces, stored.traces);
    if (allergens) out.allergens = allergens;
    if (traces) out.traces = traces;
  }
  if (meta.name && stored.name && !fresh.name) out.name = stored.name;
  return out;
}
