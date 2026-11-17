// Composizione della lista: voci con quantità proposta e RAGIONI per cui sono lì.
// Ogni voce è rifiutabile; i rifiuti sono una memoria passata come parametro e restituita aggiornata.
import { SHELF_LIFE, diffDays, type FoodCategory } from "../expiry";
import { isCalendarDate, type Certainty, type PantryState, type Unit } from "../ledger";
import type { Quantity as AnyQuantity } from "../units";
import {
  DEFAULT_TIME_ZONE,
  InvalidShoppingInputError,
  buildStreams,
  calendarDateOf,
  cmp,
  median,
  niceRound,
  normalizeName,
  round9,
  roundTo,
  streamId,
  streamMap,
  toBaseQuantity,
  type ShoppingLine,
  type Stream,
} from "./common";
import { forecastConsumption, isIdle, type ConsumptionOptions } from "./consumption";
import type { StockConfig } from "./stock";
import { wasteByProduct, type ProductWaste, type WasteOptions } from "./waste";

export type ReasonKind =
  | "manual"
  | "plan"
  | "below_minimum"
  | "running_out"
  | "completes_expiring";

const KIND_ORDER: readonly ReasonKind[] = [
  "manual",
  "plan",
  "below_minimum",
  "running_out",
  "completes_expiring",
];

/** Ragioni che, dopo rifiuti ripetuti, mandano la voce tra le sospese. Piano e manuale mai. */
const WEAK_KINDS: readonly ReasonKind[] = ["below_minimum", "running_out", "completes_expiring"];

export type ReasonDetail =
  | { kind: "manual" }
  | { kind: "plan"; needed: number; earliestDate: string }
  | { kind: "below_minimum"; minimum: number; stock: number }
  | { kind: "running_out"; daysLeft: number; runoutDate: string; certainty: Certainty }
  | { kind: "completes_expiring"; forProduct: string; expiresOn?: string };

export type ListReason = ReasonDetail & {
  /** Forza della ragione, 0-1, già ridotta dai rifiuti passati. */
  strength: number;
  /** Peso dei rifiuti passati di questa proposta (decade nel tempo). */
  rejections: number;
};

export type ItemNote =
  | { code: "shelf_life_cap"; days: number }
  | { code: "waste_caution"; wasteShare: number }
  | { code: "format_too_big"; size: number; suggestedMaxSize: number | null }
  | { code: "pack_exceeds_shelf_life"; packSize: number }
  | { code: "consumption_unknown" };

export interface ListItem extends ShoppingLine {
  /** Quantità proposta, nell'unità base. */
  quantity: number;
  /**
   * Il minimo che serve ancora a soddisfare la ragione più esigente, senza scorta di sicurezza:
   * il tetto di spesa può ridurre fino a qui. Zero: la voce non ha urgenza immediata.
   */
  essentialQuantity: number;
  reasons: ListReason[];
  /** 0-1: la ragione più forte, con un piccolo contributo di quelle concorrenti. */
  priority: number;
  /** Quantità già in dispensa (utilizzabile), nella stessa unità. */
  stock: number;
  /** Scorte dello stesso prodotto in altre unità: nessuna conversione senza densità. */
  stockInOtherUnits: Array<{ unit: Unit; quantity: number }>;
  /** Dimensione abituale della confezione acquistata, se nota. */
  packSize?: number;
  notes: ItemNote[];
}

export interface PlanNeed {
  product: string;
  quantity: AnyQuantity;
  /** Giorno in cui serve, `YYYY-MM-DD`. */
  date: string;
}

export interface ManualEntry {
  product: string;
  quantity: AnyQuantity;
}

/** Un ingrediente che completa un alimento che sta per scadere. */
export interface ExpiringPair {
  ingredient: string;
  forProduct: string;
  expiresOn?: string;
  /** Se assente si usa la confezione abituale dell'ingrediente. */
  quantity?: AnyQuantity;
}

export interface RejectionEntry {
  id: string;
  key: string;
  unit: Unit;
  kind: ReasonKind;
  /** Date dei rifiuti, `YYYY-MM-DD`. */
  dates: string[];
}

export interface RejectionMemory {
  entries: RejectionEntry[];
}

export const emptyRejections = (): RejectionMemory => ({ entries: [] });

export function rejectionWeight(
  memory: RejectionMemory,
  id: string,
  kind: ReasonKind,
  today: string,
  halfLifeDays = 60,
): number {
  const e = memory.entries.find((x) => x.id === id && x.kind === kind);
  if (!e) return 0;
  let w = 0;
  for (const d of e.dates) {
    const age = Math.max(0, diffDays(today, d));
    w += 0.5 ** (age / halfLifeDays);
  }
  return w;
}

/**
 * Registra il rifiuto di una voce: una traccia per ciascuna delle sue ragioni, tranne `manual`
 * (una voce aggiunta a mano si toglie dall'elenco manuale, non si "impara" a non proporla).
 * Restituisce una nuova memoria.
 */
export function rejectItem(
  memory: RejectionMemory,
  item: Pick<ListItem, "id" | "key" | "unit" | "reasons">,
  on: string,
): RejectionMemory {
  if (!isCalendarDate(on)) throw new InvalidShoppingInputError("rejectItem: data non valida");
  const entries = memory.entries.map((e) => ({ ...e, dates: [...e.dates] }));
  for (const reason of item.reasons) {
    if (reason.kind === "manual") continue;
    let e = entries.find((x) => x.id === item.id && x.kind === reason.kind);
    if (!e) {
      e = { id: item.id, key: item.key, unit: item.unit, kind: reason.kind, dates: [] };
      entries.push(e);
    }
    e.dates.push(on);
    e.dates.sort();
  }
  entries.sort((a, b) => cmp(a.id, b.id) || cmp(a.kind, b.kind));
  return { entries };
}

export type ListIssueCode =
  | "invalid_quantity"
  | "invalid_date"
  | "invalid_product"
  | "plan_in_past"
  | "quantity_unknown";

export interface ListIssue {
  code: ListIssueCode;
  source: "plan" | "manual" | "pair";
  product: string;
}

export interface ShoppingList {
  today: string;
  /** Ordinate per priorità decrescente. */
  items: ListItem[];
  /** Voci sospese per rifiuti ripetuti: restano visibili, mai scartate in silenzio. */
  suppressed: ListItem[];
  issues: ListIssue[];
}

export interface ListInput {
  /** Oggi, `YYYY-MM-DD`. */
  today: string;
  pantry: PantryState;
  stock?: StockConfig;
  planNeeds?: readonly PlanNeed[];
  manual?: readonly ManualEntry[];
  pairs?: readonly ExpiringPair[];
  rejections?: RejectionMemory;
}

export interface ListOptions {
  /** Per quanti giorni deve bastare ciò che si compra. Default 7. */
  horizonDays?: number;
  /** Giorni di copertura del minimo indispensabile. Default 3. */
  essentialDays?: number;
  /** Prodotto finito e fermo da più di tanti giorni: non è "in esaurimento". Default 21. */
  idleDays?: number;
  /** Ignora i fabbisogni del piano oltre questa data. */
  planUntil?: string;
  /** Sotto questa priorità una voce con sole ragioni deboli è sospesa. Default 0.25. */
  suppressBelow?: number;
  rejectionHalfLifeDays?: number;
  /** Quota di spreco da cui si arrotonda al più vicino invece che per eccesso. Default 0.2. */
  wasteCautionShare?: number;
  consumption?: ConsumptionOptions;
  waste?: WasteOptions;
  timeZone?: string;
}

interface Candidate {
  id: string;
  key: string;
  unit: Unit;
  name: string;
  reasons: ReasonDetail[];
  /** Fabbisogno da ritmo di consumo (da arrotondare a confezione). */
  rateNeed: number;
  minNeed: number;
  planNeed: number;
  manualQty: number;
  pairQty: number;
  essentialRate: number;
  consumedPerDay: number;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

function baseStrength(r: ReasonDetail, today: string, horizon: number): number {
  switch (r.kind) {
    case "manual":
      return 1;
    case "plan":
      return 0.85 + (diffDays(r.earliestDate, today) <= 2 ? 0.1 : 0);
    case "below_minimum":
      return 0.7;
    case "running_out":
      return 0.5 + 0.3 * clamp01(1 - r.daysLeft / horizon);
    case "completes_expiring":
      return 0.45 + (r.expiresOn !== undefined && diffDays(r.expiresOn, today) <= 2 ? 0.1 : 0);
  }
}

/** Durata dell'alimento in giorni: mediana osservata sui lotti con scadenza, altrimenti categoria. */
function shelfLifeDays(stream: Stream, timeZone: string): number | undefined {
  const observed: number[] = [];
  for (const lot of stream.lots) {
    if (!lot.expiry) continue;
    const days = diffDays(lot.expiry.date, calendarDateOf(lot.createdAt, timeZone));
    if (days > 0) observed.push(days);
  }
  const m = median(observed);
  if (m !== undefined) return m;
  const last = stream.lots[stream.lots.length - 1];
  if (last?.category && last.category in SHELF_LIFE && last.location !== "freezer") {
    const life = SHELF_LIFE[last.category as FoodCategory];
    const days = last.location === "frigo" ? life.fridgeDays : life.pantryDays;
    if (days > 0) return days;
  }
  return undefined;
}

interface Pack {
  size?: number;
  notes: ItemNote[];
}

/** Confezione abituale (la più frequente, a parità la più recente), evitando i formati segnalati. */
function choosePack(stream: Stream | undefined, waste: ProductWaste | undefined): Pack {
  const notes: ItemNote[] = [];
  if (!stream) return { notes };
  const counts = new Map<number, { n: number; last: number }>();
  stream.lots.forEach((lot, i) => {
    if (lot.origin !== "purchase") return;
    const c = counts.get(lot.initial) ?? { n: 0, last: 0 };
    c.n += 1;
    c.last = i;
    counts.set(lot.initial, c);
  });
  const sizes = [...counts.entries()].sort(
    (a, b) => b[1].n - a[1].n || b[1].last - a[1].last || a[0] - b[0],
  );
  if (sizes.length === 0) return { notes };
  let size = sizes[0][0];
  const signal = waste?.formatSignals.find((s) => s.size === size);
  if (signal) {
    notes.push({
      code: "format_too_big",
      size,
      suggestedMaxSize: signal.suggestedMaxSize,
    });
    const flagged = new Set(waste?.formatSignals.map((s) => s.size));
    const smaller = [...counts.keys()]
      .filter((s) => s < size && !flagged.has(s))
      .sort((a, b) => b - a);
    if (smaller.length === 0) return { notes };
    size = smaller[0];
  }
  return { size, notes };
}

function emptyCandidate(id: string, key: string, unit: Unit, name: string): Candidate {
  return {
    id,
    key,
    unit,
    name,
    reasons: [],
    rateNeed: 0,
    minNeed: 0,
    planNeed: 0,
    manualQty: 0,
    pairQty: 0,
    essentialRate: 0,
    consumedPerDay: 0,
  };
}

/**
 * Compone la lista della spesa. Le ragioni non si sommano: i fabbisogni si sovrappongono (il
 * piano è già consumo), quindi la quantità è il più grande tra quelli che scattano, e la parte
 * da ritmo o scorta minima è portata a confezioni intere salvo cautele (spreco, durata).
 */
export function composeList(input: ListInput, options: ListOptions = {}): ShoppingList {
  const { today, pantry } = input;
  if (!isCalendarDate(today)) {
    throw new InvalidShoppingInputError("composeList: today deve essere YYYY-MM-DD");
  }
  const horizon = options.horizonDays ?? 7;
  const essentialDays = options.essentialDays ?? 3;
  const idleDays = options.idleDays ?? 21;
  const suppressBelow = options.suppressBelow ?? 0.25;
  const halfLife = options.rejectionHalfLifeDays ?? 60;
  const cautionShare = options.wasteCautionShare ?? 0.2;
  const timeZone = options.timeZone ?? DEFAULT_TIME_ZONE;
  const memory = input.rejections ?? emptyRejections();

  const streams = buildStreams(pantry, today);
  const byId = streamMap(streams);
  const forecasts = new Map(
    forecastConsumption(pantry, today, { timeZone, ...options.consumption }).map((f) => [f.id, f]),
  );
  const wastes = new Map(wasteByProduct(pantry, today, options.waste).map((w) => [w.id, w]));
  const issues: ListIssue[] = [];
  const cands = new Map<string, Candidate>();
  const cand = (key: string, unit: Unit, name: string): Candidate => {
    const id = streamId(key, unit);
    let c = cands.get(id);
    if (!c) {
      c = emptyCandidate(id, key, unit, byId.get(id)?.name ?? name);
      cands.set(id, c);
    }
    return c;
  };
  const stockOf = (id: string) => byId.get(id)?.stock ?? 0;

  // 1. In esaurimento secondo i consumi.
  for (const stream of streams) {
    const f = forecasts.get(stream.id);
    if (!f || !f.sufficient || isIdle(f, today, idleDays)) continue;
    if (!(f.daysLeft < horizon)) continue;
    const life = shelfLifeDays(stream, timeZone);
    const coverage = life !== undefined ? Math.min(horizon, life) : horizon;
    const need = f.consumed.perDay * coverage - stream.stock;
    if (!(need > 0)) continue;
    const c = cand(stream.key, stream.unit, stream.name);
    c.reasons.push({
      kind: "running_out",
      daysLeft: f.daysLeft,
      runoutDate: f.runoutDate,
      certainty: "estimated",
    });
    c.rateNeed = need;
    c.consumedPerDay = f.consumed.perDay;
    c.essentialRate = Math.max(
      0,
      f.consumed.perDay * Math.min(essentialDays, coverage) - stream.stock,
    );
  }

  // 2. Sotto la scorta minima.
  for (const m of input.stock?.minimums ?? []) {
    const have = stockOf(m.id);
    if (!(have < m.minimum)) continue;
    const c = cand(m.key, m.unit, m.name);
    c.reasons.push({ kind: "below_minimum", minimum: m.minimum, stock: have });
    c.minNeed = round9(m.minimum - have);
  }

  // 3. Fabbisogni del piano (sommati per prodotto e unità).
  const plan = new Map<string, { name: string; key: string; unit: Unit; total: number; dates: string[] }>();
  for (const n of input.planNeeds ?? []) {
    const key = normalizeName(n.product);
    const q = toBaseQuantity(n.quantity);
    if (key === "") issues.push({ code: "invalid_product", source: "plan", product: n.product });
    else if (!q) issues.push({ code: "invalid_quantity", source: "plan", product: n.product });
    else if (!isCalendarDate(n.date)) issues.push({ code: "invalid_date", source: "plan", product: n.product });
    else if (n.date < today) issues.push({ code: "plan_in_past", source: "plan", product: n.product });
    else if (options.planUntil !== undefined && n.date > options.planUntil) continue;
    else {
      const id = streamId(key, q.unit);
      const p = plan.get(id) ?? { name: n.product.trim(), key, unit: q.unit, total: 0, dates: [] };
      p.total = round9(p.total + q.value);
      p.dates.push(n.date);
      plan.set(id, p);
    }
  }
  for (const [id, p] of plan) {
    const deficit = round9(p.total - stockOf(id));
    if (!(deficit > 0)) continue;
    const c = cand(p.key, p.unit, p.name);
    c.reasons.push({ kind: "plan", needed: p.total, earliestDate: [...p.dates].sort()[0] });
    c.planNeed = deficit;
  }

  // 4. Aggiunte a mano (sommate per prodotto e unità).
  const manual = new Map<string, { name: string; key: string; unit: Unit; total: number }>();
  for (const m of input.manual ?? []) {
    const key = normalizeName(m.product);
    const q = toBaseQuantity(m.quantity);
    if (key === "") issues.push({ code: "invalid_product", source: "manual", product: m.product });
    else if (!q) issues.push({ code: "invalid_quantity", source: "manual", product: m.product });
    else {
      const id = streamId(key, q.unit);
      const e = manual.get(id) ?? { name: m.product.trim(), key, unit: q.unit, total: 0 };
      e.total = round9(e.total + q.value);
      manual.set(id, e);
    }
  }
  for (const e of manual.values()) {
    const c = cand(e.key, e.unit, e.name);
    c.reasons.push({ kind: "manual" });
    c.manualQty = e.total;
  }

  // 5. Ingredienti che completano un alimento in scadenza.
  const pairs = new Map<
    string,
    { name: string; key: string; unit: Unit; total: number; forProduct: string; expiresOn?: string }
  >();
  const sortedPairs = [...(input.pairs ?? [])].sort(
    (a, b) =>
      cmp(normalizeName(a.ingredient), normalizeName(b.ingredient)) ||
      cmp(normalizeName(a.forProduct), normalizeName(b.forProduct)),
  );
  for (const p of sortedPairs) {
    const key = normalizeName(p.ingredient);
    if (key === "" || normalizeName(p.forProduct) === "") {
      issues.push({ code: "invalid_product", source: "pair", product: p.ingredient });
      continue;
    }
    let unit: Unit;
    let value: number;
    if (p.quantity !== undefined) {
      const q = toBaseQuantity(p.quantity);
      if (!q) {
        issues.push({ code: "invalid_quantity", source: "pair", product: p.ingredient });
        continue;
      }
      unit = q.unit;
      value = q.value;
    } else {
      // Senza quantità: la confezione abituale, se l'ingrediente è già stato comprato.
      const candidates = streams.filter((s) => s.key === key);
      const withPack = candidates
        .map((s) => ({ s, pack: choosePack(s, wastes.get(s.id)).size }))
        .filter((x): x is { s: Stream; pack: number } => x.pack !== undefined);
      if (withPack.length === 0) {
        issues.push({ code: "quantity_unknown", source: "pair", product: p.ingredient });
        continue;
      }
      unit = withPack[withPack.length - 1].s.unit;
      value = withPack[withPack.length - 1].pack;
    }
    const id = streamId(key, unit);
    const e = pairs.get(id) ?? {
      name: p.ingredient.trim(),
      key,
      unit,
      total: 0,
      forProduct: p.forProduct.trim(),
      expiresOn: p.expiresOn,
    };
    e.total = round9(e.total + value);
    if (p.expiresOn !== undefined && (e.expiresOn === undefined || p.expiresOn < e.expiresOn)) {
      e.expiresOn = p.expiresOn;
    }
    pairs.set(id, e);
  }
  for (const [id, e] of pairs) {
    const deficit = round9(e.total - stockOf(id));
    if (!(deficit > 0)) continue;
    const c = cand(e.key, e.unit, e.name);
    c.reasons.push({
      kind: "completes_expiring",
      forProduct: e.forProduct,
      ...(e.expiresOn !== undefined ? { expiresOn: e.expiresOn } : {}),
    });
    c.pairQty = deficit;
  }

  // Quantità, priorità e note per ogni candidato.
  const built: ListItem[] = [];
  for (const c of [...cands.values()].sort((a, b) => cmp(a.id, b.id))) {
    const stream = byId.get(c.id);
    const waste = wastes.get(c.id);
    const notes: ItemNote[] = [];
    const pack = choosePack(stream, waste);
    notes.push(...pack.notes);
    const life = stream ? shelfLifeDays(stream, timeZone) : undefined;
    const cautious =
      waste !== undefined &&
      waste.shareReliable &&
      waste.wasteShare !== null &&
      waste.wasteShare >= cautionShare;
    if (cautious && waste?.wasteShare != null) {
      notes.push({ code: "waste_caution", wasteShare: waste.wasteShare });
    }
    const mode = cautious ? "nearest" : "up";

    const roundNeed = (need: number): number => {
      if (!(need > 0)) return 0;
      const useful = c.consumedPerDay > 0 && life !== undefined ? c.consumedPerDay * life : undefined;
      if (pack.size !== undefined) {
        if (useful !== undefined && pack.size > useful) {
          notes.push({ code: "pack_exceeds_shelf_life", packSize: pack.size });
        } else {
          const packs = need / pack.size;
          const n =
            mode === "up" ? Math.max(1, Math.ceil(packs - 0.05)) : Math.max(1, Math.round(packs));
          return round9(n * pack.size);
        }
      }
      return niceRound(need, c.unit, mode);
    };

    const hasRate = c.rateNeed > 0;
    if (hasRate && life !== undefined && life < horizon) notes.push({ code: "shelf_life_cap", days: life });
    const quantity = Math.max(roundNeed(c.rateNeed), roundNeed(c.minNeed), c.planNeed, c.manualQty, c.pairQty);
    const essential = Math.min(
      quantity,
      Math.max(c.essentialRate, c.minNeed, c.planNeed, c.manualQty, c.pairQty),
    );

    const reasons: ListReason[] = c.reasons
      .map((r) => {
        const w = r.kind === "manual" ? 0 : rejectionWeight(memory, c.id, r.kind, today, halfLife);
        return {
          ...r,
          strength: roundTo(baseStrength(r, today, horizon) * 0.5 ** w, 3),
          rejections: roundTo(w, 3),
        } as ListReason;
      })
      .sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
    const top = Math.max(...reasons.map((r) => r.strength));
    const priority = roundTo(Math.min(1, top + 0.05 * (reasons.length - 1)), 3);

    const other = streams
      .filter((s) => s.key === c.key && s.unit !== c.unit && s.stock > 0)
      .map((s) => ({ unit: s.unit, quantity: s.stock }));

    built.push({
      id: c.id,
      key: c.key,
      name: c.name,
      unit: c.unit,
      quantity,
      essentialQuantity: roundTo(essential, 3),
      reasons,
      priority,
      stock: stockOf(c.id),
      stockInOtherUnits: other,
      ...(pack.size !== undefined ? { packSize: pack.size } : {}),
      ...(stream?.barcode ? { barcode: stream.barcode } : {}),
      notes,
    });
  }

  const order = (a: ListItem, b: ListItem) =>
    b.priority - a.priority || cmp(a.key, b.key) || cmp(a.unit, b.unit);
  const items: ListItem[] = [];
  const suppressed: ListItem[] = [];
  for (const it of built) {
    const weakOnly = it.reasons.every((r) => WEAK_KINDS.includes(r.kind));
    (weakOnly && it.priority < suppressBelow ? suppressed : items).push(it);
  }
  items.sort(order);
  suppressed.sort(order);
  issues.sort((a, b) => cmp(a.source, b.source) || cmp(a.product, b.product) || cmp(a.code, b.code));
  return { today, items, suppressed, issues };
}
