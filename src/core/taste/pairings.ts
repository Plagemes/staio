import { basisOf } from "./basis";
import { resolveTasteFood, type TasteIndex } from "./index-build";
import { screenFood } from "./safety";
import type { Pairing, PairingOptions, PairingResult, TasteFood, TasteSubject } from "./types";

export const DEFAULT_PAIRING_LIMIT = 20;

const round3 = (n: number): number => Math.round(n * 1000) / 1000;

/**
 * Cosa si abbina a un insieme di ingredienti (una ricetta, ciò che c'è in dispensa), con quali di loro e se c'è già in
 * casa. Il punteggio di un candidato è la media dei punteggi con ciascun alimento dell'insieme, contando 0 dove non c'è
 * legame: chi si abbina a molti sale. Si mostra il punteggio, ma si ordina per il valore d'ordine dei dati (stessa media). Gli alimenti che non sono nell'elenco sono dichiarati in `unknown`, mai inventati.
 * Gli abbinamenti con un allergene dichiarato (o un alimento escluso) non compaiono; quelli incerti restano con
 * `doubt`. Si tengono i primi `limit` più tutti quelli che ci sono in casa.
 */
export function pairingsForSet(
  index: TasteIndex,
  subjects: readonly TasteSubject[],
  options: PairingOptions = {},
): PairingResult {
  const basis = basisOf(index.data.source);
  const members: TasteFood[] = [];
  const unknown: string[] = [];
  for (const s of subjects) {
    const food = resolveTasteFood(index, s);
    if (!food) {
      if (!unknown.includes(s.name)) unknown.push(s.name);
    } else if (!members.some((m) => m.key === food.key)) members.push(food);
  }
  if (members.length === 0) return { status: "not_in_list", unknown, basis };

  const memberKeys = new Set(members.map((m) => m.key));
  const homeByKey = new Map<string, string[]>();
  let homeNotInList = 0;
  for (const h of options.home ?? []) {
    const food = resolveTasteFood(index, h);
    if (!food) {
      homeNotInList++;
      continue;
    }
    const names = homeByKey.get(food.key) ?? [];
    if (!names.includes(h.name)) names.push(h.name);
    homeByKey.set(food.key, names);
  }

  const sums = new Map<string, { total: number; rank: number; by: string[] }>();
  for (const m of members) {
    for (const [other, link] of index.links.get(m.key) ?? []) {
      if (memberKeys.has(other)) continue;
      const entry = sums.get(other) ?? { total: 0, rank: 0, by: [] };
      entry.total += link.score;
      entry.rank += link.rank;
      entry.by.push(m.name);
      sums.set(other, entry);
    }
  }

  const all: Pairing[] = [];
  let hiddenCount = 0;
  for (const [key, { total, rank, by }] of sums) {
    const food = index.byKey.get(key);
    if (!food) continue;
    const verdict = screenFood(food, {
      ...(options.allergens ? { allergens: options.allergens } : {}),
      ...(options.excludedFoods ? { excludedFoods: options.excludedFoods } : {}),
    });
    if (verdict.status === "excluded") {
      hiddenCount++;
      continue;
    }
    const homeNames = homeByKey.get(key) ?? [];
    all.push({
      food,
      score: round3(total / members.length),
      rank: round3(rank / members.length),
      supportedBy: by,
      inHome: homeNames.length > 0,
      homeNames,
      ...(verdict.status === "uncertain" ? { doubt: verdict.doubt } : {}),
    });
  }
  all.sort(
    (a, b) =>
      b.rank - a.rank || b.score - a.score || b.supportedBy.length - a.supportedBy.length || a.food.name.localeCompare(b.food.name, "it"),
  );
  const limit = options.limit ?? DEFAULT_PAIRING_LIMIT;
  const pairings = all.filter((p, i) => i < limit || p.inHome);
  return { status: "ok", members, unknown, pairings, hiddenCount, homeNotInList, basis };
}

/** Cosa si abbina a un ingrediente, in ordine di punteggio. Un solo ingrediente è un insieme di uno. */
export function pairingsOf(index: TasteIndex, subject: TasteSubject, options: PairingOptions = {}): PairingResult {
  return pairingsForSet(index, [subject], options);
}
