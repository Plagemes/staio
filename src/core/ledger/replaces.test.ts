// `correct()` scrive `replaces`: una creazione sostitutiva rivendica solo i campi che cambiano.
import { describe, expect, it } from "vitest";
import { correct, correctLot, type ReplacementEvent } from "./correct";
import { derivePantry } from "./derive";
import { canonicalStringify, mergeEvents } from "./merge";
import {
  consume,
  purchase,
  q,
  seededRandom,
  shuffled,
  updateLot,
} from "./test-helpers";
import type { Expiry, LedgerEvent, PurchaseEvent } from "./types";
import { validateEvent } from "./validate";

const D = (day: number, h = 10) =>
  `2026-11-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

const withUseBy = (date: string): Expiry => ({ date, kind: "use_by" });

const ids = () => {
  let n = 0;
  return () => `g${String(++n).padStart(3, "0")}`;
};

function invariant(events: LedgerEvent[], seed = 31) {
  const expected = derivePantry(events);
  const random = seededRandom(seed);
  for (let i = 0; i < 20; i++) {
    expect(derivePantry(shuffled(events, random))).toEqual(expected);
  }
  return expected;
}

/** Sostituzione precompilata come farebbe un'interfaccia di modifica: copia dell'evento originale. */
const copyOf = (e: LedgerEvent, changes: Record<string, unknown> = {}): ReplacementEvent => {
  const { id: _id, recordedAt: _rec, replaces: _rep, ...rest } = e;
  void [_id, _rec, _rep];
  return { ...rest, ...changes } as ReplacementEvent;
};

const chicken = purchase("p1", D(1), {
  lotId: "L1",
  productRef: "pollo",
  quantity: q(800),
  priceCents: 500,
  store: "Coop",
  location: "frigo",
  expiry: withUseBy("2026-11-30"),
});
const shorten = updateLot("u1", D(2), { lotId: "L1", patch: { expiry: withUseBy("2026-11-08") } });

describe("correct() e il campo replaces", () => {
  it("scrive replaces con l'id dell'evento corretto ed è valido", () => {
    const [v, next] = correct(chicken, copyOf(chicken, { priceCents: 600 }), {
      now: () => D(10),
      idGenerator: ids(),
    });
    expect(next.replaces).toBe("p1");
    expect(validateEvent(v)).toEqual([]);
    expect(validateEvent(next)).toEqual([]);
  });

  it("replaces deve essere una stringa (vuota = assente)", () => {
    expect(validateEvent({ ...chicken, replaces: 5 }).map((e) => e.path)).toEqual(["replaces"]);
    expect(validateEvent({ ...chicken, replaces: "" })).toEqual([]);
  });
});

describe("1. i campi descrittivi non passano dalle creazioni sostitutive", () => {
  it("cambiare solo il prezzo con correctLot: solo un updateLot, la scadenza accorciata resta", () => {
    const events = correctLot(chicken, { priceCents: 600 }, { now: () => D(10), idGenerator: ids() });
    expect(events.map((e) => e.type)).toEqual(["updateLot"]);
    const state = invariant([chicken, shorten, ...events]);
    expect(state.lots[0]).toMatchObject({
      priceCents: 600,
      store: "Coop",
      productRef: "pollo",
      expiry: withUseBy("2026-11-08"),
    });
    expect(state.voidedEventIds).toEqual([]);
  });

  it("correct() con un prezzo diverso nella sostituzione lo ignora: i campi descrittivi non passano da lì", () => {
    const [v, next] = correct(chicken, copyOf(chicken, { priceCents: 600, store: "Altro" }), {
      now: () => D(10),
      idGenerator: ids(),
    });
    expect(next).toMatchObject({ priceCents: 500, store: "Coop" });
    const state = invariant([chicken, shorten, v, next]);
    expect(state.lots[0]).toMatchObject({
      priceCents: 500,
      store: "Coop",
      expiry: withUseBy("2026-11-08"),
    });
  });

  it("catena di due correzioni strutturali: la scadenza accorciata resta", () => {
    const gen = ids();
    const [v1, p2] = correctLot(chicken, { quantity: q(900) }, { now: () => D(10), idGenerator: gen }) as [
      LedgerEvent,
      PurchaseEvent,
    ];
    const [v2, p3] = correctLot(p2, { quantity: q(950) }, { now: () => D(11), idGenerator: gen });
    const state = invariant([chicken, shorten, v1, p2, v2, p3]);
    expect(state.anomalies).toEqual([]);
    expect(state.lots[0]).toMatchObject({
      initial: 950,
      priceCents: 500,
      expiry: withUseBy("2026-11-08"),
    });
  });

  it("una correzione che cambia davvero la scadenza (correctLot) prevale sull'updateLot precedente", () => {
    const events = correctLot(
      chicken,
      { expiry: withUseBy("2026-11-20") },
      { now: () => D(10), idGenerator: ids() },
    );
    expect(invariant([chicken, shorten, ...events]).lots[0].expiry).toEqual(withUseBy("2026-11-20"));
  });

  it("un updateLot registrato dopo la correzione prevale", () => {
    const [v, next] = correct(chicken, copyOf(chicken, { priceCents: 600 }), {
      now: () => D(10),
      idGenerator: ids(),
    });
    const later = updateLot("u2", D(1, 5), {
      lotId: "L1",
      recordedAt: D(12),
      patch: { expiry: withUseBy("2026-11-03"), priceCents: 450 },
    });
    expect(invariant([chicken, shorten, v, next, later]).lots[0]).toMatchObject({
      expiry: withUseBy("2026-11-03"),
      priceCents: 450,
    });
  });

  it("sostituita assente (non ancora sincronizzata): vale il timbro proprio, poi si sistema da solo", () => {
    const [v, next] = correct(chicken, copyOf(chicken, { priceCents: 600 }), {
      now: () => D(10),
      idGenerator: ids(),
    });
    // senza la creazione originale la sostitutiva rivendica tutti i campi che definisce
    const partial = invariant([shorten, next]);
    expect(partial.lots[0].expiry).toEqual(withUseBy("2026-11-30"));
    // quando l'originale (e il void) arrivano, l'updateLot torna a prevalere sulla scadenza
    const full = invariant([chicken, shorten, v, next]);
    expect(full.lots[0].expiry).toEqual(withUseBy("2026-11-08"));
    // anche con l'originale presente ma senza il void il lotto è duplicato, non cambia le scadenze
    expect(derivePantry([chicken, shorten, next]).anomalies).toEqual([
      { code: "duplicate_lot", eventId: "g002", lotId: "L1" },
    ]);
  });

  it("cicli di replaces (anche su sé stessi): nessun loop, valgono i timbri propri", () => {
    const a = { ...chicken, id: "a", replaces: "b", recordedAt: D(3) } as LedgerEvent;
    const b = {
      ...chicken,
      id: "b",
      lotId: "L2",
      replaces: "a",
      recordedAt: D(4),
      expiry: withUseBy("2026-12-01"),
    } as LedgerEvent;
    const self = { ...chicken, id: "s", lotId: "L3", replaces: "s", recordedAt: D(5) } as LedgerEvent;
    const upd = updateLot("u9", D(2), {
      lotId: "L1",
      recordedAt: D(3, 12),
      patch: { expiry: withUseBy("2026-11-09") },
    });
    const state = invariant([a, b, self, upd]);
    expect(state.anomalies).toEqual([]);
    expect(state.lots.map((l) => [l.lotId, l.expiry?.date])).toEqual([
      ["L1", "2026-11-09"], // a (D3) < upd (D3 12:00)
      ["L2", "2026-12-01"],
      ["L3", "2026-11-30"],
    ]);
  });

  it("replaces verso un evento che non è una creazione è ignorato", () => {
    const eat = consume("c1", D(2), { lotId: "L1", quantity: q(100) });
    const odd = { ...chicken, id: "p2", lotId: "L2", replaces: "c1" } as LedgerEvent;
    expect(invariant([chicken, eat, odd]).anomalies).toEqual([]);
  });
});

describe("2. Date e stringa ISO equivalente sono contenuti diversi", () => {
  const iso = "2026-11-02T10:00:00.000Z";
  const asDate = { ...consume("c1", D(2), { lotId: "L1", quantity: q(100) }), extra: new Date(iso) };
  const asString = { ...asDate, extra: iso };

  it("hanno chiavi canoniche diverse", () => {
    expect(canonicalStringify(asDate)).not.toBe(canonicalStringify(asString));
  });

  it("due copie con lo stesso id: stesso esito in entrambi gli ordini, conflitto segnalato", () => {
    const a = asDate as unknown as LedgerEvent;
    const b = asString as unknown as LedgerEvent;
    const ab = mergeEvents([a], [b]);
    const ba = mergeEvents([b], [a]);
    expect(ab.events).toEqual(ba.events);
    expect(ab.conflicts).toHaveLength(1);
    expect(derivePantry([chicken, a, b])).toEqual(derivePantry([chicken, b, a]));
    expect(derivePantry([chicken, a, b]).anomalies).toEqual([{ code: "id_conflict", eventId: "c1" }]);
  });
});
