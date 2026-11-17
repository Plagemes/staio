// Contatore mensile di chiamate e token, e controllo del tetto di spesa. Funzioni pure: il mese lo decide l'istante passato.
import type { AiUsage } from "./types";

export interface UsageCounter {
  /** Mese di riferimento, `YYYY-MM` (UTC). */
  month: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** Costo stimato delle sole chiamate di cui si conosceva il prezzo, nella valuta del listino. */
  cost: number;
  /** Chiamate fatte senza un prezzo nel listino: il costo mostrato è per difetto. */
  unpricedCalls: number;
  /** Chiamate i cui token sono una stima prudente nostra, non un dato del fornitore (risposta senza token, richiesta interrotta). */
  estimatedCalls: number;
}

export function monthOf(nowIso: string): string {
  return nowIso.slice(0, 7);
}

export function emptyUsage(month: string): UsageCounter {
  return { month, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, unpricedCalls: 0, estimatedCalls: 0 };
}

const count = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** Ripulisce un contatore letto dal disco. */
export function normalizeUsage(raw: unknown, fallbackMonth: string): UsageCounter {
  if (typeof raw !== "object" || raw === null) return emptyUsage(fallbackMonth);
  const r = raw as Record<string, unknown>;
  const month = typeof r.month === "string" && /^\d{4}-\d{2}$/.test(r.month) ? r.month : fallbackMonth;
  return {
    month,
    calls: Math.floor(count(r.calls)),
    inputTokens: Math.floor(count(r.inputTokens)),
    outputTokens: Math.floor(count(r.outputTokens)),
    cost: count(r.cost),
    unpricedCalls: Math.floor(count(r.unpricedCalls)),
    estimatedCalls: Math.floor(count(r.estimatedCalls)),
  };
}

/** Il contatore del mese di `nowIso`: un contatore di un mese passato vale come vuoto. */
export function usageForMonth(counter: UsageCounter, nowIso: string): UsageCounter {
  const month = monthOf(nowIso);
  return counter.month === month ? counter : emptyUsage(month);
}

/** Aggiunge una chiamata. `cost` è null se il listino non conosce il modello. */
export function addCall(
  counter: UsageCounter,
  usage: AiUsage,
  cost: number | null,
  nowIso: string,
  estimated = false,
): UsageCounter {
  const base = usageForMonth(counter, nowIso);
  return {
    month: base.month,
    calls: base.calls + 1,
    inputTokens: base.inputTokens + Math.max(0, Math.floor(usage.inputTokens)),
    outputTokens: base.outputTokens + Math.max(0, Math.floor(usage.outputTokens)),
    cost: base.cost + (cost ?? 0),
    unpricedCalls: base.unpricedCalls + (cost === null ? 1 : 0),
    estimatedCalls: base.estimatedCalls + (estimated ? 1 : 0),
  };
}

export type BudgetCheck =
  | { allowed: true; remaining: number | null }
  | { allowed: false; reason: "cap_reached"; spent: number; cap: number }
  | { allowed: false; reason: "price_unknown" };

/**
 * Con un tetto fissato la chiamata parte solo se si sa quanto costa (modello nel listino)
 * e il mese non l'ha già raggiunto. Senza tetto non c'è nulla da controllare.
 */
export function checkBudget(
  counter: UsageCounter,
  nowIso: string,
  cap: number | null,
  priceKnown: boolean,
): BudgetCheck {
  if (cap === null) return { allowed: true, remaining: null };
  if (!priceKnown) return { allowed: false, reason: "price_unknown" };
  const spent = usageForMonth(counter, nowIso).cost;
  if (spent >= cap) return { allowed: false, reason: "cap_reached", spent, cap };
  return { allowed: true, remaining: cap - spent };
}
