import type { ProductOutcome, ProductVerdict } from "@/core/allergens";

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
