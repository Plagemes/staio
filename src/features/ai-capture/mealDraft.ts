// Dalla bozza dell'intelligenza artificiale (frase o foto) alle righe da rivedere, e dalle righe confermate agli eventi
// di un pasto. La composizione degli eventi è quella dei pasti normali (`buildMealEvents`): qui si aggiungono solo la fonte
// (`voice` o `photo`) e la certezza `estimated` su tutto ciò che nasce dalla bozza. Nulla si scrive senza conferma.
import type { MealPhraseDraft } from "@/core/ai/mealPhraseParse";
import type { PlatePhotoDraft, PlateRange } from "@/core/ai/platePhotoParse";
import { validateDiaryEvent, type MealKind } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { validateEvent, type Lot, type Source } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { parseAmountForLot } from "../actions";
import { readQuantity } from "../capture";
import { buildMealEvents, type MealContext, type MealErrors } from "../meals";
import type { PantryTarget } from "./pantryRefs";

export type DraftSource = Extract<Source, "voice" | "photo">;

export interface PhotoEstimate {
  range: PlateRange;
  unit: "g" | "ml" | "pz";
}

/** Una riga da rivedere: o un lotto della dispensa (`lotId`) o una voce libera. */
export interface DraftRow {
  key: string;
  /** Lotto vero della dispensa; assente per le voci libere. */
  lotId?: string;
  name: string;
  /** Quantità scritta, modificabile. Vuota se la bozza non ne aveva una credibile. */
  amountText: string;
  /** Alimento della tabella scelto dall'utente (solo voci libere). */
  foodId?: string;
  /** «Nessuno di questi»: nessun alimento della tabella scelto. */
  none?: boolean;
  /** Entra nel pasto? */
  include: boolean;
  /** Certezza dichiarata dal modello, da 0 a 1. */
  confidence: number;
  /** Sotto la soglia di certezza: parte non inclusa e si chiede conferma. */
  question: boolean;
  /** Solo da foto: la quantità è una stima e porta il suo intervallo. */
  photo?: PhotoEstimate;
}

const quantityText = (q: { value: number; unit: "g" | "ml" | "pz" } | undefined): string => (q ? formatQuantity(q) : "");

let counter = 0;
const nextKey = (): string => `row-${++counter}`;

export function newFreeRow(): DraftRow {
  return { key: nextKey(), name: "", amountText: "", include: true, confidence: 1, question: false };
}

export function newPantryRow(lot: Pick<Lot, "lotId" | "productRef">): DraftRow {
  return { key: nextKey(), lotId: lot.lotId, name: lot.productRef, amountText: "", include: true, confidence: 1, question: false };
}

/** Righe dalla risposta a una frase. Le voci sono incluse: l'utente le ha appena dette, e le rivede comunque. */
export function rowsFromPhrase(draft: MealPhraseDraft, target: Pick<PantryTarget, "lotsById">): DraftRow[] {
  const rows: DraftRow[] = [];
  for (const item of draft.items) {
    const lot = target.lotsById.get(item.pantryId);
    if (!lot) continue; // difesa: l'interprete scarta già gli id sconosciuti
    rows.push({ key: nextKey(), lotId: lot.lotId, name: lot.productRef, amountText: quantityText(item.quantity), include: true, confidence: item.confidence, question: false });
  }
  for (const item of draft.free) {
    rows.push({ key: nextKey(), name: item.name, amountText: quantityText(item.quantity), include: true, confidence: item.confidence, question: false });
  }
  return rows;
}

/** Righe dalla risposta a una foto. Le voci sotto soglia sono domande: partono non incluse. */
export function rowsFromPlate(draft: PlatePhotoDraft, target: Pick<PantryTarget, "lotsById">): DraftRow[] {
  const rows: DraftRow[] = [];
  for (const item of draft.items) {
    const lot = item.pantryId === undefined ? undefined : target.lotsById.get(item.pantryId);
    rows.push({
      key: nextKey(),
      ...(lot ? { lotId: lot.lotId } : {}),
      name: lot ? lot.productRef : item.name,
      amountText: quantityText(item.quantity),
      include: !item.question,
      confidence: item.confidence,
      question: item.question,
      ...(item.range && item.quantity ? { photo: { range: item.range, unit: item.quantity.unit } } : {}),
    });
  }
  return rows;
}

/** Un'osservazione sulla riga (quantità non leggibile, oltre quanto resta…), o undefined se va bene. */
export function rowIssue(row: DraftRow, lotsById: ReadonlyMap<string, Lot>): string | undefined {
  if (row.lotId !== undefined) {
    const lot = lotsById.get(row.lotId);
    if (!lot || lot.status !== "active" || !(lot.remaining > 0)) return "Questo alimento non è più in dispensa.";
    if (row.amountText.trim() === "") return "Scrivi quanto.";
    const amount = parseAmountForLot(row.amountText, lot);
    return amount.ok ? undefined : amount.error;
  }
  if (row.name.trim() === "") return row.amountText.trim() === "" ? undefined : "Scrivi come si chiama.";
  const q = readQuantity(row.amountText);
  return q.ok ? undefined : q.error;
}

export interface DraftMealInput {
  kind: MealKind;
  rows: readonly DraftRow[];
  /** Lotti attuali della dispensa, per id vero: lo stato di adesso, non quello di quando è partita la richiesta. */
  lotsById: ReadonlyMap<string, Lot>;
  source: DraftSource;
}

export type DraftMealResult =
  | { ok: true; events: AnyEvent[]; mealId: string; message: string }
  | { ok: false; rowErrors: Record<string, string>; general?: string };

/**
 * Gli eventi del pasto dalle righe confermate: lo stesso `meal` più un `consume` per lotto dei pasti normali,
 * poi la fonte della bozza e la certezza `estimated` su ogni evento. Non scrive nulla.
 */
export function buildDraftMealEvents(input: DraftMealInput, ctx: MealContext): DraftMealResult {
  const rowErrors: Record<string, string> = {};
  const picks: { lot: Lot; choice: { kind: "text"; text: string }; key: string }[] = [];
  const freeRows: DraftRow[] = [];
  const usedLots = new Set<string>();

  for (const row of input.rows) {
    if (!row.include) continue;
    if (row.lotId === undefined) {
      freeRows.push(row);
      continue;
    }
    const lot = input.lotsById.get(row.lotId);
    if (!lot || lot.status !== "active") {
      rowErrors[row.key] = "Questo alimento non è più in dispensa.";
      continue;
    }
    if (usedLots.has(lot.lotId)) {
      // due righe sullo stesso lotto non si sommano da sole: il controllo sulla quantità rimasta varrebbe per ciascuna
      rowErrors[row.key] = "Questo alimento compare due volte: tieni una riga sola.";
      continue;
    }
    usedLots.add(lot.lotId);
    picks.push({ lot, choice: { kind: "text", text: row.amountText }, key: row.key });
  }
  if (Object.keys(rowErrors).length > 0) return { ok: false, rowErrors };

  const built = buildMealEvents(
    {
      kind: input.kind,
      picks: picks.map(({ lot, choice }) => ({ lot, choice })),
      freeItems: freeRows.map((r) => ({ name: r.name, quantityText: r.amountText, ...(r.foodId ? { foodId: r.foodId } : {}) })),
    },
    ctx,
  );
  if (!built.ok) {
    for (const p of picks) {
      const message = built.errors.picks[p.lot.lotId];
      if (message) rowErrors[p.key] = message;
    }
    freeRows.forEach((r, index) => {
      const message = (built.errors as MealErrors).free[index];
      if (message) rowErrors[r.key] = message;
    });
    return { ok: false, rowErrors, ...(built.errors.general ? { general: built.errors.general } : {}) };
  }

  // ciò che nasce da una bozza dell'IA vale come stima, anche se l'utente ha riscritto il numero a mano
  const events = built.events.map((e): AnyEvent => ({ ...e, source: input.source, certainty: "estimated" }) as AnyEvent);
  for (const e of events) {
    const invalid = e.type === "consume" ? validateEvent(e).length > 0 : e.type === "meal" ? validateDiaryEvent(e).length > 0 : false;
    if (invalid) return { ok: false, rowErrors: {}, general: "Non riesco a scrivere questo pasto: controlla le quantità." };
  }
  return { ok: true, events, mealId: built.mealId, message: built.message };
}

export function certaintyWord(confidence: number): string {
  const label = confidence >= 0.75 ? "alta" : confidence >= 0.5 ? "media" : "bassa";
  return `${label} (${Math.round(confidence * 100)}%)`;
}
