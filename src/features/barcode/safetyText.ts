import { assessProduct, type ProductAssessment, type ProductCriteria, type ProductFacts, type ProductOutcome, type ProductVerdict } from "@/core/allergens";
import { isRestrictedCode, needsStoreCodeConfirmation } from "@/core/catalog";

/** Il titolo della scheda di controllo: dice la cosa più importante, mai un via libera. */
export const SAFETY_HEADINGS: Record<ProductVerdict, string> = {
  contains: "Attenzione: contiene ciò che hai dichiarato",
  traces: "Può contenere tracce di ciò che hai dichiarato",
  uncertain: "Non posso dirlo: i dati non bastano",
  not_found: "Non risulta nei dati: controlla l'etichetta",
};

/** La parola che accompagna ogni riga, così il significato non dipende dal colore. */
export const SAFETY_FLAGS: Record<ProductVerdict, string> = {
  contains: "Contiene",
  traces: "Tracce",
  uncertain: "Incerto",
  not_found: "Non risulta",
};

/** Dopo un «contiene» l'aggiunta resta possibile: in casa possono mangiarlo altri. */
export const SAFETY_ADD_NOTE = "Puoi aggiungerlo lo stesso: l'avviso non blocca niente.";

/** Il piano contiene altri allergeni dichiarati: se non si legge, il controllo guarda solo quelli del ricettario. */
export const PLAN_UNREADABLE_NOTE = "Controllo incompleto: non riesco a leggere il piano, quindi non conto gli allergeni che vi hai dichiarato.";

/** Prima i più gravi. */
const ORDER: Record<ProductVerdict, number> = { contains: 0, traces: 1, uncertain: 2, not_found: 3 };

export function sortOutcomes(outcomes: readonly ProductOutcome[]): ProductOutcome[] {
  return [...outcomes].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict]);
}

/** Al posto dell'avviso su Open Food Facts, quando gli ingredienti vengono da una foto dell'etichetta. */
export const LABEL_PHOTO_NOTICE =
  "Gli ingredienti vengono da una foto dell'etichetta, letta dall'intelligenza artificiale e confermata da te: non sostituiscono l'etichetta.";

/** Quando gli ingredienti li ha scritti l'utente. */
export const LABEL_MANUAL_NOTICE = "Gli ingredienti li hai scritti tu: non sostituiscono l'etichetta.";

/** Codice interno di un negozio: la scheda trovata può essere di un altro prodotto, e i suoi allergeni non valgono. */
export const RESTRICTED_SAFETY_TEXT = "Codice interno del negozio: non so a quale prodotto corrisponda. Controlla l'etichetta.";
export const RESTRICTED_WARNING_TITLE = "Codice interno del negozio: il prodotto può non corrispondere";
export const RESTRICTED_WARNING_TEXT =
  "I codici che cominciano per 2 (e per 02 o 04) li assegna ogni negozio ai suoi articoli: lo stesso numero può essere un prodotto qui e un altro altrove. La scheda trovata su Open Food Facts può non essere quella che hai in mano, e non ne uso gli allergeni per il controllo.";

/** La scheda di Open Food Facts per un codice interno del negozio: può essere di un altro prodotto, i suoi dati non contano. */
export function isUnreliableSource(product: { barcode: string; source: string }): boolean {
  return product.source === "openfoodfacts" && isRestrictedCode(product.barcode);
}

/**
 * Il controllo di allergeni ed esclusioni per la scheda. Per un codice interno del negozio non si guarda nemmeno la scheda
 * trovata: ogni voce dichiarata resta «incerto».
 */
export function assessForCard(
  product: ProductFacts & { barcode: string; source: string; localFromName?: true },
  criteria: ProductCriteria,
  options: { confirmed?: boolean } = {},
): ProductAssessment {
  // un codice interno con la scheda scritta dall'utente: finché non conferma che è ancora quel prodotto, nulla vale
  const unconfirmed = needsStoreCodeConfirmation(product) && options.confirmed !== true;
  if (!isUnreliableSource(product) && !unconfirmed) {
    const assessment = assessProduct(product, criteria);
    // una scheda fatta dall'utente senza ingredienti non è «salvata prima» e la rete non c'entra: si chiedono gli ingredienti
    if (product.source === "openfoodfacts" || (product.ingredientsText ?? "").trim() !== "") return assessment;
    return {
      ...assessment,
      outcomes: assessment.outcomes.map((o) => (o.reason === "stale" || o.reason === "no_data" ? { ...o, text: NEED_INGREDIENTS_TEXT } : o)),
    };
  }
  const make = (kind: ProductOutcome["kind"], declared: string): ProductOutcome => ({
    kind,
    declared,
    label: declared,
    verdict: "uncertain",
    reason: "no_data",
    text: RESTRICTED_SAFETY_TEXT,
  });
  const outcomes = [...(criteria.allergens ?? []).map((d) => make("allergen", d)), ...(criteria.excludedFoods ?? []).map((d) => make("exclusion", d))];
  return { verdict: outcomes.length > 0 ? "uncertain" : "none", outcomes };
}

/** Scheda scritta dall'utente, ancora senza ingredienti. */
export const NEED_INGREDIENTS_TEXT = "Scrivi gli ingredienti per controllarli con ciò che hai dichiarato.";

/**
 * La frase sulla fonte dei dati, sotto il controllo: Open Food Facts, la foto dell'etichetta o gli ingredienti scritti
 * dall'utente. Per una scheda fatta dall'utente senza ingredienti non c'è nessuna fonte da dire.
 */
export function safetySourceNote(product: { source: string; labelPhoto?: { ingredients?: true; by?: "photo" | "manual" } }, standard: string): string | null {
  if (product.labelPhoto?.ingredients) return product.labelPhoto.by === "manual" ? LABEL_MANUAL_NOTICE : LABEL_PHOTO_NOTICE;
  return product.source === "openfoodfacts" ? standard : null;
}

/** Codice interno di un negozio con la scheda dell'utente: l'ultima volta era un prodotto, ora può essere un altro. */
export function storeCodeQuestion(name: string | undefined): string {
  const label = name && name.trim() !== "" ? `«${name.trim().slice(0, 40)}»` : "un prodotto senza nome";
  return `Codice interno del negozio: l'ultima volta era ${label}. È ancora questo prodotto?`;
}
