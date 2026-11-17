// Registri costruiti per i test della lista della spesa.
import { addDays } from "../expiry";
import { derivePantry, type Location, type LedgerEvent, type PantryState } from "../ledger";
import { consume, discard, gift, purchase, q } from "../ledger/test-helpers";

export { seededRandom, shuffled } from "../ledger/test-helpers";

export const BASE = "2026-01-01";
export const day = (n: number): string => addDays(BASE, n);
export const at = (n: number, hour = 10): string =>
  `${day(n)}T${String(hour).padStart(2, "0")}:00:00.000Z`;

export interface BuyOptions {
  price?: number;
  store?: string;
  barcode?: string;
  category?: string;
  /** Giorno (dal BASE) della scadenza in etichetta. */
  expiryDay?: number;
  location?: Location;
  hour?: number;
}

type Unit = "g" | "ml" | "pz";

/** Costruttore di registri: ogni metodo aggiunge un evento e restituisce il lotto. */
export function ledger() {
  let n = 0;
  let lots = 0;
  const events: LedgerEvent[] = [];
  const id = () => `e${String(++n).padStart(5, "0")}`;
  return {
    events,
    buy(dayN: number, product: string, value: number, unit: Unit, o: BuyOptions = {}): string {
      const lotId = `L${String(++lots).padStart(4, "0")}`;
      events.push(
        purchase(id(), at(dayN, o.hour), {
          lotId,
          productRef: product,
          quantity: q(value, unit),
          location: o.location ?? "dispensa",
          ...(o.price !== undefined ? { priceCents: o.price } : {}),
          ...(o.store !== undefined ? { store: o.store } : {}),
          ...(o.barcode !== undefined ? { barcode: o.barcode } : {}),
          ...(o.category !== undefined ? { category: o.category } : {}),
          ...(o.expiryDay !== undefined
            ? { expiry: { date: day(o.expiryDay), kind: "best_before" as const } }
            : {}),
        }),
      );
      return lotId;
    },
    use(dayN: number, lotId: string, value: number, unit: Unit) {
      events.push(consume(id(), at(dayN), { lotId, quantity: q(value, unit) }));
    },
    toss(
      dayN: number,
      lotId: string,
      value: number,
      unit: Unit,
      reason: "expired" | "leftover" | "disliked" | "other" = "expired",
    ) {
      events.push(discard(id(), at(dayN), { lotId, quantity: q(value, unit), reason }));
    },
    give(dayN: number, lotId: string, value: number, unit: Unit) {
      events.push(gift(id(), at(dayN), { lotId, quantity: q(value, unit) }));
    },
    pantry(): PantryState {
      return derivePantry(events);
    },
  };
}

/**
 * Latte: 4 lotti da 1000 ml comprati ogni 7 giorni (giorni 0, 7, 14, 21), 140 ml consumati
 * ogni giorno dal giorno 0 al 27 dal lotto della settimana. Al giorno 28 restano 80 ml.
 */
export function milkLedger() {
  const l = ledger();
  for (let w = 0; w < 4; w++) {
    const lot = l.buy(w * 7, "Latte", 1000, "ml", { price: 150 });
    for (let d = 0; d < 7; d++) l.use(w * 7 + d, lot, 140, "ml");
  }
  return l;
}
