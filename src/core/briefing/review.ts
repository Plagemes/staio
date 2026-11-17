// La coda «Da rivedere»: ciò che l'app ha registrato con incertezza e che si sistema in pochi secondi.
// Mette in coda solo ciò che il registro sa distinguere davvero:
// - pasti dichiarati «mangiato, non registrato» in un giorno passato (dichiarazione o vecchio «non tracciato»);
// - ingressi da scontrino o da foto, a quantità ancora provvisoria (mai controllati né corretti);
// - lotti senza categoria e senza una data stampata: la scadenza non si può stimare;
// - lotti la cui quantità rimasta è solo una stima dopo vari usi;
// - alimenti usati nei pasti più volte senza valori nutrizionali;
// - scadenze solo stimate, da molto tempo, su lotti ancora in casa.
// Un lotto compare una volta sola (la voce più utile vince). Le ragioni di una voce non sono pareri: dicono lo stato del registro.

import { activeLots, type LedgerEvent, type Lot } from "../ledger";
import { addDays, daysBetween, getDay, localDate, mealMoments } from "../diary";
import type { AnyEvent } from "../events";
import { EXPIRED_LOOKBACK_DAYS } from "../notify/expiryFacts";
import type { BriefingInput, ReviewItem } from "./types";
import { MEAL_NAMES, agoText, dayOfInstant, upperFirst, voidedIds, zoneOf } from "./util";

/** Quanto indietro si guardano i pasti non registrati. */
export const UNTRACKED_LOOKBACK_DAYS = 7;
/** Un ingresso da scontrino o foto è «provvisorio» tra questi giorni dall'ingresso: prima, l'utente lo sta ancora rivedendo. */
export const PROVISIONAL_MIN_DAYS = 2;
export const PROVISIONAL_MAX_DAYS = 30;
/** Una quantità stimata dopo degli usi si rivede quando il lotto è in casa da almeno questi giorni. */
export const QUANTITY_MIN_AGE_DAYS = 14;
/** Una scadenza solo stimata si rivede dopo questi giorni dall'ultima stima. */
export const STALE_EXPIRY_DAYS = 30;
/** Un alimento senza valori pesa se è comparso almeno così spesso... */
export const NO_NUTRITION_MIN_COUNT = 3;
/** ...negli ultimi giorni. */
export const NO_NUTRITION_WINDOW_DAYS = 14;
/** Voci mostrate in coda; il conteggio le comprende tutte. */
export const MAX_REVIEW_ITEMS = 8;

/** Fonte con cui è entrato ogni lotto. */
function sourcesOf(log: readonly AnyEvent[]): Map<string, string> {
  const voided = voidedIds(log);
  const out = new Map<string, string>();
  for (const e of log) {
    if (e.type !== "purchase" && e.type !== "declare") continue;
    const ev = e as LedgerEvent & { lotId: string };
    if (!voided.has(ev.id)) out.set(ev.lotId, ev.source);
  }
  return out;
}

const touched = (lot: Lot): boolean => lot.history.some((h) => h.type === "adjust" || h.type === "updateLot");

/** Giorno dell'ultima stima della scadenza: la creazione o l'ultima correzione del lotto. */
function expiryEstimatedOn(lot: Lot, timeZone: string): string {
  let at = lot.createdAt;
  for (const h of lot.history) if (h.type === "updateLot" && h.at > at) at = h.at;
  return dayOfInstant(at, timeZone);
}

/** Tutta la coda, per urgenza, senza ciò che l'utente ha lasciato così. */
export function buildReviewItems(input: BriefingInput): ReviewItem[] {
  const timeZone = zoneOf(input.timeZone);
  const today = localDate(input.now, timeZone);
  if (!today) return [];
  const items: ReviewItem[] = [];
  const used = new Set<string>();

  // pasti «mangiato, non registrato» nei giorni passati
  for (let back = 1; back <= UNTRACKED_LOOKBACK_DAYS; back++) {
    const date = addDays(today, -back);
    for (const m of mealMoments(getDay(input.diary, date))) {
      if (m.status !== "untracked") continue;
      items.push({
        key: `untracked:${date}:${m.kind}`,
        kind: "untracked_meal",
        text: `${upperFirst(MEAL_NAMES[m.kind])} di ${agoText(date, today)}`,
        why: "Hai detto di aver mangiato ma non è registrato: i nutrienti di quel giorno restano incompleti.",
        actionLabel: "Registralo",
        href: `/app/pasto?momento=${m.kind}&giorno=${date}`,
        certainty: "recorded",
        order: 10 + back,
      });
    }
  }

  const sources = sourcesOf(input.log);
  const lots = activeLots(input.pantry).filter((l) => l.remaining > 0);

  // ingressi da scontrino o da foto ancora provvisori: una voce per scontrino (o per giorno di foto)
  const batches = new Map<string, { label: string; day: string; lots: Lot[] }>();
  for (const lot of lots) {
    const source = sources.get(lot.lotId);
    if (source !== "receipt" && source !== "photo") continue;
    if (touched(lot) || lot.remainingCertainty !== "estimated") continue;
    const day = dayOfInstant(lot.createdAt, timeZone);
    const age = daysBetween(day, today);
    if (age < PROVISIONAL_MIN_DAYS || age > PROVISIONAL_MAX_DAYS) continue;
    const key = source === "receipt" ? `provisional:receipt:${lot.receiptId ?? day}` : `provisional:photo:${day}`;
    const batch = batches.get(key) ?? { label: source === "receipt" ? "Scontrino" : "Da foto", day, lots: [] };
    batch.lots.push(lot);
    batches.set(key, batch);
  }
  for (const [key, batch] of batches) {
    for (const l of batch.lots) used.add(l.lotId);
    const n = batch.lots.length;
    items.push({
      key,
      kind: "provisional",
      text: `${batch.label} di ${agoText(batch.day, today)}: ${n} ${n === 1 ? "alimento" : "alimenti"} da controllare`,
      why: "Le quantità vengono da una lettura e non le hai mai confermate.",
      actionLabel: "Controlla le quantità",
      href: "/app/dispensa/riallinea",
      certainty: "estimated",
      order: 40,
    });
  }

  // scadenza solo stimata da molto tempo, lotto ancora in casa (non in freezer: lì le stime durano mesi)
  for (const lot of lots) {
    if (used.has(lot.lotId) || lot.location === "freezer" || lot.expiry?.kind !== "estimated") continue;
    const since = daysBetween(expiryEstimatedOn(lot, timeZone), today);
    if (since < STALE_EXPIRY_DAYS) continue;
    // gli scaduti da poco stanno nel riepilogo (avviso di sicurezza): la coda tiene solo ciò che l'avviso non dice più
    if (daysBetween(lot.expiry.date, today) >= 0 && daysBetween(lot.expiry.date, today) <= EXPIRED_LOOKBACK_DAYS) continue;
    used.add(lot.lotId);
    const passed = lot.expiry.date < today;
    items.push({
      key: `stale_expiry:${lot.lotId}:${lot.expiry.date}`,
      kind: "stale_expiry",
      text: `${lot.productRef}: in casa da ${since} giorni`,
      why: passed ? "La scadenza è solo una stima e risulta già passata." : "La scadenza è solo una stima, fatta tanto tempo fa.",
      actionLabel: "Controlla la data",
      href: "/app/dispensa",
      certainty: "estimated",
      order: passed ? 20 : 45,
    });
  }

  // senza categoria e senza una data stampata: la scadenza non si stima
  for (const lot of lots) {
    if (used.has(lot.lotId) || (lot.category ?? "").trim() !== "") continue;
    if (lot.expiry && lot.expiry.kind !== "estimated") continue;
    used.add(lot.lotId);
    items.push({
      key: `no_category:${lot.lotId}`,
      kind: "no_category",
      text: `${lot.productRef}: senza categoria`,
      why: "Senza categoria non riesco a stimare quando scade.",
      actionLabel: "Scegli la categoria",
      href: "/app/dispensa",
      certainty: "estimated",
      order: 30,
    });
  }

  // quantità rimasta solo stimata dopo vari usi, mai riallineata
  for (const lot of lots) {
    if (used.has(lot.lotId) || lot.remainingCertainty !== "estimated") continue;
    if (lot.consumed + lot.discarded <= 0 || lot.history.some((h) => h.type === "adjust")) continue;
    if (daysBetween(dayOfInstant(lot.createdAt, timeZone), today) < QUANTITY_MIN_AGE_DAYS) continue;
    used.add(lot.lotId);
    items.push({
      key: `quantity:${lot.lotId}`,
      kind: "quantity",
      text: `${lot.productRef}: quanto ne resta?`,
      why: "La quantità rimasta è un conto su usi stimati, mai controllato.",
      actionLabel: "Controlla la quantità",
      href: "/app/dispensa/riallinea",
      certainty: "estimated",
      order: 50,
    });
  }

  // alimenti usati spesso nei pasti senza valori nutrizionali
  const since = addDays(today, -NO_NUTRITION_WINDOW_DAYS);
  for (const f of input.unresolvedFoods ?? []) {
    if (f.count < NO_NUTRITION_MIN_COUNT || f.lastDate < since) continue;
    items.push({
      key: `no_nutrition:${f.key}`,
      kind: "no_nutrition",
      text: `${f.label}: usato ${f.count} volte, senza valori nutrizionali`,
      why: "Resta fuori dai totali dei nutrienti, che per questo sono incompleti.",
      actionLabel: "Collega i valori",
      href: "/app/salute/nutrizione",
      certainty: "estimated",
      order: 35,
    });
  }

  const dismissed = new Set(input.dismissed ?? []);
  return items.filter((i) => !dismissed.has(i.key)).sort((a, b) => a.order - b.order || a.key.localeCompare(b.key));
}
