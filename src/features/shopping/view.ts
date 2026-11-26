// La lista della spesa pronta per la schermata: voci con le ragioni scritte, costi stimati solo dove c'è un prezzo
// osservato, confronto tra negozi, tetto di spesa e giorno consigliato. Logica pura.
import type { Lot, PantryState, Unit } from "@/core/ledger";
import {
  applyBudget,
  buildPriceBook,
  compareStores,
  composeList,
  estimateCost,
  findForecast,
  forecastConsumption,
  normalizeName,
  recommendShoppingDay,
  suggestMinimums,
  type BudgetAdjustment,
  type BudgetLine,
  type ConsumptionForecast,
  type CostEstimate,
  type ExpiringPair,
  type ListItem,
  type ListIssue,
  type MinimumSuggestion,
  type PlanNeed,
  type PriceBook,
  type RejectionMemory,
  type ShoppingDay,
  type StockConfig,
  type StoreComparison,
} from "@/core/shopping";
import { buildPriceHistories, type PriceHistoryResult } from "@/core/prices";
import { formatQuantity } from "@/core/units";
import { formatPrice } from "../format";
import { normalizeSearch } from "../pantry/filter";
import { dayHeading, whenText } from "../plan/dates";
import { isDismissed, manualIdsOf } from "./decisions";
import type { ManualItem } from "./manual";
import { priceNote } from "./priceText";
import { forecastNote, noteText, reasonText } from "./reasons";
import type { Decisions } from "./settings";

export interface ViewInput {
  today: string;
  pantry: PantryState;
  planNeeds: readonly PlanNeed[];
  manual: readonly ManualItem[];
  pairs: readonly ExpiringPair[];
  stock: StockConfig;
  rejections: RejectionMemory;
  decisions: Decisions;
  /** Tetto di spesa, in centesimi; `null` = nessun tetto. */
  budgetCents: number | null;
  /** Negozio scelto per le stime; assente = ultimo prezzo osservato ovunque. */
  store?: string;
}

export interface ViewItem {
  item: ListItem;
  id: string;
  name: string;
  unit: Unit;
  /** Quantità da comprare: quella scelta dall'utente, altrimenti la proposta. */
  quantity: number;
  proposedQuantity: number;
  changed: boolean;
  confirmed: boolean;
  isManual: boolean;
  manualIds: string[];
  reasons: string[];
  notes: string[];
  stockText: string;
  /** Dove lo storico non basta lo dice, invece di un numero. */
  forecastNote?: string;
  /** Costo stimato dall'ultimo prezzo osservato; `null` = nessun prezzo osservato. */
  costCents: number | null;
  /** Il conto dietro `costCents`: data, negozio e prezzo unitario dell'ultimo acquisto. Assente senza prezzo osservato. */
  estimate?: CostEstimate;
  costText: string;
  /** «L'ultima volta 1,89 €/l, di solito 1,75 €/l»: solo con almeno due acquisti con prezzo. */
  priceNote?: string;
}

/** Una voce da comprare senza quantità («q.b.»): c'è in lista, ma non si inventa un numero. */
export interface QuantitylessItem {
  id: string;
  name: string;
  manualIds: string[];
}

export interface ShoppingView {
  today: string;
  items: ViewItem[];
  /** Voci aggiunte a mano senza quantità: restano in lista e vanno in negozio. */
  noQuantity: QuantitylessItem[];
  suppressed: ViewItem[];
  /** Proposte tolte da poco (`DISMISS_DAYS` giorni): fuori da `items`, ma non nascoste. */
  dismissed: ViewItem[];
  issues: ListIssue[];
  book: PriceBook;
  histories: PriceHistoryResult;
  forecasts: ConsumptionForecast[];
  cost: { totalCents: number; pricedCount: number; unpricedCount: number; text: string };
  comparison: StoreComparison;
  budget?: { capCents: number; totalBeforeCents: number; totalAfterCents: number; adjustments: Array<BudgetAdjustment & { name: string; unit: Unit }>; unpricedCount: number };
  day: ShoppingDay;
  /** Frase sul giorno consigliato, sempre dichiarata come stima. */
  dayText: string;
  suggestions: MinimumSuggestion[];
}

/** Un alimento in casa con un nome vicino a quello della voce: ciò che si legge, mai ciò che si conta. */
export interface NearFood {
  name: string;
  value: number;
  unit: Unit;
}

/** Quanti alimenti vicini si nominano al massimo. */
const NEAR_FOODS_MAX = 2;

const wordsOf = (text: string): string[] => normalizeSearch(text).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Gli alimenti in casa il cui nome contiene, a parole intere, tutte le parole del nome della voce («Latte» trova «Latte
 * intero» e «Cioccolato al latte», non «Lattuga»). Quelli con lo stesso nome della voce sono già contati nella sua
 * scorta e non entrano. Al massimo due, in ordine di scadenza; dello stesso alimento si somma ciò che resta.
 */
export function nearFoods(pantry: PantryState, item: Pick<ListItem, "key" | "name">, today: string): NearFood[] {
  const wanted = wordsOf(item.name);
  if (wanted.length === 0) return [];
  const found = new Map<string, NearFood & { expiry: string }>();
  for (const lot of pantry.lots as readonly Lot[]) {
    if (lot.status !== "active" || !(lot.remaining > 0)) continue;
    if (lot.expiry && lot.expiry.kind === "use_by" && lot.expiry.date < today) continue;
    if (normalizeName(lot.productRef) === item.key) continue;
    const words = new Set(wordsOf(lot.productRef));
    if (!wanted.every((w) => words.has(w))) continue;
    const id = `${normalizeSearch(lot.productRef)}|${lot.unit}`;
    const expiry = lot.expiry?.date ?? "9999-12-31";
    const hit = found.get(id);
    if (hit) {
      hit.value = Math.round((hit.value + lot.remaining) * 1e9) / 1e9;
      if (expiry < hit.expiry) hit.expiry = expiry;
    } else found.set(id, { name: lot.productRef.trim(), value: lot.remaining, unit: lot.unit, expiry });
  }
  return [...found.values()]
    .sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : a.name.localeCompare(b.name)))
    .slice(0, NEAR_FOODS_MAX)
    .map(({ name, value, unit }) => ({ name, value, unit }));
}

/** Senza scorta esatta ma con alimenti dal nome vicino lo dice; sono solo parole: la quantità da comprare non cambia. */
function stockTextOf(item: ListItem, near: readonly NearFood[] = []): string {
  const parts: string[] = [];
  if (item.stock > 0) parts.push(`In casa: ${formatQuantity({ value: item.stock, unit: item.unit })}`);
  else if (near.length > 0) {
    const list = near.map((n) => `${n.name.toLowerCase()}, ${formatQuantity({ value: n.value, unit: n.unit })}`).join("; ");
    parts.push(`In casa hai: ${list}`);
  } else parts.push("Non ne hai in casa");
  for (const o of item.stockInOtherUnits) parts.push(`${formatQuantity({ value: o.quantity, unit: o.unit })} in un'altra unità (non confrontabile)`);
  return parts.join(" · ");
}

export function costText(cents: number | null): string {
  return cents === null ? "nessun prezzo osservato" : `circa ${formatPrice(cents)}`;
}

export function buildShoppingView(input: ViewInput): ShoppingView {
  const { today, pantry } = input;
  const list = composeList({
    today,
    pantry,
    stock: input.stock,
    planNeeds: input.planNeeds,
    manual: input.manual.flatMap((m) => (m.quantity ? [{ product: m.product, quantity: m.quantity }] : [])),
    pairs: input.pairs,
    rejections: input.rejections,
  });
  const forecasts = forecastConsumption(pantry, today);
  const book = buildPriceBook(pantry);
  const histories = buildPriceHistories(pantry);
  const historyById = new Map(histories.products.map((h) => [h.id, h]));

  const toView = (item: ListItem): ViewItem => {
    const manualIds = manualIdsOf(input.manual, item.id, normalizeName);
    const chosen = input.decisions.quantities[item.id];
    const quantity = chosen !== undefined && chosen > 0 ? chosen : item.quantity;
    const isManual = item.reasons.some((r) => r.kind === "manual");
    const estimate = estimateCost(book, { key: item.key, barcode: item.barcode, unit: item.unit, ...(input.store ? { store: input.store } : {}) }, quantity);
    const hasRunningOut = item.reasons.some((r) => r.kind === "running_out");
    const history = historyById.get(item.id);
    const note = hasRunningOut ? undefined : forecastNote(findForecast(forecasts, item.key, item.unit));
    return {
      item,
      id: item.id,
      name: item.name,
      unit: item.unit,
      quantity,
      proposedQuantity: item.quantity,
      changed: quantity !== item.quantity,
      confirmed: isManual || input.decisions.confirmed[item.id] === true,
      isManual,
      manualIds,
      reasons: item.reasons.map((r) => reasonText(r, today, item.unit)),
      notes: item.notes.map((n) => noteText(n, item.unit)),
      stockText: stockTextOf(item, nearFoods(pantry, item, today)),
      ...(note ? { forecastNote: note } : {}),
      costCents: estimate ? estimate.cents : null,
      ...(estimate ? { estimate } : {}),
      costText: costText(estimate ? estimate.cents : null),
      ...(history ? { priceNote: priceNote(history) } : {}),
    };
  };

  const noQuantity: QuantitylessItem[] = [];
  for (const m of input.manual) {
    if (m.quantity) continue;
    const key = normalizeName(m.product);
    if (key === "") continue;
    const hit = noQuantity.find((n) => n.id === `${key}|qb`);
    if (hit) hit.manualIds.push(m.id);
    else noQuantity.push({ id: `${key}|qb`, name: m.product, manualIds: [m.id] });
  }

  const items = list.items.filter((i) => !isDismissed(input.decisions, i.id, today)).map(toView);
  const dismissed = list.items.filter((i) => isDismissed(input.decisions, i.id, today)).map(toView);
  const suppressed = list.suppressed.map(toView);

  const priced = items.filter((i) => i.costCents !== null);
  const totalCents = priced.reduce((s, i) => s + (i.costCents as number), 0);
  const unpricedCount = items.length - priced.length;
  const costSummary =
    items.length === 0
      ? ""
      : priced.length === 0
        ? "Nessuna voce ha un prezzo osservato: non posso stimare il costo."
        : `Costo stimato ${formatPrice(totalCents)} per ${priced.length} ${priced.length === 1 ? "voce" : "voci"} con un prezzo osservato${unpricedCount > 0 ? `; ${unpricedCount} ${unpricedCount === 1 ? "voce è senza prezzo e non è contata" : "voci sono senza prezzo e non sono contate"}` : ""}.`;

  const lines: Array<BudgetLine & { view: ViewItem }> = items.map((v) => ({
    id: v.id,
    key: v.item.key,
    name: v.name,
    unit: v.unit,
    quantity: v.quantity,
    ...(v.item.barcode ? { barcode: v.item.barcode } : {}),
    priority: v.item.priority,
    essentialQuantity: v.item.essentialQuantity,
    reasons: v.item.reasons,
    view: v,
  }));
  const comparison = compareStores(lines, book);

  let budget: ShoppingView["budget"];
  if (input.budgetCents !== null) {
    const r = applyBudget(lines, book, input.budgetCents, input.store ? { store: input.store } : {});
    const byId = new Map(items.map((v) => [v.id, v]));
    budget = {
      capCents: r.capCents,
      totalBeforeCents: r.totalBeforeCents,
      totalAfterCents: r.totalAfterCents,
      unpricedCount: r.unpricedItemIds.length,
      adjustments: r.adjustments.map((a) => ({ ...a, name: byId.get(a.itemId)?.name ?? a.itemId, unit: byId.get(a.itemId)?.unit ?? "pz" })),
    };
  }

  const day = recommendShoppingDay({ today, pantry, planNeeds: input.planNeeds });

  return {
    today,
    items,
    noQuantity,
    suppressed,
    dismissed,
    issues: list.issues,
    book,
    histories,
    forecasts,
    cost: { totalCents, pricedCount: priced.length, unpricedCount, text: costSummary },
    comparison,
    ...(budget ? { budget } : {}),
    day,
    dayText: dayText(day, today),
    suggestions: suggestMinimums(forecasts, input.stock),
  };
}

export function dayText(day: ShoppingDay, today: string): string {
  if (day.date === null) {
    return day.insufficientHistoryCount > 0
      ? `Non ho abbastanza storico per consigliarti un giorno: per ${day.insufficientHistoryCount} ${day.insufficientHistoryCount === 1 ? "prodotto" : "prodotti"} i consumi registrati sono troppo pochi.`
      : "Per ora non vedo un bisogno vicino: niente in esaurimento e nessun fabbisogno dal piano.";
  }
  const heading = dayHeading(day.date, today).replace(/, (oggi|domani)$/, "");
  const when = (d: string) => (d <= today ? "oggi" : whenText(d, today));
  const reasons: string[] = [];
  if (day.firstRunout) reasons.push(`${day.firstRunout.name} dovrebbe finire ${when(day.firstRunout.date)}.`);
  if (day.firstPlanShortfall) reasons.push(`Per il piano non basta ${day.firstPlanShortfall.name.toLowerCase()} ${when(day.firstPlanShortfall.date)}.`);
  return `Giorno consigliato (stima): ${day.date === today ? "oggi" : heading}. ${reasons.join(" ")}${day.weekdayAdjusted ? " Anticipato a un giorno in cui fai la spesa." : ""}`.trim();
}
