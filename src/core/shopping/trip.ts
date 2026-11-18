// In negozio: stato della spesa in corso, ordine delle voci secondo le spese precedenti nel negozio,
// e riconciliazione finale con gli acquisti registrati.
import { isIsoInstant, type PantryState, type Unit } from "../ledger";
import {
  InvalidShoppingInputError,
  cmp,
  normalizeName,
  round9,
  type ShoppingLine,
} from "./common";

export interface TripItem extends ShoppingLine {
  /** Istante in cui la voce è stata spuntata. */
  checkedAt?: string;
}

export interface OffListEntry {
  id: string;
  name: string;
  key: string;
  quantity?: { value: number; unit: Unit };
  /** Prezzo totale in centesimi, se già noto. */
  priceCents?: number;
  addedAt: string;
}

export interface TripState {
  store: string | null;
  startedAt: string;
  endedAt?: string;
  items: TripItem[];
  offList: OffListEntry[];
  /**
   * Dopo la spesa: voce (o fuori lista) -> lotti scritti da «Metti in dispensa». Una voce con un lotto ancora presente
   * nella dispensa è già entrata, qualunque sia il tempo passato; annullato l'acquisto, il lotto sparisce e la voce torna.
   */
  putAway?: Record<string, string[]>;
}

function assertInstant(value: string, what: string): void {
  if (!isIsoInstant(value)) throw new InvalidShoppingInputError(`${what}: istante non valido`);
}

export function startTrip(
  lines: readonly ShoppingLine[],
  params: { store?: string | null; startedAt: string },
): TripState {
  assertInstant(params.startedAt, "startTrip");
  const items: TripItem[] = [...lines]
    .sort((a, b) => cmp(a.id, b.id))
    .map((l) => ({
      id: l.id,
      key: l.key,
      name: l.name,
      unit: l.unit,
      quantity: l.quantity,
      ...(l.barcode ? { barcode: l.barcode } : {}),
    }));
  const store = params.store?.trim() ? params.store.trim() : null;
  return { store, startedAt: params.startedAt, items, offList: [] };
}

const sameLine = (item: TripItem, line: ShoppingLine): boolean =>
  item.key === line.key &&
  item.name === line.name &&
  item.unit === line.unit &&
  item.quantity === line.quantity &&
  item.barcode === (line.barcode || undefined);

/**
 * La spesa in corso allineata alla lista di adesso. Le voci già spuntate restano sempre (anche se nel frattempo
 * sono uscite dalla lista); le voci nuove entrano, non spuntate; quelle non spuntate che non sono più in lista escono;
 * di una voce che resta si aggiornano nome e quantità. Una voce senza quantità che ne riceve una (o il contrario) cambia
 * identificativo nella lista: qui resta la stessa voce, con la sua spunta. Se non cambia niente restituisce lo stesso oggetto.
 */
export function syncTrip(trip: TripState, lines: readonly ShoppingLine[]): TripState {
  const byId = new Map<string, ShoppingLine>();
  for (const l of lines) if (!byId.has(l.id)) byId.set(l.id, l);
  const tripIds = new Set(trip.items.map((i) => i.id));
  // le voci nuove, nello stesso ordine che darebbe `startTrip`
  const fresh = [...byId.values()].filter((l) => !tripIds.has(l.id)).sort((a, b) => cmp(a.id, b.id));
  const claimed = new Set<string>();
  let changed = false;
  const items: TripItem[] = [];
  for (const item of trip.items) {
    const line = byId.get(item.id);
    if (!line) {
      const heir = fresh.find((l) => l.key === item.key && !claimed.has(l.id) && (l.quantity === 0) !== (item.quantity === 0));
      if (heir) {
        claimed.add(heir.id);
        changed = true;
        items.push({
          id: heir.id,
          key: heir.key,
          name: heir.name,
          unit: heir.unit,
          quantity: heir.quantity,
          ...(heir.barcode ? { barcode: heir.barcode } : {}),
          ...(item.checkedAt !== undefined ? { checkedAt: item.checkedAt } : {}),
        });
        continue;
      }
      if (item.checkedAt !== undefined) items.push(item);
      else changed = true;
      continue;
    }
    if (sameLine(item, line)) {
      items.push(item);
      continue;
    }
    changed = true;
    items.push({
      id: item.id,
      key: line.key,
      name: line.name,
      unit: line.unit,
      quantity: line.quantity,
      ...(line.barcode ? { barcode: line.barcode } : {}),
      ...(item.checkedAt !== undefined ? { checkedAt: item.checkedAt } : {}),
    });
  }
  for (const l of fresh) {
    if (claimed.has(l.id)) continue;
    changed = true;
    items.push({ id: l.id, key: l.key, name: l.name, unit: l.unit, quantity: l.quantity, ...(l.barcode ? { barcode: l.barcode } : {}) });
  }
  return changed ? { ...trip, items } : trip;
}

/** Spunta una voce (idempotente: una voce già spuntata mantiene il primo istante). */
export function checkItem(trip: TripState, itemId: string, at: string): TripState {
  assertInstant(at, "checkItem");
  return {
    ...trip,
    items: trip.items.map((i) =>
      i.id === itemId && i.checkedAt === undefined ? { ...i, checkedAt: at } : i,
    ),
  };
}

export function uncheckItem(trip: TripState, itemId: string): TripState {
  return {
    ...trip,
    items: trip.items.map((i) => {
      if (i.id !== itemId) return i;
      const { checkedAt: _removed, ...rest } = i;
      void _removed;
      return rest;
    }),
  };
}

export function addOffList(
  trip: TripState,
  entry: {
    id: string;
    name: string;
    quantity?: { value: number; unit: Unit };
    priceCents?: number;
    addedAt: string;
  },
): TripState {
  assertInstant(entry.addedAt, "addOffList");
  const key = normalizeName(entry.name);
  if (key === "") throw new InvalidShoppingInputError("addOffList: nome vuoto");
  if (trip.offList.some((o) => o.id === entry.id)) return trip;
  return {
    ...trip,
    offList: [...trip.offList, { ...entry, name: entry.name.trim(), key }].sort((a, b) =>
      cmp(a.addedAt + a.id, b.addedAt + b.id),
    ),
  };
}

export function tripProgress(trip: TripState): { total: number; checked: number; remaining: number } {
  const checked = trip.items.filter((i) => i.checkedAt !== undefined).length;
  return { total: trip.items.length, checked, remaining: trip.items.length - checked };
}

/** Traccia di una spesa conclusa: i prodotti nell'ordine in cui sono stati spuntati. */
export interface CompletedTrip {
  store: string | null;
  /** Istante di fine. */
  endedAt: string;
  /** Chiavi dei prodotti spuntati, nell'ordine di spunta. */
  order: string[];
}

export function finishTrip(
  trip: TripState,
  endedAt: string,
): { trip: TripState; record: CompletedTrip } {
  assertInstant(endedAt, "finishTrip");
  const order = trip.items
    .filter((i) => i.checkedAt !== undefined)
    .sort((a, b) => cmp(a.checkedAt as string, b.checkedAt as string) || cmp(a.id, b.id))
    .map((i) => i.key);
  return {
    trip: { ...trip, endedAt },
    record: { store: trip.store, endedAt, order: [...new Set(order)] },
  };
}

export interface OrderedItem<T extends ShoppingLine> {
  item: T;
  /** Posizione media (0 = prima, 1 = ultima) nelle spese precedenti; `null` se mai spuntata. */
  position: number | null;
  /** In quante spese precedenti nel negozio la voce era stata spuntata. */
  seenInTrips: number;
}

/**
 * Ordina le voci come l'utente le ha spuntate nelle spese precedenti nello stesso negozio
 * (posizione media normalizzata). Le voci mai spuntate vanno in fondo, in ordine alfabetico.
 * Con un negozio non indicato non c'è un ordine appreso: ordine alfabetico.
 */
export function orderForStore<T extends ShoppingLine>(
  lines: readonly T[],
  history: readonly CompletedTrip[],
  store: string | null,
): Array<OrderedItem<T>> {
  const storeKey = store === null ? null : normalizeName(store);
  const sums = new Map<string, { total: number; n: number }>();
  if (storeKey !== null && storeKey !== "") {
    for (const t of history) {
      if (t.store === null || normalizeName(t.store) !== storeKey) continue;
      const n = t.order.length;
      t.order.forEach((key, i) => {
        const pos = n === 1 ? 0.5 : i / (n - 1);
        const s = sums.get(key) ?? { total: 0, n: 0 };
        s.total += pos;
        s.n += 1;
        sums.set(key, s);
      });
    }
  }
  return lines
    .map((item) => {
      const s = sums.get(item.key);
      return {
        item,
        position: s ? round9(s.total / s.n) : null,
        seenInTrips: s?.n ?? 0,
      };
    })
    .sort((a, b) => {
      if (a.position !== null && b.position !== null) {
        return a.position - b.position || cmp(a.item.key, b.item.key) || cmp(a.item.id, b.item.id);
      }
      if (a.position !== null) return -1;
      if (b.position !== null) return 1;
      return cmp(a.item.key, b.item.key) || cmp(a.item.id, b.item.id);
    });
}

export interface ReconcileOptions {
  /** Ore prima dell'inizio in cui un acquisto registrato conta ancora. Default 2. */
  leadHours?: number;
  /** Ore dopo la fine (o l'inizio, se la spesa non è conclusa). Default 6. */
  tailHours?: number;
  /** Tolleranza sulla quantità comprata rispetto alla proposta. Default 0.05. */
  tolerance?: number;
}

export interface ReconciledItem {
  itemId: string;
  key: string;
  name: string;
  unit: Unit;
  listed: number;
  /** Comprato nella stessa unità. */
  purchased: number;
  /** Comprato in altre unità (non confrontabile con la quantità in lista). */
  purchasedOtherUnits: Array<{ unit: Unit; quantity: number }>;
  unitMismatch: boolean;
  /** Mancante: quanto è rimasto da comprare (solo se confrontabile). */
  shortBy: number;
  partial: boolean;
  /** Comprato in più rispetto alla lista. */
  excess: number;
  checked: boolean;
  spentCents: number;
  lotsWithoutPrice: number;
}

export interface ExtraPurchase {
  lotId: string;
  name: string;
  key: string;
  quantity: number;
  unit: Unit;
  costCents: number | null;
  /** Era stato aggiunto fuori lista durante la spesa. */
  declaredInTrip: boolean;
}

export interface Reconciliation {
  window: { from: string; to: string };
  purchasesConsidered: number;
  /** Comprato come da lista. */
  bought: ReconciledItem[];
  /** Mancante: non comprato, o comprato in parte. */
  missing: ReconciledItem[];
  /** Acquisti fuori lista. */
  extra: ExtraPurchase[];
  extraCostCents: number;
  extraUnpriced: number;
  listSpentCents: number;
  /** Spuntate in negozio ma senza acquisto registrato. */
  checkedNotRegistered: string[];
}

/**
 * Riconcilia la spesa con gli acquisti registrati nella finestra della spesa (e nel negozio, se
 * l'acquisto ne indica uno). Un acquisto si abbina alla voce con lo stesso prodotto e unità, o
 * con lo stesso codice a barre; con un'unità diversa la voce risulta comprata ma non confrontabile.
 */
export function reconcile(
  trip: TripState,
  pantry: PantryState,
  options: ReconcileOptions = {},
): Reconciliation {
  const lead = (options.leadHours ?? 2) * 3_600_000;
  const tail = (options.tailHours ?? 6) * 3_600_000;
  const tolerance = options.tolerance ?? 0.05;
  assertInstant(trip.startedAt, "reconcile");
  const from = Date.parse(trip.startedAt) - lead;
  const to = Date.parse(trip.endedAt ?? trip.startedAt) + tail;
  const storeKey = trip.store === null ? null : normalizeName(trip.store);

  const lots = pantry.lots.filter((lot) => {
    if (lot.origin !== "purchase") return false;
    const t = Date.parse(lot.createdAt);
    if (t < from || t > to) return false;
    if (storeKey !== null && lot.store) return normalizeName(lot.store) === storeKey;
    return true;
  });

  const items = [...trip.items].sort((a, b) => cmp(a.id, b.id));
  const assigned = new Map<string, typeof lots>();
  const extraLots: typeof lots = [];
  for (const lot of lots) {
    const key = normalizeName(lot.productRef);
    const rank = (i: TripItem): number => {
      const sameUnit = i.unit === lot.unit;
      if (i.key === key && sameUnit) return 0;
      if (i.barcode && lot.barcode === i.barcode && sameUnit) return 1;
      if (i.key === key) return 2;
      if (i.barcode && lot.barcode === i.barcode) return 3;
      return 99;
    };
    let best: TripItem | undefined;
    let bestRank = 99;
    for (const i of items) {
      const r = rank(i);
      if (r < bestRank) {
        best = i;
        bestRank = r;
      }
    }
    if (best) {
      const list = assigned.get(best.id) ?? [];
      list.push(lot);
      assigned.set(best.id, list);
    } else {
      extraLots.push(lot);
    }
  }

  const bought: ReconciledItem[] = [];
  const missing: ReconciledItem[] = [];
  let listSpent = 0;
  for (const i of items) {
    const mine = assigned.get(i.id) ?? [];
    let purchased = 0;
    let spent = 0;
    let unpriced = 0;
    const others = new Map<Unit, number>();
    for (const lot of mine) {
      if (lot.unit === i.unit) purchased = round9(purchased + lot.initial);
      else others.set(lot.unit, round9((others.get(lot.unit) ?? 0) + lot.initial));
      if (lot.priceCents === undefined) unpriced += 1;
      else spent += lot.priceCents;
    }
    listSpent += spent;
    const otherUnits = [...others.entries()]
      .sort((a, b) => cmp(a[0], b[0]))
      .map(([unit, quantity]) => ({ unit, quantity }));
    const covered = purchased >= i.quantity * (1 - tolerance);
    const unitMismatch = purchased === 0 && otherUnits.length > 0;
    const isBought = covered || unitMismatch;
    const row: ReconciledItem = {
      itemId: i.id,
      key: i.key,
      name: i.name,
      unit: i.unit,
      listed: i.quantity,
      purchased,
      purchasedOtherUnits: otherUnits,
      unitMismatch,
      shortBy: isBought ? 0 : round9(i.quantity - purchased),
      partial: !isBought && purchased > 0,
      excess: covered && purchased > i.quantity * (1 + tolerance) ? round9(purchased - i.quantity) : 0,
      checked: i.checkedAt !== undefined,
      spentCents: spent,
      lotsWithoutPrice: unpriced,
    };
    (isBought ? bought : missing).push(row);
  }

  const declared = new Set(trip.offList.map((o) => o.key));
  const extra: ExtraPurchase[] = extraLots.map((lot) => {
    const key = normalizeName(lot.productRef);
    return {
      lotId: lot.lotId,
      name: lot.productRef.trim(),
      key,
      quantity: lot.initial,
      unit: lot.unit,
      costCents: lot.priceCents ?? null,
      declaredInTrip: declared.has(key),
    };
  });
  extra.sort((a, b) => cmp(a.key, b.key) || cmp(a.lotId, b.lotId));

  return {
    window: { from: new Date(from).toISOString(), to: new Date(to).toISOString() },
    purchasesConsidered: lots.length,
    bought,
    missing,
    extra,
    extraCostCents: extra.reduce((s, e) => s + (e.costCents ?? 0), 0),
    extraUnpriced: extra.filter((e) => e.costCents === null).length,
    listSpentCents: listSpent,
    checkedNotRegistered: missing.filter((m) => m.checked && m.purchased === 0).map((m) => m.itemId),
  };
}
