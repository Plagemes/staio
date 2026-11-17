// L'unico punto per aggiungere voci a mano alla lista della spesa da fuori della schermata (per esempio dal ricettario).
// Scrive nella stessa impostazione che la schermata legge, nella sua forma, e dà indietro ciò che serve per «Annulla».
import { generateId } from "@/core/ledger";
import { getSetting, setSetting } from "@/data";
import { baseQuantityOf, mergeManualItems, type ManualInput, type ManualItem } from "./manual";
import { SETTING_KEYS, isManualList } from "./settings";

export interface AddToListResult {
  /** Quante delle voci date sono entrate in lista (sommate a una già presente o nuove). */
  added: number;
  /** Quante sono entrate senza quantità («q.b.»). */
  withoutQuantity: number;
  /** Cosa c'era prima: «Annulla» lo rimette. */
  previous: ManualItem[];
  undo: () => Promise<void>;
}

/** Legge l'elenco; accetta anche la forma più semplice `{ product, quantity }` scritta prima che la lista avesse id. */
async function readList(now: string): Promise<ManualItem[]> {
  const raw = await getSetting<unknown>(SETTING_KEYS.manual);
  if (isManualList(raw)) return raw;
  if (!Array.isArray(raw)) return [];
  const out: ManualItem[] = [];
  for (const e of raw) {
    if (typeof e !== "object" || e === null || typeof (e as { product?: unknown }).product !== "string") continue;
    const r = e as { id?: unknown; product: string; quantity?: { value: number; unit: "g" | "ml" | "pz" }; addedAt?: unknown };
    out.push({
      id: typeof r.id === "string" ? r.id : generateId(),
      product: r.product,
      ...(baseQuantityOf(r.quantity) ? { quantity: baseQuantityOf(r.quantity) } : {}),
      addedAt: typeof r.addedAt === "string" ? r.addedAt : now,
    });
  }
  return out;
}

/** Aggiunge voci alla lista della spesa. Le voci senza quantità entrano come voci senza quantità, non vengono saltate. */
export async function addManualEntries(entries: readonly ManualInput[], now: string = new Date().toISOString()): Promise<AddToListResult> {
  const previous = await readList(now);
  const valid = entries.filter((e) => e.product.trim() !== "");
  if (valid.length === 0) return { added: 0, withoutQuantity: 0, previous, undo: async () => {} };
  await setSetting(SETTING_KEYS.manual, mergeManualItems(previous, valid, now));
  return {
    added: valid.length,
    withoutQuantity: valid.filter((e) => baseQuantityOf(e.quantity) === undefined).length,
    previous,
    undo: () => setSetting(SETTING_KEYS.manual, previous),
  };
}
