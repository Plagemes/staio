// Correggere l'alimento di una voce già registrata. Per le voci libere di un pasto si scrive un nuovo evento che
// sostituisce il pasto con `foodId` aggiornato (void del vecchio + nuovo con `replaces`, come ogni correzione);
// i `consume` della dispensa restano legati al pasto perché il `mealId` non cambia.
//
// Il pasto si legge com'è mostrato (`currentMeal`), non dall'evento: se due dispositivi l'hanno corretto prima di
// unirsi, le voci mostrate sono l'unione delle versioni e la posizione di una voce vale solo lì. Per lo stesso motivo
// si annullano tutte le versioni in vigore, non solo quella citata: altrimenti riaffiorerebbe l'altra.
import { currentMeal, deriveDiary, validateDiaryEvent, type MealEvent } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { correct, generateId, voidEvent, type IdGenerator, type LedgerEvent, type ReplacementEvent } from "@/core/ledger";

/** Una voce libera di un pasto: l'evento del pasto che la contiene (quello che il diario mostra) e la sua posizione tra le voci mostrate. */
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

const MEAL_GONE = "Non trovo più il pasto da correggere.";

/**
 * Imposta `foodId` sulle voci indicate. Un pasto con più voci da correggere si sostituisce una volta sola.
 * Un pasto che non si trova, non è più attivo o nel frattempo è cambiato è un errore: meglio non scrivere niente.
 */
export function correctMealItems(
  events: readonly AnyEvent[],
  refs: readonly MealItemRef[],
  foodId: string,
  ctx: CorrectionContext,
): CorrectionResult {
  if (refs.length === 0) return { ok: false, error: "Nessuna voce da correggere." };
  const isMeal = (e: AnyEvent): e is MealEvent => e.type === "meal";

  // Per pasto, non per evento: le posizioni valgono per il pasto com'è mostrato.
  const byMeal = new Map<string, { shownId: string; indexes: Set<number> }>();
  for (const r of refs) {
    const cited = events.find((e): e is MealEvent => isMeal(e) && e.id === r.eventId);
    if (!cited) return { ok: false, error: MEAL_GONE };
    const entry = byMeal.get(cited.mealId);
    if (!entry) byMeal.set(cited.mealId, { shownId: cited.id, indexes: new Set([r.itemIndex]) });
    else if (entry.shownId !== cited.id) return { ok: false, error: MEAL_GONE };
    else entry.indexes.add(r.itemIndex);
  }
  const voided = new Set(deriveDiary(events).voidedEventIds);

  const factory = { idGenerator: ctx.idGenerator ?? generateId, now: () => ctx.now, deviceId: ctx.deviceId };
  const out: AnyEvent[] = [];
  for (const [mealId, { shownId, indexes }] of byMeal) {
    const shown = currentMeal(mealId, events)?.meal;
    const live = events.filter((e): e is MealEvent => isMeal(e) && e.mealId === mealId && !voided.has(e.id));
    // La voce è stata indicata guardando una certa versione: se ora ne vale un'altra, la posizione non è più sicura.
    if (!shown || shown.id !== shownId || !shown.items || !live.some((e) => e.id === shown.id)) return { ok: false, error: MEAL_GONE };
    const shownItems = shown.items;
    if ([...indexes].some((i) => !Number.isInteger(i) || i < 0 || i >= shownItems.length)) return { ok: false, error: MEAL_GONE };

    const items = shownItems.map((item, i) => (indexes.has(i) ? { ...item, foodId } : item));
    // i campi che `correct` ricava da solo non si passano
    const { id: _id, at: _at, recordedAt: _rec, deviceId: _dev, schemaVersion: _sv, replaces: _rep, ...rest } = shown;
    void [_id, _at, _rec, _dev, _sv, _rep];
    const [voidOfShown, replacement] = correct(shown as unknown as LedgerEvent, { ...rest, items } as unknown as ReplacementEvent, factory);
    if (validateDiaryEvent(replacement).length > 0) return { ok: false, error: "Non riesco a scrivere la correzione." };
    const voidsOfOthers = live.filter((e) => e.id !== shown.id).map((e) => voidEvent(e as unknown as LedgerEvent, factory));
    out.push(voidOfShown, ...voidsOfOthers, replacement as unknown as AnyEvent);
  }
  return { ok: true, events: out, meals: byMeal.size };
}
