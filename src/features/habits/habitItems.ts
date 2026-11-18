// «Cambia gli alimenti» di un pasto abituale: dalle righe del modulo alle voci da salvare. Logica pura.
import type { MealItem } from "@/core/diary";
import { formatQuantity } from "@/core/units";
import { readQuantity } from "../capture";

export interface HabitItemRow {
  name: string;
  quantityText: string;
  /** La voce di partenza, per una riga che c'era già. */
  original?: MealItem;
}

export type HabitItemsResult =
  | { ok: true; items: MealItem[] }
  | {
      ok: false;
      /** Per posizione della riga. */
      errors: Record<number, string>;
      general?: string;
    };

export const NO_ITEMS = "Lascia almeno un alimento, oppure ritira il pasto.";

/** Le righe del modulo per le voci di un pasto abituale: «200 ml», «2 pz». */
export function habitItemRows(items: readonly MealItem[]): HabitItemRow[] {
  return items.map((item) => ({ name: item.name, quantityText: formatQuantity(item.quantity), original: item }));
}

/**
 * Le voci nuove. Una riga vuota (nome e quantità) non conta; una quantità che non si legge, o un nome senza quantità,
 * è un errore sotto quella riga e non si salva niente. Una voce che c'era tiene la sua certezza e il suo alimento della
 * tabella; una nuova è una stima. Senza voci non si salva.
 */
export function readHabitItems(rows: readonly HabitItemRow[]): HabitItemsResult {
  const errors: Record<number, string> = {};
  const items: MealItem[] = [];
  rows.forEach((row, index) => {
    const name = row.name.trim().replace(/\s+/g, " ");
    const text = row.quantityText.trim();
    if (name === "" && text === "") return;
    if (name === "") {
      errors[index] = "Scrivi come si chiama.";
      return;
    }
    const read = readQuantity(text);
    if (!read.ok) {
      errors[index] = read.error;
      return;
    }
    const kept = row.original;
    items.push({
      name,
      quantity: read.quantity,
      certainty: kept ? kept.certainty : "estimated",
      ...(kept?.foodId ? { foodId: kept.foodId } : {}),
    });
  });
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  if (items.length === 0) return { ok: false, errors: {}, general: NO_ITEMS };
  return { ok: true, items };
}
