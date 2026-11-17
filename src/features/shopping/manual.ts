// Aggiunte a mano alla lista: anche più righe insieme. Logica pura.
import type { Unit } from "@/core/ledger";
import { normalizeName } from "@/core/shopping";
import { normalize, parseQuantity, type Quantity } from "@/core/units";
import { generateId } from "@/core/ledger";
import { cleanName, readQuantity } from "../capture";

export interface ManualItem {
  id: string;
  product: string;
  /** In unità base. Assente per le voci senza quantità («q.b.»): si comprano, ma non c'è un numero. */
  quantity?: { value: number; unit: Unit };
  addedAt: string;
}

export interface ParsedLine {
  product: string;
  quantity: { value: number; unit: Unit };
  /** Nessuna quantità scritta: vale un pezzo. */
  assumedOne: boolean;
}

export interface ManualReading {
  items: ParsedLine[];
  /** Righe non capite, come scritte. */
  rejected: string[];
}

const TRAILING = /^(.*?)\s+(\d+(?:[.,]\d+)?\s*[a-zA-Zàèéìòù]*\.?)$/;

/** "latte 2 l", "2 l di latte", "6 uova", "pane": una riga, un prodotto. */
export function parseLine(line: string): ParsedLine | null {
  const text = line.trim().replace(/^[-*•\d]+[.)]\s+(?=\D)/, "").replace(/^[-*•]\s*/, "");
  if (text === "") return null;
  const lead = readQuantity(text);
  if (lead.ok) {
    const name = cleanName(lead.rest.replace(/^(di|d')\s*/i, ""));
    if (name !== "") return { product: name, quantity: lead.quantity, assumedOne: false };
  }
  const m = TRAILING.exec(text);
  if (m) {
    const q = parseQuantity(m[2]);
    if (q.ok && q.value.rest.trim() === "") {
      const base = normalize(q.value.quantity);
      if (base.ok && (base.value.unit === "g" || base.value.unit === "ml" || base.value.unit === "pz") && base.value.value > 0) {
        const name = cleanName(m[1]);
        if (name !== "") return { product: name, quantity: { value: base.value.value, unit: base.value.unit }, assumedOne: false };
      }
    }
  }
  if (/^\d/.test(text)) return null;
  return { product: cleanName(text), quantity: { value: 1, unit: "pz" }, assumedOne: true };
}

export function parseManualLines(text: string): ManualReading {
  const items: ParsedLine[] = [];
  const rejected: string[] = [];
  for (const raw of text.split(/\r?\n|;/)) {
    if (raw.trim() === "") continue;
    const p = parseLine(raw);
    if (p) items.push(p);
    else rejected.push(raw.trim());
  }
  return { items, rejected };
}

export function toManualItems(lines: readonly ParsedLine[], addedAt: string, idGenerator: () => string = generateId): ManualItem[] {
  return lines.map((l) => ({ id: idGenerator(), product: l.product, quantity: l.quantity, addedAt }));
}

/** Una voce da aggiungere: la quantità può mancare («q.b.») o essere in qualunque unità del ricettario. */
export interface ManualInput {
  product: string;
  quantity?: Quantity;
}

/** Quantità in unità base (g, ml, pz); `undefined` se manca o non si può contare (pizzico, confezione). */
export function baseQuantityOf(q: Quantity | undefined): ManualItem["quantity"] {
  if (!q || !(q.value > 0)) return undefined;
  const n = normalize(q);
  if (!n.ok || (n.value.unit !== "g" && n.value.unit !== "ml" && n.value.unit !== "pz")) return undefined;
  return { value: n.value.value, unit: n.value.unit };
}

const sameSlot = (a: ManualItem["quantity"], b: ManualItem["quantity"]) => (a === undefined ? b === undefined : b !== undefined && a.unit === b.unit);

/**
 * Aggiunge voci a quelle già scritte: stesso prodotto e stessa unità si sommano; due voci senza quantità dello stesso
 * prodotto restano una sola. Il resto si accoda. Non modifica l'elenco di partenza.
 */
export function mergeManualItems(
  existing: readonly ManualItem[],
  added: readonly ManualInput[],
  addedAt: string,
  idGenerator: () => string = generateId,
): ManualItem[] {
  const out: ManualItem[] = existing.map((e) => ({ ...e, ...(e.quantity ? { quantity: { ...e.quantity } } : {}) }));
  for (const a of added) {
    const product = cleanName(a.product);
    const key = normalizeName(product);
    if (key === "") continue;
    const quantity = baseQuantityOf(a.quantity);
    const hit = out.find((e) => normalizeName(e.product) === key && sameSlot(e.quantity, quantity));
    if (hit) {
      if (hit.quantity && quantity) hit.quantity = { value: Math.round((hit.quantity.value + quantity.value) * 1000) / 1000, unit: hit.quantity.unit };
    } else {
      out.push({ id: idGenerator(), product, ...(quantity ? { quantity } : {}), addedAt });
    }
  }
  return out;
}
