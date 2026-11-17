// Il formato di una vista: un titolo e un elenco di blocchi presi da un elenco chiuso.
// È solo una descrizione: nessun dato, nessun codice, nessuna interfaccia.
import type { Params } from "./types";

export const VIEW_LIMITS = {
  maxBlocks: 8,
  titleChars: 50,
  labelChars: 40,
  textChars: 160,
  itemChars: 40,
  /** Lunghezza massima del testo della risposta dell'intelligenza artificiale che si prova a leggere. */
  responseChars: 40_000,
} as const;

export const BLOCK_TYPES = ["figure", "list", "chart", "text", "action"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

/** Azioni ammesse. Le etichette sono dell'app, non dell'intelligenza artificiale. */
export const ACTIONS = {
  open_pantry: { label: "Apri la dispensa", href: "/app/dispensa" },
  open_shopping: { label: "Apri la spesa", href: "/app/spesa" },
  open_nutrition: { label: "Apri la nutrizione", href: "/app/salute/nutrizione" },
  open_health: { label: "Apri la salute", href: "/app/salute" },
  open_plan: { label: "Apri il piano", href: "/app/piano" },
  open_recipes: { label: "Apri le ricette", href: "/app/ricette" },
  add_to_shopping: { label: "Aggiungi alla spesa", href: undefined },
} as const satisfies Record<string, { label: string; href: string | undefined }>;

export type ActionId = keyof typeof ACTIONS;
export const ACTION_IDS = Object.keys(ACTIONS) as ActionId[];

export interface QuerySpec {
  name: string;
  /** Tutti i parametri dell'interrogazione, con i valori predefiniti già scritti. */
  params: Params;
}

/** Un numero con la sua etichetta. Legato a un'interrogazione che dà un numero. */
export interface FigureBlock {
  type: "figure";
  label: string;
  query: QuerySpec;
}

/** Un elenco di righe. Legato a un'interrogazione che dà righe. */
export interface ListBlock {
  type: "list";
  label?: string;
  query: QuerySpec;
}

/** Una serie nel tempo come grafico semplice. Legato a un'interrogazione che dà una serie. */
export interface ChartBlock {
  type: "chart";
  label?: string;
  query: QuerySpec;
}

/**
 * Una nota dell'assistente, senza numeri: i numeri vengono solo dal calcolo. Non è verificata: si mostra come tale nella
 * risposta appena generata e non si conserva nelle viste fissate.
 */
export interface TextBlock {
  type: "text";
  text: string;
}

export interface ActionBlock {
  type: "action";
  action: ActionId;
  /** Solo per `add_to_shopping`: cosa aggiungere. */
  item?: string;
}

export type BlockSpec = FigureBlock | ListBlock | ChartBlock | TextBlock | ActionBlock;

export interface ViewSpec {
  title: string;
  blocks: BlockSpec[];
}

export type ProblemCode =
  | "not_object"
  | "not_json"
  | "unknown_field"
  | "missing_field"
  | "bad_type"
  | "too_long"
  | "empty_text"
  | "digits_in_text"
  | "number_words"
  | "too_many_blocks"
  | "unknown_block"
  | "unknown_query"
  | "unknown_param"
  | "missing_param"
  | "bad_param"
  | "result_mismatch"
  | "unknown_action"
  | "no_valid_blocks";

export interface ViewProblem {
  /** Dove: per esempio `blocks[2].query.params.nutrient`. */
  path: string;
  code: ProblemCode;
  /** In italiano, mostrabile all'utente. Non riporta mai più di una breve citazione. */
  message: string;
}

export type ValidationResult =
  | { ok: true; view: ViewSpec; problems: ViewProblem[] }
  | { ok: false; problems: ViewProblem[] };
