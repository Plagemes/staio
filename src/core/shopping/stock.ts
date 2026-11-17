// Scorte minime: configurazione per prodotto e suggerimento ricavato dai consumi, da confermare.
import type { Certainty, PantryState, Unit } from "../ledger";
import {
  InvalidShoppingInputError,
  buildStreams,
  cmp,
  niceRound,
  normalizeName,
  streamId,
} from "./common";
import type { ConsumptionForecast } from "./consumption";

export interface StockMinimum {
  id: string;
  key: string;
  name: string;
  unit: Unit;
  /** Quantità minima da tenere, nell'unità base. */
  minimum: number;
}

export interface StockConfig {
  minimums: StockMinimum[];
}

export const emptyStockConfig = (): StockConfig => ({ minimums: [] });

const sortMinimums = (list: StockMinimum[]): StockMinimum[] =>
  list.sort((a, b) => cmp(a.key, b.key) || cmp(a.unit, b.unit));

/** Imposta (o sostituisce) la scorta minima di un prodotto. Non modifica la configurazione data. */
export function setMinimum(
  config: StockConfig,
  product: string,
  unit: Unit,
  minimum: number,
): StockConfig {
  const key = normalizeName(product);
  if (key === "") throw new InvalidShoppingInputError("setMinimum: nome prodotto vuoto");
  if (!Number.isFinite(minimum) || minimum <= 0) {
    throw new InvalidShoppingInputError("setMinimum: la quantità minima deve essere positiva");
  }
  const id = streamId(key, unit);
  const rest = config.minimums.filter((m) => m.id !== id);
  return {
    minimums: sortMinimums([...rest, { id, key, name: product.trim(), unit, minimum }]),
  };
}

export function removeMinimum(config: StockConfig, product: string, unit: Unit): StockConfig {
  const id = streamId(normalizeName(product), unit);
  return { minimums: config.minimums.filter((m) => m.id !== id) };
}

export interface MinimumSuggestion {
  id: string;
  key: string;
  name: string;
  unit: Unit;
  /** Mai nulla da applicare in silenzio: l'utente deve confermare. */
  needsConfirmation: true;
  certainty: Certainty;
  suggested: number;
  /** Con l'incertezza del ritmo: stessa riserva calcolata sul ritmo basso e su quello alto. */
  suggestedRange: { low: number; high: number };
  basis: { consumedPerDay: number; reserveDays: number; observations: number };
}

export interface MinimumSuggestionOptions {
  /** Giorni di riserva da tenere in casa. Default 3. */
  reserveDays?: number;
}

/** Scorta minima suggerita: i consumi di `reserveDays` giorni. `null` se lo storico non basta. */
export function suggestMinimum(
  forecast: ConsumptionForecast,
  options: MinimumSuggestionOptions = {},
): MinimumSuggestion | null {
  if (!forecast.sufficient) return null;
  const reserveDays = options.reserveDays ?? 3;
  const rate = forecast.consumed;
  if (!(rate.perDay > 0)) return null;
  const at = (perDay: number) => niceRound(perDay * reserveDays, forecast.unit, "up");
  return {
    id: forecast.id,
    key: forecast.key,
    name: forecast.name,
    unit: forecast.unit,
    needsConfirmation: true,
    certainty: "estimated",
    suggested: at(rate.perDay),
    suggestedRange: { low: at(rate.low), high: at(rate.high) },
    basis: {
      consumedPerDay: rate.perDay,
      reserveDays,
      observations: forecast.observations,
    },
  };
}

/** Suggerimenti per i prodotti con storico sufficiente e senza una scorta minima già impostata. */
export function suggestMinimums(
  forecasts: readonly ConsumptionForecast[],
  config: StockConfig,
  options: MinimumSuggestionOptions = {},
): MinimumSuggestion[] {
  const configured = new Set(config.minimums.map((m) => m.id));
  const out: MinimumSuggestion[] = [];
  for (const f of forecasts) {
    if (configured.has(f.id)) continue;
    const s = suggestMinimum(f, options);
    if (s) out.push(s);
  }
  return out.sort((a, b) => cmp(a.key, b.key) || cmp(a.unit, b.unit));
}

export interface BelowMinimum {
  id: string;
  key: string;
  name: string;
  unit: Unit;
  minimum: number;
  stock: number;
  missing: number;
}

/** Prodotti sotto la scorta minima (solo la quantità utilizzabile, nella stessa unità). */
export function belowMinimum(
  config: StockConfig,
  state: PantryState,
  today: string,
): BelowMinimum[] {
  const stock = new Map(buildStreams(state, today).map((s) => [s.id, s.stock]));
  const out: BelowMinimum[] = [];
  for (const m of config.minimums) {
    const have = stock.get(m.id) ?? 0;
    if (have < m.minimum) {
      out.push({
        id: m.id,
        key: m.key,
        name: m.name,
        unit: m.unit,
        minimum: m.minimum,
        stock: have,
        missing: Math.round((m.minimum - have) * 1e9) / 1e9,
      });
    }
  }
  return out.sort((a, b) => cmp(a.key, b.key) || cmp(a.unit, b.unit));
}
