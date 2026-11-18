// «Registra pasto»: una riga per prodotto (non per confezione), che cosa c'è nel piatto e come la quantità scelta si
// divide tra le confezioni. Logica pura: il registro lo scrive `buildMealEvents`, a cui arriva un `MealPick` per
// ogni confezione toccata.
import type { Location, Lot, Unit } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import type { QuantityValue } from "../common";
import { expiryTagView, type PantryEntry } from "../lots";
import type { MealPick } from "../meals";
import { normalizeSearch } from "../pantry/filter";
import { entryDate } from "../pantry/groups";
import { quantityOptions, type QuantityChoices } from "../pantry/quantityOptions";
import type { RememberedPortion } from "../portions";

const EPSILON = 1e-9;
const round9 = (n: number): number => Math.round(n * 1e9) / 1e9;

/** Le confezioni di uno stesso prodotto, nello stesso posto, viste come una riga sola. */
export interface ProductRow {
  /** Nome senza maiuscole né accenti, prodotto (codice o nome), posto e unità: «pasta|n|dispensa|g». */
  key: string;
  name: string;
  unit: Unit;
  location: Location;
  barcode?: string;
  /** Nell'ordine in cui si mangiano (`eatOrder`). */
  entries: PantryEntry[];
  /** Quanto ce n'è in tutto. */
  total: number;
  /**
   * Come distinguerla da un'altra riga con lo stesso nome: «in freezer», «codice …1234». Vuoto se il nome basta.
   * Lo riempie `productRows`.
   */
  tell: string;
}

/**
 * La chiave di una riga: la stessa identità di `groupEntries` della Dispensa (codice a barre, altrimenti nome; posto;
 * unità), senza però dividere la confezione aperta da quelle chiuse. Due prodotti con codici diversi, o lo stesso
 * prodotto in freezer e in frigo, sono righe diverse: ciò che si scala è ciò che si è mangiato.
 */
export function productKey(lot: Pick<Lot, "productRef" | "barcode" | "location" | "unit">): string {
  const name = normalizeSearch(lot.productRef).replace(/\|/g, " ");
  return `${name}|${lot.barcode ? `c:${lot.barcode}` : "n"}|${lot.location}|${lot.unit}`;
}

/** Il nome, senza maiuscole né accenti, dentro una chiave di riga. */
export const keyName = (key: string): string => key.slice(0, key.indexOf("|"));

const isOpened = (lot: Lot): boolean => lot.openedAt !== undefined || lot.remaining < lot.initial - EPSILON;
const intact = (lot: Lot): boolean => !isOpened(lot) && lot.remaining > 0;

/**
 * L'ordine in cui si mangiano le confezioni: quello di `evaluateLots` (la scadenza effettiva, che tiene già conto
 * dell'apertura); a parità di data, prima l'aperta. Vale per una riga e per ciò che prende un pasto abituale.
 */
export function eatOrder(entries: readonly PantryEntry[]): PantryEntry[] {
  return entries
    .map((entry, index) => ({ entry, index, date: entryDate(entry) ?? "9999-12-31" }))
    .sort((a, b) => a.date.localeCompare(b.date) || Number(isOpened(b.entry.lot)) - Number(isOpened(a.entry.lot)) || a.index - b.index)
    .map((x) => x.entry);
}

const IN_LOCATION: Record<Location, string> = { frigo: "in frigo", freezer: "in freezer", dispensa: "in dispensa" };

/**
 * Le righe della dispensa: una per prodotto e posto (`productKey`). Le righe stanno nell'ordine delle voci date (quello
 * di `evaluateLots`): una riga sta dove sta la sua prima confezione. Due righe con lo stesso nome si distinguono per il
 * posto o, nello stesso posto, per il codice.
 */
export function productRows(entries: readonly PantryEntry[]): ProductRow[] {
  const rows: ProductRow[] = [];
  const byKey = new Map<string, ProductRow>();
  for (const entry of entries) {
    const { lot } = entry;
    if (!(lot.remaining > 0)) continue;
    const key = productKey(lot);
    const found = byKey.get(key);
    if (found) {
      found.entries.push(entry);
      found.total = round9(found.total + lot.remaining);
    } else {
      const row: ProductRow = {
        key,
        name: lot.productRef,
        unit: lot.unit,
        location: lot.location,
        ...(lot.barcode ? { barcode: lot.barcode } : {}),
        entries: [entry],
        total: lot.remaining,
        tell: "",
      };
      byKey.set(key, row);
      rows.push(row);
    }
  }
  for (const row of rows) {
    row.entries = eatOrder(row.entries);
    const twins = rows.filter((r) => r !== row && keyName(r.key) === keyName(row.key));
    if (twins.length === 0) continue;
    const parts: string[] = [];
    if (twins.some((t) => t.location !== row.location)) parts.push(IN_LOCATION[row.location]);
    if (twins.some((t) => t.location === row.location)) parts.push(row.barcode ? `codice …${row.barcode.slice(-4)}` : "senza codice");
    row.tell = parts.join(" · ");
  }
  return rows;
}

/** La riga che parte da quella confezione (arrivando con `?lotto=`): si scala prima lei, poi le altre nell'ordine solito. */
export function startingFrom(row: ProductRow, lotId: string | undefined): ProductRow {
  const first = lotId ? row.entries.find((e) => e.lot.lotId === lotId) : undefined;
  if (!first || row.entries[0] === first) return row;
  return { ...row, entries: [first, ...row.entries.filter((e) => e !== first)] };
}

/** Più confezioni intatte e uguali: si propongono «1 confezione» e «Tutte (3)». */
function isUniformGroup(row: ProductRow): boolean {
  const lots = row.entries.map((e) => e.lot);
  return lots.length > 1 && lots.every((l) => intact(l) && Math.abs(l.initial - lots[0].initial) <= EPSILON);
}

/**
 * Le pastiglie di quantità di una riga e la scelta di partenza, con le regole della scheda dell'alimento
 * (`quantityOptions`): mai «Tutto», «Tutte» o «1 confezione» come partenza. Per confezioni diverse (una aperta e una
 * chiusa) le pastiglie guardano tutto ciò che c'è: «Il solito (80 g)» c'è anche se nella confezione aperta ne restano 50.
 */
export function rowChoices(row: ProductRow, usual?: RememberedPortion): QuantityChoices {
  const lots = row.entries.map((e) => e.lot);
  if (isUniformGroup(row)) return quantityOptions({ lot: lots[0], group: lots, usual });
  const lot = lots.length > 1 ? { ...lots[0], remaining: row.total } : lots[0];
  return quantityOptions({ lot, usual });
}

/** In piccolo sotto il nome: «150 g · ~4 giorni»; per un gruppo «3 confezioni da 170 g · la prima ~3 giorni». */
export function rowDetail(row: ProductRow): string {
  const first = row.entries[0];
  const count = row.entries.length;
  const unit = row.unit;
  const amount =
    count === 1
      ? formatQuantity({ value: first.lot.remaining, unit }, { estimated: first.lot.remainingCertainty === "estimated" })
      : isUniformGroup(row)
        ? `${count} confezioni da ${formatQuantity({ value: first.lot.initial, unit })}`
        : `${formatQuantity({ value: row.total, unit })} in ${count} confezioni`;
  const tag = expiryTagView(first);
  const when = tag ? `${tag.estimated ? "~" : ""}${tag.text}` : "";
  return [amount, ...(when ? [count === 1 ? when : `la prima ${when}`] : []), ...(row.tell ? [row.tell] : [])].join(" · ");
}

export interface SplitPart {
  lotId: string;
  value: number;
}

export type SplitResult =
  | { ok: true; picks: MealPick[]; parts: SplitPart[]; /** «50 g dalla confezione aperta, 30 g dalla seguente.»; vuoto se la confezione è una. */ text: string }
  | { ok: false; error: string };

const ORDINALS = ["prima", "seconda", "terza", "quarta", "quinta", "sesta"];

/** «50 g dalla confezione aperta, 30 g dalla seguente.» */
export function splitText(row: ProductRow, parts: readonly SplitPart[]): string {
  if (parts.length < 2) return "";
  const lotOf = (id: string) => row.entries.find((e) => e.lot.lotId === id)?.lot;
  const pieces = parts.map((part, index) => {
    const amount = formatQuantity({ value: part.value, unit: row.unit });
    if (index === 0) {
      const lot = lotOf(part.lotId);
      return `${amount} ${lot && isOpened(lot) ? "dalla confezione aperta" : "dalla prima confezione"}`;
    }
    if (parts.length === 2) return `${amount} dalla seguente`;
    return `${amount} dalla ${ORDINALS[index] ?? `confezione n. ${index + 1}`}`;
  });
  return `${pieces.join(", ")}.`;
}

/**
 * La quantità scelta per una riga, divisa tra le confezioni: si prende dalla prima (l'aperta, o quella che scade prima)
 * e il resto dalle seguenti. Un `MealPick` per ogni confezione toccata: `{ kind: "all" }` per quella che si finisce,
 * altrimenti il valore. Più di tutto ciò che c'è: errore, niente da scrivere.
 */
export function splitAmount(row: ProductRow, amount: QuantityValue): SplitResult {
  if (!(amount.value > 0)) return { ok: false, error: "Scrivi un numero maggiore di zero." };
  if (amount.value - row.total > EPSILON) {
    return { ok: false, error: `Ne restano ${formatQuantity({ value: row.total, unit: row.unit })} in tutto.` };
  }
  const picks: MealPick[] = [];
  const parts: SplitPart[] = [];
  let left = amount.value;
  for (const { lot } of row.entries) {
    if (left <= EPSILON) break;
    if (!(lot.remaining > 0)) continue;
    const finishes = lot.remaining - left <= EPSILON;
    const take = finishes ? lot.remaining : left;
    // una stima che finisce la confezione resta una stima: «all» la scriverebbe come misurata
    picks.push({ lot, choice: finishes && !amount.estimated ? { kind: "all" } : { kind: "value", value: take, estimated: amount.estimated } });
    parts.push({ lotId: lot.lotId, value: take });
    left = round9(left - take);
  }
  return { ok: true, picks, parts, text: splitText(row, parts) };
}

/** Una voce nel piatto, nell'ordine in cui è stata scelta. */
export type PlateItem =
  | {
      id: number;
      kind: "pantry";
      /** La riga (`ProductRow.key`). */
      key: string;
      /** La quantità scelta; assente finché non si tocca il selettore: vale quella proposta. `null`: nessuna scelta. */
      picked?: QuantityValue | null;
      /** La confezione da cui partire (arrivando con `?lotto=`): si scala prima lei. */
      firstLotId?: string;
    }
  | {
      id: number;
      kind: "free";
      name: string;
      quantityText: string;
      foodId?: string;
      /** «Nessuno di questi»: nessun alimento della tabella scelto. */
      none?: boolean;
    };

/** Il nome di una voce, senza maiuscole né accenti: due voci con lo stesso nome sono la stessa cosa. */
export const plateName = (item: PlateItem): string => (item.kind === "pantry" ? keyName(item.key) : normalizeSearch(item.name));

/** C'è già una voce con quel nome (della dispensa o libera)? */
export const onPlate = (plate: readonly PlateItem[], name: string): boolean => plate.some((i) => plateName(i) === normalizeSearch(name));

/**
 * Mette una riga della dispensa nel piatto; se c'è già, o c'è una voce libera con lo stesso nome, il piatto non cambia.
 * Due righe con lo stesso nome ma prodotto o posto diversi (il pollo in frigo e quello in freezer) possono starci entrambe.
 */
export function addPantryItem(
  plate: readonly PlateItem[],
  key: string,
  id: number,
  picked?: QuantityValue | null,
  firstLotId?: string,
): PlateItem[] {
  const name = keyName(key);
  if (plate.some((i) => (i.kind === "pantry" ? i.key === key : plateName(i) === name))) return [...plate];
  return [...plate, { id, kind: "pantry", key, ...(picked !== undefined ? { picked } : {}), ...(firstLotId ? { firstLotId } : {}) }];
}

/** Mette una voce libera nel piatto; un nome vuoto o già nel piatto non cambia niente. */
export function addFreeItem(plate: readonly PlateItem[], name: string, quantityText: string, id: number): PlateItem[] {
  const clean = name.trim().replace(/\s+/g, " ");
  if (clean === "" || onPlate(plate, clean)) return [...plate];
  return [...plate, { id, kind: "free", name: clean, quantityText }];
}

/**
 * La scelta di partenza per un alimento messo nel piatto con una quantità già nota («Di solito a cena»): la pastiglia
 * con lo stesso valore, se c'è; altrimenti il numero com'è, se non supera ciò che c'è; altrimenti quella proposta.
 */
export function pickedFor(row: ProductRow, choices: QuantityChoices, portion: RememberedPortion | undefined): QuantityValue | undefined {
  if (!portion || portion.unit !== row.unit || !(portion.value > 0)) return undefined;
  // tutto ciò che resta non parte mai già scelto, nemmeno se è la porzione di sempre: lo sceglie chi usa l'app
  if (portion.value >= row.total - EPSILON) return undefined;
  const same = choices.options.find((o) => Math.abs(o.value - portion.value) <= EPSILON);
  if (same?.id === "pack-one") return undefined;
  if (same) return { value: same.value, estimated: same.estimated ?? false, optionId: same.id };
  return { value: portion.value, estimated: portion.estimated === true };
}

/** «spinaci, pane»: i nomi delle voci senza quantità, per la riga sopra il pulsante. */
export function missingText(names: readonly string[]): string {
  return names.length === 0 ? "" : `Scegli quanto per: ${names.map((n) => n.toLowerCase()).join(", ")}.`;
}
