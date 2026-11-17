// Costruttori di eventi per i test del modulo.
import type {
  AdjustEvent,
  ConsumeEvent,
  DeclareEvent,
  DiscardEvent,
  EventBase,
  GiftEvent,
  LedgerEvent,
  MoveEvent,
  OpenEvent,
  PurchaseEvent,
  Quantity,
  UpdateLotEvent,
  VoidEvent,
} from "./types";

type Fields<E extends LedgerEvent> = Omit<E, keyof EventBase | "type"> &
  Partial<EventBase>;

function make<E extends LedgerEvent>(
  type: E["type"],
  id: string,
  at: string,
  fields: Fields<E>,
): E {
  return {
    id,
    type,
    at,
    recordedAt: at,
    deviceId: "dev-a",
    schemaVersion: 1,
    certainty: "measured",
    source: "manual",
    ...fields,
  } as unknown as E;
}

export const q = (value: number, unit: Quantity["unit"] = "g"): Quantity => ({
  value,
  unit,
});

export const purchase = (id: string, at: string, f: Fields<PurchaseEvent>) =>
  make<PurchaseEvent>("purchase", id, at, f);
export const declare = (id: string, at: string, f: Fields<DeclareEvent>) =>
  make<DeclareEvent>("declare", id, at, f);
export const consume = (id: string, at: string, f: Fields<ConsumeEvent>) =>
  make<ConsumeEvent>("consume", id, at, f);
export const discard = (id: string, at: string, f: Fields<DiscardEvent>) =>
  make<DiscardEvent>("discard", id, at, f);
export const gift = (id: string, at: string, f: Fields<GiftEvent>) =>
  make<GiftEvent>("gift", id, at, f);
export const open = (id: string, at: string, f: Fields<OpenEvent>) =>
  make<OpenEvent>("open", id, at, f);
export const move = (id: string, at: string, f: Fields<MoveEvent>) =>
  make<MoveEvent>("move", id, at, f);
export const adjust = (id: string, at: string, f: Fields<AdjustEvent>) =>
  make<AdjustEvent>("adjust", id, at, f);
export const updateLot = (id: string, at: string, f: Fields<UpdateLotEvent>) =>
  make<UpdateLotEvent>("updateLot", id, at, f);
export const voidOf = (id: string, at: string, targetEventId: string, f: Partial<EventBase> = {}) =>
  make<VoidEvent>("void", id, at, { targetEventId, ...f });

/** PRNG deterministico (mulberry32) per i test con seme fisso. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
