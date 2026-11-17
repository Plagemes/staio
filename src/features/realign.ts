// Riallineamento: quali voci confermare per prime e quali eventi scrivere per ogni risposta. Logica pura.
import { DEFAULT_TIME_ZONE, diffDays, toCalendarDate } from "@/core/expiry";
import { SCHEMA_VERSION, generateId, validateEvent, type LedgerEvent, type Lot, type Quantity } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { parseQuantityInUnit, type ActionContext, type ActionResult } from "./actions";

/** Dopo quanti giorni senza conferma una quantità torna a essere da controllare. */
export const STALE_DAYS = 7;

const EPSILON = 1e-9;

/** Ultima volta in cui la quantità è stata confermata a mano (un riallineamento), se mai. */
export function lastAdjustAt(lot: Lot): string | undefined {
  let last: string | undefined;
  for (const h of lot.history) if (h.type === "adjust") last = h.at;
  return last;
}

/** Giorni da `instant` a `now`, di calendario. */
function ageDays(instant: string, now: string, timeZone: string): number {
  return diffDays(toCalendarDate(now, timeZone), toCalendarDate(instant, timeZone));
}

/** Da quando la quantità non è stata controllata: dall'ultimo riallineamento, o dall'ingresso. */
export function daysSinceConfirmed(lot: Lot, now: string, timeZone: string = DEFAULT_TIME_ZONE): number {
  return ageDays(lastAdjustAt(lot) ?? lot.createdAt, now, timeZone);
}

/**
 * Una quantità è da confermare se non è mai stata riallineata ed è una stima, oppure se l'ultima conferma
 * (o l'ingresso) è vecchia di almeno `STALE_DAYS`. Un riallineamento recente chiude la questione anche se
 * era una stima a occhio: altrimenti non finirebbe mai.
 */
export function needsRealign(lot: Lot, now: string, timeZone: string = DEFAULT_TIME_ZONE): boolean {
  if (lot.status !== "active" || lot.remaining <= 0) return false;
  const adjusted = lastAdjustAt(lot) !== undefined;
  if (!adjusted && lot.remainingCertainty === "estimated") return true;
  return daysSinceConfirmed(lot, now, timeZone) >= STALE_DAYS;
}

/** Voci da confermare, le più incerte per prime: stime mai controllate, poi le più vecchie senza conferma. */
export function orderForRealign(lots: readonly Lot[], now: string, timeZone: string = DEFAULT_TIME_ZONE): Lot[] {
  const rank = (lot: Lot) => (lastAdjustAt(lot) === undefined && lot.remainingCertainty === "estimated" ? 0 : 1);
  return lots
    .filter((lot) => needsRealign(lot, now, timeZone))
    .sort((a, b) => {
      const byRank = rank(a) - rank(b);
      if (byRank !== 0) return byRank;
      const byAge = daysSinceConfirmed(b, now, timeZone) - daysSinceConfirmed(a, now, timeZone);
      if (byAge !== 0) return byAge;
      return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.lotId < b.lotId ? -1 : 1;
    });
}

export type RealignAnswer =
  | { kind: "same" }
  | { kind: "fraction"; fraction: 0.75 | 0.5 | 0.25 }
  | { kind: "text"; text: string }
  | { kind: "finished" };

export const FRACTION_LABELS: Record<0.75 | 0.5 | 0.25, string> = {
  0.75: "Tre quarti",
  0.5: "Metà",
  0.25: "Un quarto",
};

const FRACTIONS = [0.75, 0.5, 0.25] as const;

/** Quantità rimasta se è una certa parte di quella iniziale; i pezzi restano interi. */
export function fractionOfInitial(lot: Pick<Lot, "initial" | "unit">, fraction: number): Quantity {
  const raw = lot.initial * fraction;
  const value = lot.unit === "pz" ? Math.max(1, Math.round(raw)) : Math.round(raw * 100) / 100;
  return { value, unit: lot.unit };
}

/** Le scelte rapide che dicono davvero «meno» di quanto il registro crede ci sia. */
export function fractionChoices(lot: Pick<Lot, "initial" | "unit" | "remaining">): { fraction: 0.75 | 0.5 | 0.25; quantity: Quantity }[] {
  return FRACTIONS.map((fraction) => ({ fraction, quantity: fractionOfInitial(lot, fraction) })).filter(
    (c) => c.quantity.value < lot.remaining - EPSILON,
  );
}

/**
 * Ogni risposta è un `adjust`, cioè «la quantità rimasta è questa», e non un consumo: il riallineamento
 * dice come stanno le cose, non che cosa è successo. Per «è finito» non so se è stato mangiato o buttato,
 * quindi non scrivo né un consumo né uno spreco inventati.
 */
export function buildRealign(lot: Lot, answer: RealignAnswer, ctx: ActionContext): ActionResult {
  let remaining: Quantity;
  let certainty: "measured" | "estimated" = "measured";
  let message: string;

  switch (answer.kind) {
    case "same":
      remaining = { value: lot.remaining, unit: lot.unit };
      message = `Confermato: ${lot.productRef}, ${formatQuantity(remaining)}.`;
      break;
    case "finished":
      remaining = { value: 0, unit: lot.unit };
      message = `Segnato finito: ${lot.productRef}.`;
      break;
    case "fraction":
      remaining = fractionOfInitial(lot, answer.fraction);
      certainty = "estimated";
      message = `Aggiornato: ${lot.productRef}, ne resta circa ${formatQuantity(remaining)}.`;
      break;
    case "text": {
      const read = parseQuantityInUnit(answer.text, lot.unit);
      if (!read.ok) return read;
      if (read.quantity.value - lot.initial > EPSILON) {
        return { ok: false, error: `Non può essere più di quanto ce n'era all'inizio (${formatQuantity({ value: lot.initial, unit: lot.unit })}).` };
      }
      remaining = read.quantity;
      message = `Aggiornato: ${lot.productRef}, ne resta ${formatQuantity(remaining)}.`;
      break;
    }
  }

  const event: LedgerEvent = {
    id: (ctx.idGenerator ?? generateId)(),
    type: "adjust",
    at: ctx.now,
    recordedAt: ctx.now,
    deviceId: ctx.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty,
    source: "manual",
    lotId: lot.lotId,
    remaining,
  };
  if (validateEvent(event).length > 0) return { ok: false, error: "Non riesco a salvare questa risposta." };
  return { ok: true, events: [event], message };
}
