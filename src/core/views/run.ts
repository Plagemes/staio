// Esecuzione: da una vista valida e dallo stato dell'app ai dati di ogni blocco. Non c'è intelligenza artificiale qui:
// una vista fissata si ricalcola così, ogni volta, sui dati correnti.
import { getQuery } from "./catalog";
import { PERIOD_LABELS, isPeriodId } from "./period";
import { ACTIONS, type ActionId, type BlockSpec, type QuerySpec, type ViewSpec } from "./spec";
import type { QueryResult, ViewContext } from "./types";

export type BlockData =
  | { type: "figure"; label: string; caption: string; result: QueryResult }
  | { type: "list"; label?: string; caption: string; result: QueryResult }
  | { type: "chart"; label?: string; caption: string; result: QueryResult }
  | { type: "text"; text: string }
  | { type: "action"; action: ActionId; label: string; href?: string; item?: string };

export interface ViewData {
  title: string;
  blocks: BlockData[];
}

const EXPECTED = { figure: "number", list: "rows", chart: "series" } as const;

const FAILED: QueryResult = { kind: "insufficient", reason: "Non sono riuscito a calcolare questo dato.", basis: "" };

/** Esegue una interrogazione. Non lancia: un'interrogazione sconosciuta o che si rompe dà «dati insufficienti». */
export function runQuery(query: QuerySpec, ctx: ViewContext): { caption: string; result: QueryResult } {
  const def = getQuery(query.name);
  if (!def) return { caption: "", result: { kind: "insufficient", reason: "Questa interrogazione non esiste più.", basis: "" } };
  try {
    const result = def.run(query.params, ctx);
    return { caption: withPeriod(def.caption(query.params, result), query), result };
  } catch {
    return { caption: safeCaption(query), result: FAILED };
  }
}

/** La didascalia dice sempre anche il periodo: è scritta dall'app e descrive ciò che è stato davvero calcolato. */
function withPeriod(caption: string, query: QuerySpec): string {
  const period = query.params.period;
  return typeof period === "string" && isPeriodId(period) ? `${caption} · ${PERIOD_LABELS[period]}` : caption;
}

function safeCaption(query: QuerySpec): string {
  try {
    return withPeriod(getQuery(query.name)?.caption(query.params) ?? "", query);
  } catch {
    return "";
  }
}

function runBlock(block: BlockSpec, ctx: ViewContext): BlockData {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "action": {
      const def = ACTIONS[block.action];
      return { type: "action", action: block.action, label: def.label, ...(def.href ? { href: def.href } : {}), ...(block.item !== undefined ? { item: block.item } : {}) };
    }
    default: {
      const { caption, result } = runQuery(block.query, ctx);
      const ok = result.kind === "insufficient" || result.kind === EXPECTED[block.type];
      const data = ok ? result : FAILED;
      return block.type === "figure"
        ? { type: "figure", label: block.label, caption, result: data }
        : { type: block.type, ...(block.label !== undefined ? { label: block.label } : {}), caption, result: data };
    }
  }
}

export function runView(view: ViewSpec, ctx: ViewContext): ViewData {
  return { title: view.title, blocks: view.blocks.map((b) => runBlock(b, ctx)) };
}

/** Se la vista ha bisogno dei nutrienti calcolati (e quindi della tabella degli alimenti). */
export function viewNeedsNutrition(view: ViewSpec): boolean {
  return view.blocks.some((b) => "query" in b && getQuery(b.query.name)?.needsNutrition === true);
}
