// Salvare ciò che sta scadendo: quali azioni già esistenti nell'app proporre per un lotto, nell'ordine utile.
// Nessuna azione nuova e nessun consiglio: le durate vengono solo dalla tabella di `core/expiry`.
import { canFreeze } from "@/core/expiry";
import { ideasHref } from "../ai-capture/ideasFood";
import { isFoodCategory, type PantryEntry } from "../lots";

export type SaveAction = "freeze" | "cook" | "pair";

/** Stessi nomi che queste azioni hanno nel resto dell'app. */
export const SAVE_LABELS: Record<SaveAction, string> = {
  freeze: "Sposta in freezer",
  cook: "Cosa cucinare",
  pair: "Con cosa sta bene",
};

/** «Cosa cucinare» parte dall'alimento del lotto: `?alimento=` è il punto di partenza delle idee. */
export const cookHref = (name: string): string => ideasHref(name);
export const pairHref = (name: string): string => `/app/ricette/abbinamenti?alimento=${encodeURIComponent(name)}`;

/**
 * Azioni per un lotto vicino alla scadenza, nell'ordine: freezer, cosa cucinare, con cosa sta bene.
 * Un lotto già scaduto non ne ha (non si salva, si decide se buttarlo); una data di qualità passata ammette le idee ma
 * non il freezer. Il freezer manca anche se è già lì, se la categoria non si congela secondo la tabella o se è già
 * stato scongelato (la tabella non dice nulla sul ricongelare).
 */
export function saveActions(entry: PantryEntry): SaveAction[] {
  const level = entry.urgency?.level;
  if (entry.lot.remaining <= 0) return [];
  if (level !== "today" && level !== "tomorrow" && level !== "soon" && level !== "past_quality") return [];
  const { lot } = entry;
  const actions: SaveAction[] = [];
  if (
    level !== "past_quality" &&
    lot.location !== "freezer" &&
    lot.thawedAt === undefined &&
    isFoodCategory(lot.category) &&
    canFreeze(lot.category)
  ) {
    actions.push("freeze");
  }
  actions.push("cook", "pair");
  return actions;
}
