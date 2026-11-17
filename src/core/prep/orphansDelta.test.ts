import { describe, expect, it } from "vitest";
import { derivePantry, type IdGenerator } from "../ledger";
import { consume, purchase, q, voidOf } from "../ledger/test-helpers";
import { seededRandom, shuffled } from "../plan/test-helpers";
import { composePrep, derivePreps, proposePrepRepair, voidPrep } from "./index";

const COOK = "2026-03-10T17:00:00.000Z";

const ids = (prefix: string): IdGenerator => {
  let n = 0;
  return () => `${prefix}-${String(++n).padStart(3, "0")}`;
};

/** Riso da 500 g, 400 g usati per 4 porzioni; A annulla la preparazione. */
function scenario() {
  const pantry = [
    purchase("p1", "2026-03-01T08:00:00.000Z", {
      lotId: "rice",
      productRef: "Riso",
      quantity: q(500, "g"),
      location: "dispensa",
      priceCents: 250,
    }),
  ];
  const lot = derivePantry(pantry).lots[0];
  const r = composePrep(
    {
      prepId: "zuppa",
      title: "Riso",
      portions: 4,
      location: "frigo",
      ingredients: [{ lot, quantity: q(400, "g") }],
    },
    { deviceId: "dev-a", now: () => COOK, idGenerator: ids("c") },
  );
  if (!r.ok) throw new Error("compose");
  const synced = [...pantry, ...r.events];
  const v = voidPrep("zuppa", synced, { deviceId: "dev-a", now: () => "2026-03-11T09:00:00.000Z", idGenerator: ids("v") });
  if (!v.ok) throw new Error("void");
  const use = (id: string, hour: number) =>
    consume(id, `2026-03-11T${String(hour).padStart(2, "0")}:00:00.000Z`, {
      lotId: r.batchLotId,
      quantity: q(1, "pz"),
      mealId: `m-${id}`,
      deviceId: "dev-b",
    });
  return { synced, base: [...synced, ...v.events], use };
}

const rice = (events: unknown[]) => derivePantry(events).lots.find((l) => l.lotId === "rice")?.remaining;
const propose = (events: unknown[], deviceId = "dev-a", at = "2026-03-12T09:00:00.000Z") => {
  const r = proposePrepRepair("zuppa", events, { deviceId, now: () => at, idGenerator: ids(`vv-${deviceId}`) });
  if (!r.ok) throw new Error(`atteso ok, ottenuto ${r.reason}`);
  return r;
};
const codes = (events: unknown[]) => derivePreps(events).anomalies.map((a) => a.code);

describe("riparazione per differenza", () => {
  it("in sequenza: una seconda porzione dopo la riparazione è ancora segnalata e riparata", () => {
    const { base, use } = scenario();
    const s1 = [...base, use("b1", 8)];
    expect(rice(s1)).toBe(500);
    const r1 = propose(s1);
    expect(r1.events.map((e) => e.quantity.value)).toEqual([100]);
    const s2 = [...s1, ...r1.events];
    expect(rice(s2)).toBe(400);
    expect(codes(s2)).toEqual([]);

    // Poi B mangia una seconda porzione.
    const s3 = [...s2, use("b2", 9)];
    expect(codes(s3)).toEqual(["voided_prep_portions_used"]);
    const a = derivePreps(s3).anomalies[0].orphanUse!;
    expect([a.repairedEventIds, a.pendingEventIds, a.pendingPortions]).toEqual([["b1"], ["b2"], 1]);
    const r2 = propose(s3);
    // Solo la differenza, con un id diverso dal primo.
    expect(r2.events.map((e) => e.quantity.value)).toEqual([100]);
    expect(r2.events[0].id).not.toBe(r1.events[0].id);
    expect(r2).toMatchObject({ repairedPortions: 1, usedPortions: 2 });
    const s4 = [...s3, ...r2.events];
    expect(rice(s4)).toBe(300);
    expect(codes(s4)).toEqual([]);
    expect(proposePrepRepair("zuppa", s4, { deviceId: "dev-a" })).toEqual({ ok: false, reason: "nothing_to_repair" });
  });

  it("la proposta è stabile per qualunque permutazione degli eventi", () => {
    const { base, use } = scenario();
    const s1 = [...base, use("b1", 8)];
    const s3 = [...s1, ...propose(s1).events, use("b2", 9)];
    const expected = propose(s3);
    const expectedState = derivePreps(s3);
    for (let seed = 1; seed <= 25; seed++) {
      const mixed = shuffled([...s3, ...s3.slice(0, 6)], seededRandom(seed));
      expect(propose(mixed)).toEqual(expected);
      expect(derivePreps(mixed)).toEqual(expectedState);
    }
  });

  it("due dispositivi che riparano gli stessi usi producono lo stesso evento: si unisce in uno", () => {
    const { base, use } = scenario();
    const view = [...base, use("b1", 8), use("b2", 9)];
    const fromA = propose(view, "dev-a", "2026-03-12T09:00:00.000Z");
    const fromC = propose(view, "dev-c", "2026-03-12T10:00:00.000Z");
    expect(fromA.events[0].id).toBe(fromC.events[0].id);
    expect(fromA.events[0].quantity).toEqual(fromC.events[0].quantity);
    for (const order of [[...fromA.events, ...fromC.events], [...fromC.events, ...fromA.events]]) {
      const merged = [...view, ...order];
      expect(rice(merged)).toBe(300);
      expect(codes(merged)).toEqual([]);
    }
  });

  it("due dispositivi con viste diverse: usi diversi si sommano senza conflitto", () => {
    const { base, use } = scenario();
    const viewA = [...base, use("b1", 8)];
    const viewC = [...base, use("b2", 9)];
    const fromA = propose(viewA, "dev-a");
    const fromC = propose(viewC, "dev-c");
    expect(fromA.events[0].id).not.toBe(fromC.events[0].id);
    const all = [...base, use("b1", 8), use("b2", 9), ...fromA.events, ...fromC.events];
    for (const order of [all, shuffled(all, seededRandom(3)), [...all].reverse()]) {
      expect(rice(order)).toBe(300);
      expect(codes(order)).toEqual([]);
      expect(derivePreps(order).anomalies).toEqual([]);
    }
  });

  it("viste che si sovrappongono: l'uso è contato una volta, la riparazione doppia è segnalata e annullabile", () => {
    const { base, use } = scenario();
    const uses = [use("b1", 8), use("b2", 9)];
    const fromA = propose([...base, uses[0]], "dev-a"); // copre {b1}
    const fromC = propose([...base, ...uses], "dev-c"); // copre {b1, b2}
    const merged = [...base, ...uses, ...fromA.events, ...fromC.events];
    for (const order of [merged, [...merged].reverse(), shuffled(merged, seededRandom(9))]) {
      // La dispensa è scalata due volte (100 + 200), ma l'anomalia lo dice e l'uso non è contato due volte.
      expect(rice(order)).toBe(200);
      const state = derivePreps(order);
      expect(state.anomalies.map((a) => a.code)).toEqual(["prep_repair_overlap"]);
      const o = state.anomalies[0].orphanUse!;
      expect(o.redundantRepairEventIds).toEqual(fromA.events.map((e) => e.id));
      expect(o.pendingEventIds).toEqual([]);

      const fix = propose(order);
      expect(fix.events).toEqual([]);
      expect(fix.voids.map((v) => v.targetEventId)).toEqual(fromA.events.map((e) => e.id));
      const healed = [...order, ...fix.voids];
      expect(rice(healed)).toBe(300);
      expect(codes(healed)).toEqual([]);
    }
  });

  it("riparazioni che coprono in parte gli stessi usi: restano solo quelle disgiunte e il resto è da riparare", () => {
    const { base, use } = scenario();
    const uses = [use("b1", 8), use("b2", 9), use("b3", 10)];
    const first = propose([...base, uses[0], uses[1]], "dev-a"); // {b1,b2}
    const second = propose([...base, uses[1], uses[2]], "dev-c"); // {b2,b3}
    const all = [...base, ...uses, ...first.events, ...second.events];
    const state = derivePreps(all);
    // Tiene {b1,b2}; {b2,b3} è ridondante e b3 resta scoperto.
    expect(state.anomalies.map((a) => a.code)).toEqual(["prep_repair_overlap", "voided_prep_portions_used"]);
    const fix = propose(all);
    expect(fix.voids).toHaveLength(1);
    expect(fix.voids[0].targetEventId).toBe(second.events[0].id);
    expect(fix.events.map((e) => e.quantity.value)).toEqual([100]);
    expect(fix.repairedPortions).toBe(1);
    const done = [...all, ...fix.voids, ...fix.events];
    expect(codes(done)).toEqual([]);
    expect(rice(done)).toBe(200);
  });

  it("annullando una riparazione, i suoi usi tornano da riparare", () => {
    const { base, use } = scenario();
    const s = [...base, use("b1", 8)];
    const r = propose(s);
    const fixed = [...s, ...r.events];
    expect(codes(fixed)).toEqual([]);
    const undone = [...fixed, voidOf("undo", "2026-03-12T10:00:00.000Z", r.events[0].id)];
    expect(codes(undone)).toEqual(["voided_prep_portions_used"]);
    expect(rice(undone)).toBe(500);
    // Annullare l'annullamento la ripristina.
    const redone = [...undone, voidOf("redo", "2026-03-12T11:00:00.000Z", "undo")];
    expect(codes(redone)).toEqual([]);
    expect(rice(redone)).toBe(400);
  });

  it("permutazioni casuali dell'intero scenario danno lo stesso stato", () => {
    const { base, use } = scenario();
    const uses = [use("b1", 8), use("b2", 9), use("b3", 10)];
    const a = propose([...base, uses[0]], "dev-a");
    const c = propose([...base, uses[1], uses[2]], "dev-c");
    const all = [...base, ...uses, ...a.events, ...c.events];
    const expected = derivePreps(all);
    const expectedRice = rice(all);
    for (let seed = 1; seed <= 25; seed++) {
      const mixed = shuffled([...all, ...all.slice(0, 5)], seededRandom(seed));
      expect(derivePreps(mixed)).toEqual(expected);
      expect(rice(mixed)).toBe(expectedRice);
    }
    expect(expected.anomalies).toEqual([]);
    expect(expectedRice).toBe(200);
  });
});
