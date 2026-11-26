// Le azioni della barra «Seleziona» che non sono «Elimina»: quali confezioni si spostano, quali nomi vanno in lista e
// i testi. Logica pura: la lettura dell'archivio e la scrittura stanno in `Pantry.tsx`.
import { validateEvent, type Location, type Lot } from "@/core/ledger";
import { normalizeName } from "@/core/shopping";
import { buildForLots, buildMove, type ActionContext, type ActionResult } from "../actions";
import { LOCATION_LABELS } from "../labels";
import { inSentence } from "./eaten";

/** Quante confezioni: «1 confezione», «3 confezioni». */
export const packsText = (n: number): string => (n === 1 ? "1 confezione" : `${n} confezioni`);

export interface MovePlan {
  /** Le confezioni scelte che ci sono ancora e non sono già nel luogo. */
  toMove: Lot[];
  /** Scelte, ma già nel luogo. */
  alreadyThere: number;
  /** Scelte, ma nel frattempo finite o tolte. */
  gone: number;
}

/** Sceglie, tra le confezioni attive di adesso, quelle da spostare: le altre si lasciano e si contano. */
export function planMove(active: readonly Lot[], pickedIds: Iterable<string>, to: Location): MovePlan {
  const picked = new Set(pickedIds);
  const now = active.filter((l) => picked.has(l.lotId));
  return {
    toMove: now.filter((l) => l.location !== to),
    alreadyThere: now.filter((l) => l.location === to).length,
    gone: picked.size - now.length,
  };
}

const where = (to: Location): string => LOCATION_LABELS[to].toLowerCase();

/** Le note in coda all'avviso: chi era già lì e chi non c'era più. */
export function selectionExtras(alreadyThere: number, gone: number, to?: Location): string {
  const parts: string[] = [];
  if (alreadyThere > 0 && to) parts.push(`${alreadyThere} ${alreadyThere === 1 ? "era già" : "erano già"} in ${where(to)}.`);
  if (gone > 0) parts.push(gone === 1 ? "1 non c'era più." : `${gone} non c'erano più.`);
  return parts.join(" ");
}

/** L'avviso dopo lo spostamento: una confezione ha il testo di `buildMove`. */
export function moveMessage(moved: number, name: string, to: Location, alreadyThere: number, gone: number): string {
  const head = moved === 1 ? `Spostato in ${where(to)}: ${name}.` : `Spostate in ${where(to)}: ${packsText(moved)}.`;
  const extras = selectionExtras(alreadyThere, gone, to);
  return extras === "" ? head : `${head} ${extras}`;
}

/** La riga nella barra quando non c'è niente da spostare. */
export function nothingToMoveText(plan: MovePlan, to: Location): string {
  if (plan.gone === 0) return plan.alreadyThere === 1 ? `È già in ${where(to)}.` : `Sono già tutti in ${where(to)}.`;
  if (plan.alreadyThere === 0) return plan.gone === 1 ? "Questo alimento non c'è più." : "Non ci sono più.";
  return `Sono già in ${where(to)} o non ci sono più.`;
}

/**
 * Gli eventi di «Sposta»: un `move` per confezione, da scrivere tutti insieme (se una fallisce non si scrive niente).
 * Mai un `move` verso il luogo in cui il lotto già sta.
 */
export function buildMoveSelection(plan: MovePlan, to: Location, ctx: ActionContext): ActionResult {
  if (plan.toMove.length === 0) return { ok: false, error: nothingToMoveText(plan, to) };
  const result = buildForLots(
    plan.toMove,
    (lot) => buildMove(lot, to, ctx),
    (count, name) => moveMessage(count, name, to, plan.alreadyThere, plan.gone),
  );
  if (result.ok && result.events.some((e) => validateEvent(e).length > 0)) {
    return { ok: false, error: "Non riesco a salvare. Non è stato spostato niente." };
  }
  return result;
}

/** Un nome per prodotto, non per confezione: due confezioni dello stesso prodotto sono una voce sola. */
export function shoppingNames(lots: readonly Lot[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const lot of lots) {
    const key = normalizeName(lot.productRef);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    out.push(lot.productRef.trim());
  }
  return out;
}

const MAX_NAMES = 4;

/** L'avviso dopo «Aggiungi alla spesa»: i nomi (fino a quattro, poi «e altri N»). */
export function listMessage(names: readonly string[], gone: number): string {
  const shown = names.slice(0, MAX_NAMES).map(inSentence);
  const rest = names.length - shown.length;
  const list = rest > 0 ? `${shown.join(", ")} e altri ${rest}` : shown.join(", ");
  const extras = selectionExtras(0, gone);
  return `Aggiunto alla lista della spesa: ${list}.${extras === "" ? "" : ` ${extras}`}`;
}

/** La riga nella barra quando le confezioni scelte non ci sono più. */
export const NOTHING_LEFT_TEXT = "Gli alimenti scelti non ci sono più.";

/** Le confezioni scelte che ci sono ancora e quante no, per «Aggiungi alla spesa». */
export function planList(active: readonly Lot[], pickedIds: Iterable<string>): { lots: Lot[]; gone: number } {
  const picked = new Set(pickedIds);
  const lots = active.filter((l) => picked.has(l.lotId));
  return { lots, gone: picked.size - lots.length };
}
