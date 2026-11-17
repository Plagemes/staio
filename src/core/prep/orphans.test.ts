import { describe, expect, it } from "vitest";
import { derivePantry, type IdGenerator, type Lot } from "../ledger";
import { consume, discard, gift, purchase, q, voidOf } from "../ledger/test-helpers";
import { seededRandom, shuffled } from "../plan/test-helpers";
import {
  PREP_REPAIR_ID_PREFIX,
  composePrep,
  derivePreps,
  proposePrepRepair,
  voidPrep,
} from "./index";

const T0 = "2026-03-01T08:00:00.000Z";
const COOK = "2026-03-10T17:00:00.000Z";

const ids = (prefix = "id"): IdGenerator => {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(3, "0")}`;
};

function base() {
  return [
    purchase("p1", T0, { lotId: "rice", productRef: "Riso", quantity: q(500, "g"), location: "dispensa", priceCents: 250 }),
    purchase("p2", T0, { lotId: "milk", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo", priceCents: 199 }),
  ];
}

/** Il telefono A cucina; poi A annulla mentre B (non sincronizzato) usa porzioni. */
function twoDevices(uses: unknown[] = []) {
  const pantry = base();
  const lots: Record<string, Lot> = Object.fromEntries(derivePantry(pantry).lots.map((l) => [l.lotId, l]));
  const r = composePrep(
    {
      prepId: "zuppa",
      title: "Riso al latte",
      portions: 4,
      location: "frigo",
      ingredients: [
        { lot: lots.rice, quantity: q(200, "g") },
        { lot: lots.milk, quantity: q(250, "ml") },
      ],
    },
    { deviceId: "dev-a", now: () => COOK, idGenerator: ids() },
  );
  if (!r.ok) throw new Error("compose");
  const synced = [...pantry, ...r.events];
  const voided = voidPrep("zuppa", synced, { deviceId: "dev-a", now: () => "2026-03-11T09:00:00.000Z", idGenerator: ids("void") });
  if (!voided.ok) throw new Error("void");
  const lot = r.batchLotId;
  const bUses = uses.length > 0 ? uses : [
    consume("b1", "2026-03-11T08:30:00.000Z", { lotId: lot, quantity: q(1, "pz"), mealId: "m1", deviceId: "dev-b" }),
  ];
  return { r, lot, all: [...synced, ...voided.events, ...bUses], synced };
}

const NOW = { now: () => "2026-03-12T09:00:00.000Z" };

describe("porzioni usate dopo l'annullamento della preparazione (due dispositivi)", () => {
  it("la dispensa vede gli ingredienti tornati per intero e un lotto sconosciuto", () => {
    const { all } = twoDevices();
    const pantry = derivePantry(all);
    expect(pantry.lots.find((l) => l.lotId === "rice")?.remaining).toBe(500);
    expect(pantry.anomalies.map((a) => a.code)).toEqual(["unknown_lot"]);
  });

  it("derivePreps segnala voided_prep_portions_used con i dati", () => {
    const { r, all } = twoDevices();
    const state = derivePreps(all);
    expect(state.preps).toEqual([]);
    expect(state.voidedPrepIds).toEqual(["zuppa"]);
    expect(state.anomalies).toHaveLength(1);
    const a = state.anomalies[0];
    expect(a).toMatchObject({ code: "voided_prep_portions_used", prepId: "zuppa" });
    expect(a.orphanUse).toMatchObject({
      prepId: "zuppa",
      batchLotId: r.batchLotId,
      portions: 4,
      usedEventIds: ["b1"],
      consumed: 1,
      discarded: 0,
      gifted: 0,
      usedPortions: 1,
    });
    expect(a.orphanUse?.unrestoredIngredients.map((i) => i.lotId)).toEqual(["rice", "milk"]);
  });

  it("stesso risultato per qualunque permutazione degli eventi e con duplicati", () => {
    const { all } = twoDevices();
    const expected = derivePreps(all);
    for (let seed = 1; seed <= 20; seed++) {
      expect(derivePreps(shuffled([...all, ...all.slice(0, 5)], seededRandom(seed)))).toEqual(expected);
    }
  });

  it("senza usi dopo l'annullamento non c'è nessuna anomalia", () => {
    const { synced } = twoDevices();
    const voided = voidPrep("zuppa", synced, { deviceId: "dev-a", now: () => "2026-03-11T09:00:00.000Z" });
    if (!voided.ok) throw new Error("void");
    expect(derivePreps([...synced, ...voided.events]).anomalies).toEqual([]);
  });

  it("un uso a sua volta annullato non conta", () => {
    const { all } = twoDevices();
    const withUndo = [...all, voidOf("vb", "2026-03-11T10:00:00.000Z", "b1", { deviceId: "dev-b" })];
    expect(derivePreps(withUndo).anomalies).toEqual([]);
  });

  it("con force l'annullamento comprende gli usi già noti: nessuna anomalia", () => {
    const { r, synced } = twoDevices();
    const known = [...synced, consume("k1", "2026-03-11T08:30:00.000Z", { lotId: r.batchLotId, quantity: q(1, "pz") })];
    const voided = voidPrep("zuppa", known, { deviceId: "dev-a", force: true, now: () => "2026-03-11T09:00:00.000Z" });
    if (!voided.ok) throw new Error("void");
    expect(derivePreps([...known, ...voided.events]).anomalies).toEqual([]);
  });

  it("propone di riconsumare dagli ingredienti la quota delle porzioni usate, come stima", () => {
    const { all } = twoDevices();
    const res = proposePrepRepair("zuppa", all, { deviceId: "dev-a", ...NOW });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res).toMatchObject({ prepId: "zuppa", usedPortions: 1, portions: 4, fraction: 0.25, estimated: true, skipped: [] });
    expect(res.events.map((e) => [e.lotId, e.quantity.value, e.quantity.unit, e.certainty, e.source])).toEqual([
      ["rice", 50, "g", "estimated", "system"],
      ["milk", 62.5, "ml", "estimated", "system"],
    ]);
    // Id deterministici legati al consumo annullato; l'istante è quello della cottura.
    expect(res.events.every((e) => e.id.startsWith(PREP_REPAIR_ID_PREFIX) && e.at === COOK)).toBe(true);
    expect(res.events[0].note).toMatch(/stima/i);
    // Non scrive nulla da solo.
    expect(derivePantry(all).lots.find((l) => l.lotId === "rice")?.remaining).toBe(500);
  });

  it("scritta la riparazione, la dispensa torna vicina al vero e l'anomalia sparisce", () => {
    const { all } = twoDevices();
    const res = proposePrepRepair("zuppa", all, { deviceId: "dev-a", ...NOW });
    if (!res.ok) throw new Error("atteso ok");
    const fixed = [...all, ...res.events];
    const pantry = derivePantry(fixed);
    expect(pantry.lots.find((l) => l.lotId === "rice")?.remaining).toBe(450);
    expect(pantry.lots.find((l) => l.lotId === "milk")?.remaining).toBe(937.5);
    expect(derivePreps(fixed).anomalies).toEqual([]);
    expect(proposePrepRepair("zuppa", fixed, { deviceId: "dev-a", ...NOW })).toEqual({
      ok: false,
      reason: "nothing_to_repair",
    });
  });

  it("la riparazione è la stessa per qualunque permutazione e non si duplica se proposta da due dispositivi", () => {
    const { all } = twoDevices();
    const expected = proposePrepRepair("zuppa", all, { deviceId: "dev-a", ...NOW });
    for (let seed = 1; seed <= 15; seed++) {
      expect(proposePrepRepair("zuppa", shuffled(all, seededRandom(seed)), { deviceId: "dev-a", ...NOW })).toEqual(expected);
    }
    if (!expected.ok) throw new Error("atteso ok");
    const fromB = proposePrepRepair("zuppa", all, { deviceId: "dev-b", now: () => "2026-03-12T10:00:00.000Z" });
    if (!fromB.ok) throw new Error("atteso ok");
    // Stessi id: uniti restano uno solo, quindi la dispensa non scala due volte.
    const both = [...all, ...expected.events, ...fromB.events];
    expect(derivePantry(both).lots.find((l) => l.lotId === "rice")?.remaining).toBe(450);
  });

  it("conta anche scarti e regali; oltre le porzioni prodotte la quota è al massimo tutto", () => {
    const { r, synced } = twoDevices();
    const lot = r.batchLotId;
    const uses = [
      consume("b1", "2026-03-11T08:30:00.000Z", { lotId: lot, quantity: q(1, "pz"), deviceId: "dev-b" }),
      discard("b2", "2026-03-11T09:30:00.000Z", { lotId: lot, quantity: q(1, "pz"), reason: "leftover", deviceId: "dev-b" }),
      gift("b3", "2026-03-11T10:30:00.000Z", { lotId: lot, quantity: q(1, "pz"), deviceId: "dev-b" }),
    ];
    const voided = voidPrep("zuppa", synced, { deviceId: "dev-a", now: () => "2026-03-11T09:00:00.000Z" });
    if (!voided.ok) throw new Error("void");
    const all = [...synced, ...voided.events, ...uses];
    const a = derivePreps(all).anomalies[0].orphanUse!;
    expect([a.consumed, a.discarded, a.gifted, a.usedPortions]).toEqual([1, 1, 1, 3]);
    const res = proposePrepRepair("zuppa", all, { deviceId: "dev-a", ...NOW });
    if (!res.ok) throw new Error("atteso ok");
    expect(res.fraction).toBe(0.75);
    expect(res.events[0].quantity.value).toBe(150);

    const more = [...all, consume("b4", "2026-03-11T11:30:00.000Z", { lotId: lot, quantity: q(3, "pz"), deviceId: "dev-b" })];
    const over = proposePrepRepair("zuppa", more, { deviceId: "dev-a", ...NOW });
    if (!over.ok) throw new Error("atteso ok");
    expect(over.fraction).toBe(1);
    expect(over.events[0].quantity.value).toBe(200);
  });

  it("la quantità non dipende dalla dispensa: la mancanza è dichiarata a parte", () => {
    const { all } = twoDevices();
    const drained = [
      ...all,
      consume("c1", "2026-03-12T07:00:00.000Z", { lotId: "rice", quantity: q(480, "g") }),
      consume("c2", "2026-03-12T07:00:00.000Z", { lotId: "milk", quantity: q(1000, "ml") }),
    ];
    const res = proposePrepRepair("zuppa", drained, { deviceId: "dev-a", ...NOW });
    if (!res.ok) throw new Error("atteso ok");
    expect(res.events.map((e) => [e.lotId, e.quantity.value])).toEqual([["rice", 50], ["milk", 62.5]]);
    expect(res.shortfalls).toEqual([{ lotId: "rice", requested: 50, available: 20 }, { lotId: "milk", requested: 62.5, available: 0 }]);
  });

  it("preparazione sconosciuta o senza nulla da riparare", () => {
    const { synced } = twoDevices();
    expect(proposePrepRepair("boh", synced, { deviceId: "dev-a" })).toEqual({ ok: false, reason: "not_found" });
    expect(proposePrepRepair("zuppa", synced, { deviceId: "dev-a" })).toEqual({ ok: false, reason: "nothing_to_repair" });
  });
});
