// Suggerimenti di una riga, una volta sola, nel punto in cui servono. Il catalogo e le regole stanno qui; la schermata
// sceglie quale mostrare (al massimo uno per schermata). Logica pura.

/** I testi, in un posto solo. */
export const HINTS = {
  add: 'Con "+" in basso aggiungi qualunque cosa, da ogni schermata.',
  diaryRow: "Tocca una riga del diario per correggerla o toglierla.",
  pantryRow: "Tocca un alimento per segnarlo mangiato, aperto o buttato.",
  shoppingRow: "Tocca una voce per cambiarne la quantità o toglierla.",
} as const;

export type HintId = keyof typeof HINTS;

/** Dove si ricorda che è stato mostrato: impostazioni locali, valore = il giorno della prima volta. */
export const hintKey = (id: HintId): string => `hint.${id}`;

export interface HintState {
  /** Le impostazioni non sono ancora state lette. */
  loading: boolean;
  /** Lettura fallita: senza poter ricordare «visto» non lo si mostra. */
  failed: boolean;
  /** Valore salvato: c'è se è già stato mostrato. */
  stored: unknown;
  /** Mostrato in questa visita della schermata. */
  latched: boolean;
  /** Chiuso con «Chiudi». */
  closed: boolean;
  /** Si è lasciata la schermata dopo averlo mostrato: alla visita dopo non c'è più. */
  expired: boolean;
}

export const isHintSeen = (stored: unknown): boolean => typeof stored === "string" && stored.length > 0;

/**
 * "first": è la prima volta, va mostrato e segnato come visto; "keep": già mostrato in questa visita, resta;
 * "none": non si mostra.
 */
export function hintVerdict(s: HintState): "first" | "keep" | "none" {
  if (s.closed || s.expired) return "none";
  if (s.latched) return "keep";
  if (s.loading || s.failed || isHintSeen(s.stored)) return "none";
  return "first";
}
