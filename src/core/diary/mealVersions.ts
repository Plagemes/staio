// Più eventi `meal` validi con lo stesso `mealId`: succede quando due dispositivi correggono lo stesso pasto prima di
// unirsi. Qui si decide che cosa vale, allo stesso modo per il diario (`deriveDiary`) e per le correzioni (`editMeal`).
//
// Vale la versione più recente (per `recordedAt`, poi `id`), come per i consumi. Le altre non si buttano se si possono
// unire senza inventare niente. Ogni correzione cita in `replaces` la versione da cui è partita: risalendo si trova la
// versione comune, e rispetto a quella si vede che cosa ha fatto ciascuna parte.
// - Momento e ora: se una parte non li ha toccati, vale il valore dell'altra.
// - Voci libere: se una parte ha solo aggiunto voci (tutte quelle della versione comune ci sono ancora), le sue aggiunte
//   si mettono in coda alle voci dell'altra, che può averne cambiate o tolte. Due aggiunte identiche valgono una.
// - Se tutte e due hanno cambiato o tolto voci della versione comune, non c'è un modo sicuro di unirle: una voce non ha
//   un identificativo, e una quantità corretta non si distingue da una voce tolta e una aggiunta. Vale la più recente,
//   e l'altra viene segnalata intera (`others`), così chi guarda può dirlo all'utente.

import { worseCertainty, type Certainty } from "../ledger";
import { cloneMealItems } from "./items";
import type { MealEvent, MealItem, MealKind } from "./types";

export interface ResolvedMeal {
  /** La versione più recente: dà l'id, il titolo, la fonte e tutto ciò che l'unione non tocca. */
  winner: MealEvent;
  kind: MealKind;
  at: string;
  certainty: Certainty;
  items: MealItem[];
  /** Versioni più vecchie entrate per intero nel risultato. */
  merged: MealEvent[];
  /** Versioni più vecchie rimaste fuori perché in conflitto con il risultato, dalla più recente. */
  others: MealEvent[];
}

/** `a` è stato registrato dopo `b`: per `recordedAt`, poi per `id`. */
export function recordedLater(a: { recordedAt: string; id: string }, b: { recordedAt: string; id: string }): boolean {
  const ta = Date.parse(a.recordedAt);
  const tb = Date.parse(b.recordedAt);
  if (ta !== tb) return ta > tb;
  return a.id > b.id;
}

const itemKey = (i: MealItem): string =>
  JSON.stringify([i.name, i.quantity.value, i.quantity.unit, i.certainty, i.foodId ?? ""]);

/** Le voci di `a` che non hanno una voce uguale in `b` (contando le ripetizioni), nell'ordine di `a`. */
function minus(a: readonly MealItem[], b: readonly MealItem[]): MealItem[] {
  const left = new Map<string, number>();
  for (const i of b) left.set(itemKey(i), (left.get(itemKey(i)) ?? 0) + 1);
  const out: MealItem[] = [];
  for (const i of a) {
    const n = left.get(itemKey(i)) ?? 0;
    if (n > 0) left.set(itemKey(i), n - 1);
    else out.push(i);
  }
  return out;
}

/** La versione e quelle da cui discende, dalla più vicina. Una catena che torna su se stessa si ferma. */
function lineage(start: MealEvent, lookup: (id: string) => MealEvent | undefined): string[] {
  const ids = [start.id];
  const seen = new Set(ids);
  let cur: MealEvent | undefined = start;
  while (cur !== undefined && typeof cur.replaces === "string" && cur.replaces !== "" && !seen.has(cur.replaces)) {
    ids.push(cur.replaces);
    seen.add(cur.replaces);
    cur = lookup(cur.replaces);
  }
  return ids;
}

/**
 * Che cosa vale tra più versioni valide dello stesso pasto. `live` non è vuoto; `lookup` trova ogni evento `meal`
 * valido del registro per id, annullati compresi (servono per risalire alla versione comune). Il risultato dipende solo
 * dall'insieme degli eventi, non dal loro ordine.
 */
export function resolveMealVersions(
  live: readonly MealEvent[],
  lookup: (id: string) => MealEvent | undefined,
): ResolvedMeal {
  const sorted = [...live].sort((a, b) => (recordedLater(a, b) ? -1 : recordedLater(b, a) ? 1 : 0));
  const winner = sorted[0];
  const out: ResolvedMeal = {
    winner,
    kind: winner.kind,
    at: winner.at,
    certainty: winner.certainty,
    items: cloneMealItems(winner.items),
    merged: [],
    others: [],
  };
  if (sorted.length === 1) return out;

  const ours = new Set(lineage(winner, lookup));
  for (const other of sorted.slice(1)) {
    const commonId = lineage(other, lookup).find((id) => ours.has(id));
    const common = commonId === undefined ? undefined : commonId === winner.id ? winner : commonId === other.id ? other : lookup(commonId);
    if (common === undefined) {
      out.others.push(other);
      continue;
    }
    const base = cloneMealItems(common.items);
    const theirs = cloneMealItems(other.items);
    const theirAdded = minus(theirs, base);
    const theirRemoved = minus(base, theirs);
    const ourAdded = minus(out.items, base);
    const ourRemoved = minus(base, out.items);

    if (theirRemoved.length === 0) out.items = [...out.items, ...minus(theirAdded, ourAdded)];
    else if (ourRemoved.length === 0) out.items = [...theirs, ...minus(ourAdded, theirAdded)];
    else {
      out.others.push(other);
      continue;
    }
    if (out.kind === common.kind) out.kind = other.kind;
    if (out.at === common.at) out.at = other.at;
    out.certainty = worseCertainty(out.certainty, other.certainty);
    out.merged.push(other);
  }
  return out;
}
