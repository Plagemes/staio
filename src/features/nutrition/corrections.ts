// Correggere l'alimento di una voce già registrata. Per le voci libere di un pasto si scrive un nuovo evento che
// sostituisce il pasto con `foodId` aggiornato (void del vecchio + nuovo con `replaces`, come ogni correzione);
// i `consume` della dispensa restano legati al pasto perché il `mealId` non cambia.
import { validateDiaryEvent, type MealEvent } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { correct, generateId, type IdGenerator, type LedgerEvent, type ReplacementEvent } from "@/core/ledger";

/** Una voce libera di un pasto: l'evento del pasto che la contiene e la sua posizione. */
export interface MealItemRef {
  eventId: string;
  itemIndex: number;
}

export interface CorrectionContext {
  now: string;
  deviceId: string;
  idGenerator?: IdGenerator;
}

export type CorrectionResult = { ok: true; events: AnyEvent[]; meals: number } | { ok: false; error: string };

/**
 * Imposta `foodId` sulle voci indicate. Un pasto con più voci da correggere si sostituisce una volta sola.
 * Un pasto che non si trova (o non è più attivo) è un errore: meglio non scrivere niente.
 */
export function correctMealItems(
  events: readonly AnyEvent[],
  refs: readonly MealItemRef[],
  foodId: string,
  ctx: CorrectionContext,
): CorrectionResult {
  if (refs.length === 0) return { ok: false, error: "Nessuna voce da correggere." };
  const byMeal = new Map<string, Set<number>>();
  for (const r of refs) {
    const set = byMeal.get(r.eventId);
    if (set) set.add(r.itemIndex);
    else byMeal.set(r.eventId, new Set([r.itemIndex]));
  }
  const voided = new Set<string>();
  for (const e of events) if (e.type === "void") voided.add(e.targetEventId);

  const idGenerator = ctx.idGenerator ?? generateId;
  const out: AnyEvent[] = [];
  for (const [eventId, indexes] of byMeal) {
    const meal = events.find((e): e is MealEvent => e.type === "meal" && e.id === eventId);
    if (!meal || voided.has(meal.id) || !meal.items) return { ok: false, error: "Non trovo più il pasto da correggere." };
    const items = meal.items.map((item, i) => (indexes.has(i) ? { ...item, foodId } : item));
    // i campi che `correct` ricava da solo non si passano
    const { id: _id, at: _at, recordedAt: _rec, deviceId: _dev, schemaVersion: _sv, replaces: _rep, ...rest } = meal;
    void [_id, _at, _rec, _dev, _sv, _rep];
    const [voidOfOld, replacement] = correct(
      meal as unknown as LedgerEvent,
      { ...rest, items } as unknown as ReplacementEvent,
      { idGenerator, now: () => ctx.now, deviceId: ctx.deviceId },
    );
    if (validateDiaryEvent(replacement).length > 0) return { ok: false, error: "Non riesco a scrivere la correzione." };
    out.push(voidOfOld, replacement as unknown as AnyEvent);
  }
  return { ok: true, events: out, meals: byMeal.size };
}
