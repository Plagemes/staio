// Rilevamento da foto di un luogo (frigo, freezer, credenza): elenco atteso dal registro, chiamata, differenze da confermare.
import {
  buildPantryScanRequest,
  diffScan,
  orderDifferences,
  parsePantryScan,
  suggestSecondPhoto,
  type AiImage,
  type AiUsage,
  type Difference,
  type ExpectedLot,
  type PantryScan,
  type ScanLocation,
  type SecondPhotoHint,
  type ZoneMap,
} from "@/core/ai";
import type { Lot } from "@/core/ledger";
import { callAi, type CallArgs } from "./call";
import type { ProviderId } from "./providers/types";
import type { SettingsStore } from "./settings";
import { loadZoneMap } from "./zonesStore";

export interface ScanTarget {
  expected: ExpectedLot[];
  /** Identificativo corto -> lotto vero. Il modello vede solo i primi. */
  lotsById: Map<string, Lot>;
}

/** L'elenco atteso: un identificativo corto (L1, L2…) per ogni lotto attivo. */
export function toExpectedLots(lots: readonly Lot[]): ScanTarget {
  const lotsById = new Map<string, Lot>();
  const expected = lots.map((lot, index): ExpectedLot => {
    const id = `L${index + 1}`;
    lotsById.set(id, lot);
    return {
      id,
      name: lot.productRef,
      remaining: { value: lot.remaining, unit: lot.unit },
      initial: lot.initial,
      opened: lot.openedAt !== undefined,
      ...(lot.category ? { category: lot.category } : {}),
      ...(lot.expiry ? { expiry: { date: lot.expiry.date, kind: lot.expiry.kind } } : {}),
    };
  });
  return { expected, lotsById };
}

export interface ScanArgs extends Omit<CallArgs, "request"> {
  /** Dove si scatta la foto. I lotti sono quelli attivi in quel luogo. */
  location: ScanLocation;
  lots: readonly Lot[];
  images: readonly AiImage[];
  /** Data di oggi `YYYY-MM-DD`. */
  today: string;
  /** Dove sta la mappa delle zone. */
  zoneStore: SettingsStore;
}

export interface ScanOutcome {
  target: ScanTarget;
  scan: PantryScan;
  differences: Difference[];
  second: SecondPhotoHint | null;
  zoneMap: ZoneMap;
  usage: AiUsage;
  usageEstimated: boolean;
  provider: ProviderId;
  model: string;
  cost: number | null;
  currency: string;
  truncated: boolean;
}

/** Lancia un `AiError` se la chiamata fallisce. Non scrive nulla nel registro. */
export async function scanPantry(args: ScanArgs): Promise<ScanOutcome> {
  const { location, lots, images, today, zoneStore, ...rest } = args;
  const target = toExpectedLots(lots);
  const request = buildPantryScanRequest({ location, expected: target.expected, images, today });
  const { response, provider, model, cost, currency, usage, usageEstimated } = await callAi({ ...rest, request });

  const scan = parsePantryScan(response.text, target.expected, { location, truncated: response.truncated });
  const zoneMap = await loadZoneMap(zoneStore);
  const differences = orderDifferences(diffScan(scan, target.expected, { location, today }), location, zoneMap);
  const second = suggestSecondPhoto(scan, target.expected, { location, zoneMap });
  return { target, scan, differences, second, zoneMap, usage, usageEstimated, provider, model, cost, currency, truncated: response.truncated };
}
