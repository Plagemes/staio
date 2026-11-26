// «Da cosa è fatto» per il valore della dispensa: dalle parti che `pantryValueParts` produce nello stesso ciclo del
// totale alle righe del foglio comune. Qui non si ricalcola niente: la somma delle righe è il totale.
import { worseCertainty, type Certainty, type Lot, type PantryValueParts } from "@/core/ledger";
import type { BreakdownRow, BreakdownSheetProps } from "../common/Breakdown";
import { dayOf, formatPrice } from "../format";
import { LOCATION_LABELS, LOCATION_ORDER } from "../labels";
import { shortDayText } from "../shopping/priceText";

export type BreakdownContent = Omit<BreakdownSheetProps, "onClose">;

/** Dove si apre la scheda di un lotto. */
export const lotHref = (lotId: string): string => `/app/dispensa?lotto=${encodeURIComponent(lotId)}`;

/** Quanto resta del lotto, in percentuale intera: 100 se è intero. */
function remainingPercent(lot: Lot): number {
  return Math.min(1, lot.remaining / lot.initial) * 100;
}

/** «Latte intero · resta il 40%»; senza «resta» se è intero. */
function partLabel(lot: Lot): string {
  const pct = remainingPercent(lot);
  if (Math.round(pct) >= 100) return lot.productRef;
  if (pct < 1) return `${lot.productRef} · resta meno dell'1%`;
  return `${lot.productRef} · resta il ${Math.round(pct)}%`;
}

const locationRank = (lot: Lot): number => LOCATION_ORDER.indexOf(lot.location);

/**
 * Il foglio del valore della dispensa. `now` è l'istante di adesso (per dire l'anno di un acquisto vecchio).
 * Le righe stanno nell'ordine dei luoghi e, dentro il luogo, dal più grande: il luogo si legge nel «hint»
 * perché il foglio comune ha un solo gruppo di righe che fanno la somma.
 */
export function pantryValueContent(parts: PantryValueParts, now: string): BreakdownContent {
  const today = dayOf(now);
  let total = 0;
  let certainty: Certainty = "measured";
  for (const p of parts.parts) {
    total += p.cents;
    certainty = worseCertainty(certainty, p.certainty);
  }
  const rows: BreakdownRow[] = [...parts.parts]
    .sort((a, b) => locationRank(a.lot) - locationRank(b.lot) || b.cents - a.cents || (a.lot.lotId < b.lot.lotId ? -1 : 1))
    .map((p) => {
      const paid = p.lot.priceCents === undefined ? undefined : formatPrice(p.lot.priceCents);
      const when = shortDayText(dayOf(p.lot.createdAt), today);
      return {
        id: p.lot.lotId,
        label: partLabel(p.lot),
        value: formatPrice(p.cents),
        certainty: p.certainty,
        hint: paid ? `${LOCATION_LABELS[p.lot.location]} · pagato ${paid} il ${when}` : LOCATION_LABELS[p.lot.location],
        href: lotHref(p.lot.lotId),
      };
    });

  // i lotti senza prezzo con lo stesso nome fanno una riga sola: «Uova (2)»
  const byName = new Map<string, { name: string; lots: Lot[] }>();
  for (const lot of parts.missing) {
    const key = lot.productRef.trim().toLowerCase();
    const hit = byName.get(key);
    if (hit) hit.lots.push(lot);
    else byName.set(key, { name: lot.productRef, lots: [lot] });
  }
  const missing: BreakdownRow[] = [...byName.entries()].map(([key, { name, lots }]) => ({
    id: `missing:${key}`,
    label: lots.length === 1 ? name : `${name} (${lots.length})`,
    value: "non conta",
    ...(lots.length === 1 ? { href: lotHref(lots[0].lotId) } : {}),
  }));

  return {
    title: "Valore della dispensa",
    total: formatPrice(total),
    ...(parts.missing.length > 0 ? { totalPrefix: "almeno" } : {}),
    totalCertainty: certainty,
    lead: "Tutta la dispensa, anche ciò che non vedi con i filtri. Per ogni alimento conta il prezzo pagato per la parte che resta.",
    rows,
    ...(missing.length > 0 ? { missingLabel: `Senza prezzo (${parts.missing.length})`, missing } : {}),
    ...(parts.missing.length > 0 ? { note: 'Gli alimenti segnati come "già in casa" non hanno un prezzo.' } : {}),
  };
}
