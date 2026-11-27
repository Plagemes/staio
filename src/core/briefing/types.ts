// Riepilogo del giorno e coda «Da rivedere»: calcolo puro, senza intelligenza artificiale.
// Ogni riga nasce da dati registrati e porta con sé quanto è certa: una stima non si presenta come un fatto.

import type { AnyEvent } from "../events";
import type { DiaryState, MealKind } from "../diary";
import type { PantryState } from "../ledger";
import type { PrepState } from "../prep";

/** `label`: data stampata. `estimated`: stima o abitudine dedotta. `recorded`: dato che hai registrato. */
export type BriefingCertainty = "label" | "estimated" | "recorded";

export type BriefingKind = "expiry" | "plan" | "water" | "supplement" | "yesterday" | "diet" | "notice" | "review";

export interface BriefingLine {
  /** Stabile per lo stesso fatto. */
  key: string;
  kind: BriefingKind;
  text: string;
  certainty: BriefingCertainty;
  /** Percorso interno sotto /app, oppure `#ancora` nella stessa schermata. Per `review` apre la coda. */
  href: string;
  /** Più basso = prima. */
  order: number;
}

export type ReviewKind = "untracked_meal" | "provisional" | "quantity" | "no_category" | "no_nutrition" | "stale_expiry";

export interface ReviewItem {
  /** Si ricorda quando l'utente dice «Lascia così». */
  key: string;
  kind: ReviewKind;
  text: string;
  /** Una riga che dice perché è incerta. */
  why: string;
  /** Nome dell'azione diretta. */
  actionLabel: string;
  href: string;
  certainty: BriefingCertainty;
  order: number;
}

export interface PlannedToday {
  meal: MealKind;
  text: string;
}

/** Un alimento usato nei pasti senza valori nutrizionali (voce non riconosciuta). */
export interface UnresolvedFood {
  key: string;
  label: string;
  /** Quante volte è comparso nei pasti. */
  count: number;
  /** Ultimo giorno in cui è comparso, `YYYY-MM-DD`. */
  lastDate: string;
}

export interface OtherNotice {
  key: string;
  short: string;
  url: string;
}

export interface BriefingInput {
  /** Istante ISO 8601 UTC. */
  now: string;
  timeZone?: string;
  /** Il giorno che si sta guardando: se è passato il riepilogo non c'è. Predefinito: oggi. */
  viewDate?: string;
  pantry: PantryState;
  diary: DiaryState;
  /** Preparazioni: le loro porzioni che scadono contano come le scadenze dei lotti. */
  preps?: PrepState;
  log: readonly AnyEvent[];
  /** Pasti pianificati per oggi. */
  planned?: readonly PlannedToday[];
  /** Nomi di ciò che manca in dispensa per il piano di oggi. */
  missingForPlan?: readonly string[];
  /** Avvisi che il riepilogo non racconta già da sé (spesa, piano, preparazioni). */
  otherNotices?: readonly OtherNotice[];
  unresolvedFoods?: readonly UnresolvedFood[];
  /** Chiavi di ciò che l'utente ha lasciato così. */
  dismissed?: readonly string[];
  /** Il consiglio più alto sulla qualità di ciò che si mangia che abbia un'azione vera (al massimo uno). */
  dietAdvice?: { key: string; text: string; href: string; certainty: BriefingCertainty };
}

export interface Briefing {
  /** Al massimo `MAX_LINES`, per urgenza. Vuoto: la scheda non compare. */
  lines: BriefingLine[];
  /** Voci della coda da mostrare (al massimo `MAX_REVIEW_ITEMS`). */
  review: ReviewItem[];
  /** Quante cose ci sono in tutto da rivedere. */
  reviewCount: number;
  /** La riga «da rivedere» è tra le righe (c'era posto); altrimenti si offre a parte. */
  reviewInLines: boolean;
}
