// Il catalogo chiuso delle interrogazioni. Ciò che non è qui non esiste per l'intelligenza artificiale.
import { BODY_QUERIES } from "./queries/body";
import { MONEY_QUERIES } from "./queries/money";
import { NUTRITION_QUERIES } from "./queries/nutrition";
import { PANTRY_QUERIES } from "./queries/pantry";
import type { QueryDef } from "./types";

export const QUERY_CATALOG: readonly QueryDef[] = [...NUTRITION_QUERIES, ...MONEY_QUERIES, ...PANTRY_QUERIES, ...BODY_QUERIES];

const BY_NAME = new Map<string, QueryDef>(QUERY_CATALOG.map((q) => [q.name, q]));

export const QUERY_NAMES: readonly string[] = QUERY_CATALOG.map((q) => q.name);

/** L'interrogazione con questo nome, o undefined. Cerca solo nel catalogo, mai nelle proprietà degli oggetti. */
export const getQuery = (name: string): QueryDef | undefined => BY_NAME.get(name);
