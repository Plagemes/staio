// Avvisi senza server: calcolo di cosa avvisare, dai dati del telefono e dall'ora.
// Un avviso nasce da un fatto (una scadenza, una preparazione, un promemoria) e porta con sé
// quanto è certo: una scadenza stimata non si presenta come una data stampata.

import type { DiaryState } from "../diary";
import type { PantryState } from "../ledger";
import type { PlanState } from "../plan";
import type { PrepState } from "../prep";
import type { PlanNeed } from "../shopping";

export const NOTICE_TYPES = ["expiry", "prep", "supplement", "shopping", "plan"] as const;
export type NoticeType = (typeof NOTICE_TYPES)[number];

/** `label`: data stampata sulla confezione. `estimated`: stima. `recorded`: dato che hai registrato. */
export type NoticeCertainty = "label" | "estimated" | "recorded";

export type NoticeLevel = "urgent" | "soon" | "info";

export interface NoticeFact {
  /** Identifica il fatto: lo stesso fatto ha sempre la stessa chiave e non si ripete. */
  key: string;
  type: NoticeType;
  level: NoticeLevel;
  certainty: NoticeCertainty;
  /** Titolo breve, da solo in una notifica. */
  heading: string;
  /** Frase completa. */
  text: string;
  /** Riga breve per il riepilogo ("Yogurt, domani"). */
  short: string;
  /** Percorso interno sotto /app a cui porta l'avviso. */
  url: string;
  /** Più basso = prima. */
  order: number;
}

export interface NoticeMessage {
  /** Uguale per lo stesso giorno e lo stesso contenuto: una notifica nuova sostituisce la vecchia. */
  tag: string;
  title: string;
  body: string;
  url: string;
  /** Chiavi dei fatti raccontati: si registrano come già mostrate. */
  keys: string[];
  count: number;
  digest: boolean;
}

export interface QuietHours {
  enabled: boolean;
  /** `HH:MM`. Se `from` è dopo `to` il silenzio attraversa la mezzanotte. */
  from: string;
  to: string;
}

export interface NotifyPrefs {
  /** Spento finché l'utente non attiva gli avvisi. */
  enabled: boolean;
  types: Record<NoticeType, boolean>;
  quietHours: QuietHours;
  /** Alimenti e preparazioni: da quanti giorni prima avvisare (1 = solo oggi e domani). */
  expiryDaysAhead: number;
}

export interface ShownRecord {
  key: string;
  /** Giorno locale `YYYY-MM-DD` in cui è stato mostrato. */
  day: string;
}

export interface SentMessage {
  day: string;
  /** Istante ISO UTC. */
  at: string;
}

/** Cosa è già stato mostrato su questo dispositivo. */
export interface ShownLedger {
  shown: ShownRecord[];
  messages: SentMessage[];
}

export interface NotifyInput {
  /** Istante ISO 8601 UTC. */
  now: string;
  timeZone?: string;
  pantry: PantryState;
  preps?: PrepState;
  plan?: PlanState;
  diary?: DiaryState;
  /** Fabbisogni del piano, se il chiamante li ha già calcolati (migliorano il promemoria di spesa). */
  planNeeds?: readonly PlanNeed[];
  prefs: NotifyPrefs;
  shown?: ShownLedger;
}

export type HoldReason = "disabled" | "nothing" | "quiet" | "daily_limit" | "too_soon";

export interface NotifyResult {
  /** Giorno locale `YYYY-MM-DD`. */
  day: string;
  /** Fatti attuali dei tipi attivi, anche già mostrati: per l'elenco dentro l'app. */
  facts: NoticeFact[];
  /** Fatti ancora da mostrare. */
  due: NoticeFact[];
  /** Cosa mostrare adesso, o niente. */
  message: NoticeMessage | null;
  hold?: HoldReason;
}

/** Riepilogo precalcolato per un giorno, da mostrare dal service worker senza aprire l'app. */
export interface SavedSummary {
  /** Giorno locale in cui vale. Un altro giorno: non si mostra. */
  forDay: string;
  timeZone: string;
  message: NoticeMessage;
  /** Istante ISO UTC dopo il quale non si mostra in nessun caso. */
  expiresAt: string;
  savedAt: string;
}
