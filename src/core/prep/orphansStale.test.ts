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
  const eat = (id: string, hour: number) =>
    consume(id, `2026-03-11T${String(hour).padStart(2, "0")}:00:00.000Z`, {
      lotId: r.batchLotId,
      quantity: q(1, "pz"),
      mealId: `m-${id}`,
      deviceId: "dev-b",
    });
  return { base: [...synced, ...v.events], voids: v.events, eat };
}

const rice = (events: unknown[]) => derivePantry(events).lots.find((l) => l.lotId === "rice")?.remaining;
const propose = (events: unknown[], at = "2026-03-12T09:00:00.000Z") => {
  const r = proposePrepRepair("zuppa", events, { deviceId: "dev-a", now: () => at, idGenerator: ids("pv") });
  if (!r.ok) throw new Error(`atteso ok, ottenuto ${r.reason}`);
  return r;
};
const codes = (events: unknown[]) => derivePreps(events).anomalies.map((a) => a.code);
const permutations = (events: unknown[], check: (mixed: unknown[]) => void) => {
  for (let seed = 1; seed <= 20; seed++) check(shuffled([...events, ...events.slice(0, 4)], seededRandom(seed)));
};

describe("preparazione ripristinata dopo una riparazione", () => {
  function restored() {
    const { base, voids, eat } = scenario();
    const withUse = [...base, eat("b1", 8)];
    const repair = propose(withUse);
    const repaired = [...withUse, ...repair.events];
    const undo = voids.map((v, i) => voidOf(`undo-${i}`, "2026-03-12T10:00:00.000Z", v.id));
    return { repaired, repair, voids, all: [...repaired, ...undo] };
  }

  it("le riparazioni rimaste attive sono segnalate: l'ingrediente è scalato due volte", () => {
    const { repaired, repair, all } = restored();
    expect(rice(repaired)).toBe(400);
    expect(rice(all)).toBe(0); // 500 - 400 (consumo originale) - 100 (riparazione)
    expect(codes(all)).toEqual(["prep_repair_on_active_prep"]);
    const a = derivePreps(all).anomalies[0];
    expect(a).toMatchObject({ prepId: "zuppa", repairEventIds: repair.events.map((e) => e.id) });
    expect(derivePreps(all).preps).toHaveLength(1);
  });

  it("la proposta annulla le riparazioni e la dispensa torna giusta", () => {
    const { all } = restored();
    const fix = propose(all);
    expect(fix.events).toEqual([]);
    expect(fix.voids.map((v) => v.targetEventId)).toEqual(
      derivePreps(all).anomalies[0].repairEventIds,
    );
    const healed = [...all, ...fix.voids];
    expect(rice(healed)).toBe(100);
    expect(codes(healed)).toEqual([]);
    expect(proposePrepRepair("zuppa", healed, { deviceId: "dev-a" })).toEqual({
      ok: false,
      reason: "nothing_to_repair",
    });
  });

  it("per qualunque permutazione degli eventi", () => {
    const { all } = restored();
    const expected = derivePreps(all);
    const proposal = propose(all);
    permutations(all, (mixed) => {
      expect(derivePreps(mixed)).toEqual(expected);
      expect(propose(mixed)).toEqual(proposal);
      expect(rice(mixed)).toBe(0);
    });
  });

  it("ripristinata e poi annullata di nuovo: le riparazioni tornano valide", () => {
    const { all, voids } = restored();
    const again = [
      ...all,
      ...voids.map((v, i) => voidOf(`redo-${i}`, "2026-03-12T11:00:00.000Z", `undo-${i}`)),
    ];
    expect(codes(again)).toEqual([]);
    expect(rice(again)).toBe(400);
  });
});

describe("riparazione di un uso poi annullato", () => {
  it("riparazione parziale: copre due usi e uno è annullato", () => {
    const { base, eat } = scenario();
    const both = [...base, eat("b1", 8), eat("b2", 9)];
    const repair = propose(both);
    const repaired = [...both, ...repair.events];
    expect(rice(repaired)).toBe(300);
    const after = [...repaired, voidOf("undo-b2", "2026-03-12T10:00:00.000Z", "b2", { deviceId: "dev-b" })];
    // Solo b1 è stato davvero usato: il riso dovrebbe essere a 400, ma resta a 300.
    expect(rice(after)).toBe(300);
    expect(codes(after)).toEqual(["prep_repair_stale_use", "voided_prep_portions_used"]);
    const o = derivePreps(after).anomalies[0].orphanUse!;
    expect(o.staleRepairEventIds).toEqual(repair.events.map((e) => e.id));
    expect(o.pendingEventIds).toEqual(["b1"]);

    const fix = propose(after, "2026-03-12T11:00:00.000Z");
    expect(fix.voids.map((v) => v.targetEventId)).toEqual(repair.events.map((e) => e.id));
    expect(fix.events.map((e) => e.quantity.value)).toEqual([100]);
    expect(fix.events[0].repair.usedEventIds).toEqual(["b1"]);
    expect(fix.events[0].id).not.toBe(repair.events[0].id);
    const healed = [...after, ...fix.voids, ...fix.events];
    expect(rice(healed)).toBe(400);
    expect(codes(healed)).toEqual([]);
  });

  it("l'unico uso riparato è annullato: basta annullare la riparazione", () => {
    const { base, eat } = scenario();
    const one = [...base, eat("b1", 8)];
    const repair = propose(one);
    const after = [
      ...one,
      ...repair.events,
      voidOf("undo-b1", "2026-03-12T10:00:00.000Z", "b1", { deviceId: "dev-b" }),
    ];
    expect(rice(after)).toBe(400);
    expect(codes(after)).toEqual(["prep_repair_stale_use"]);
    const fix = propose(after);
    expect(fix.events).toEqual([]);
    expect(fix.voids).toHaveLength(1);
    const healed = [...after, ...fix.voids];
    expect(rice(healed)).toBe(500);
    expect(codes(healed)).toEqual([]);
  });

  it("per qualunque permutazione degli eventi", () => {
    const { base, eat } = scenario();
    const both = [...base, eat("b1", 8), eat("b2", 9)];
    const repair = propose(both);
    const after = [
      ...both,
      ...repair.events,
      voidOf("undo-b2", "2026-03-12T10:00:00.000Z", "b2", { deviceId: "dev-b" }),
    ];
    const expected = derivePreps(after);
    const proposal = propose(after);
    permutations(after, (mixed) => {
      expect(derivePreps(mixed)).toEqual(expected);
      expect(propose(mixed)).toEqual(proposal);
    });
  });

  it("annullare l'annullamento dell'uso ripristina la riparazione originale", () => {
    const { base, eat } = scenario();
    const both = [...base, eat("b1", 8), eat("b2", 9)];
    const repair = propose(both);
    const events = [
      ...both,
      ...repair.events,
      voidOf("undo-b2", "2026-03-12T10:00:00.000Z", "b2", { deviceId: "dev-b" }),
      voidOf("redo-b2", "2026-03-12T11:00:00.000Z", "undo-b2", { deviceId: "dev-b" }),
    ];
    expect(codes(events)).toEqual([]);
    expect(rice(events)).toBe(300);
  });

  it("una riparazione annullata a mano e riproposta ottiene un id nuovo, quindi vale", () => {
    const { base, eat } = scenario();
    const one = [...base, eat("b1", 8)];
    const first = propose(one);
    const undone = [...one, ...first.events, voidOf("undo-r", "2026-03-12T10:00:00.000Z", first.events[0].id)];
    expect(codes(undone)).toEqual(["voided_prep_portions_used"]);
    const second = propose(undone, "2026-03-12T11:00:00.000Z");
    expect(second.events[0].id).toBe(`${first.events[0].id}#1`);
    const healed = [...undone, ...second.events];
    expect(rice(healed)).toBe(400);
    expect(codes(healed)).toEqual([]);
    // Un terzo giro: generazione successiva.
    const again = [...healed, voidOf("undo-r2", "2026-03-12T12:00:00.000Z", second.events[0].id)];
    expect(propose(again).events[0].id).toBe(`${first.events[0].id}#2`);
  });
});
