import { describe, expect, it } from "vitest";
import { activeLots, derivePantry } from "@/core/ledger";
import { buildConsume, buildOpen } from "../actions";
import { buildCaptureEvents } from "../capture";
import { evaluateLots } from "../lots";
import { breakdownText, byNearestExpiry, expiryBreakdown, groupEntries, groupName } from "./groups";

const NOW = "2026-11-17T08:00:00.000Z";

function add(over: Record<string, unknown> = {}) {
  const r = buildCaptureEvents(
    {
      name: "Budino",
      quantityText: "125 g",
      location: "frigo",
      category: "yogurt",
      expiryKind: "best_before",
      expiryDate: "2026-11-28",
      priceText: "",
      alreadyHave: false,
      barcode: "8076800195057",
      ...over,
    },
    { now: NOW, deviceId: "d" },
  );
  if (!r.ok) throw new Error("setup");
  return r.events;
}

const entriesOf = (events: ReturnType<typeof add>) => evaluateLots(activeLots(derivePantry(events)), NOW);

describe("raggruppamento in Dispensa", () => {
  const events = [
    ...add({ expiryDate: "2026-11-28" }),
    ...add({ expiryDate: "2026-11-20" }),
    ...add({ expiryDate: "2026-11-28" }),
    ...add({ name: "Latte", quantityText: "1 l", barcode: undefined, category: "milk_fresh", expiryKind: "use_by", expiryDate: "2026-11-19" }),
  ];

  it("unisce i lotti uguali, anche con date diverse, e lascia soli gli altri", () => {
    const groups = groupEntries(entriesOf(events));
    expect(groups).toHaveLength(2);
    const budino = groups.find((g) => g.entries.length === 3)!;
    expect(groupName(budino)).toBe("Budino · 3 × 125 g");
    expect(groups.find((g) => g.entries.length === 1)!.entries[0].lot.productRef).toBe("Latte");
  });

  it("il dettaglio per scadenza parte dalla più vicina", () => {
    const budino = groupEntries(entriesOf(events)).find((g) => g.entries.length === 3)!;
    expect(expiryBreakdown(budino)).toEqual([
      { date: "2026-11-20", count: 1 },
      { date: "2026-11-28", count: 2 },
    ]);
    expect(breakdownText(budino)).toBe("1 entro il 20 nov 2026 · 2 entro il 28 nov 2026");
    // la prima confezione del gruppo è quella che scade prima
    expect(budino.entries[0].lot.expiry?.date).toBe("2026-11-20");
  });

  it("una data sola non produce dettaglio", () => {
    const same = groupEntries(entriesOf([...add(), ...add()]));
    expect(same).toHaveLength(1);
    expect(breakdownText(same[0])).toBe("");
  });

  it("una confezione aperta o iniziata esce dal gruppo", () => {
    const base = [...add(), ...add(), ...add()];
    const lots = derivePantry(base).lots;
    const ctx = { now: "2026-11-17T09:00:00.000Z", deviceId: "d" };
    const opened = buildOpen(lots[0], ctx);
    const eaten = buildConsume(lots[1], { kind: "half" }, ctx);
    if (!opened.ok || !eaten.ok) throw new Error("azione");
    const groups = groupEntries(entriesOf([...base, ...opened.events, ...eaten.events]));
    expect(groups).toHaveLength(3);
    expect(groups.filter((g) => g.entries.length > 1)).toHaveLength(0);
  });

  it("codici diversi o luoghi diversi non si uniscono", () => {
    expect(groupEntries(entriesOf([...add(), ...add({ barcode: "8000000000017" })]))).toHaveLength(2);
    expect(groupEntries(entriesOf([...add(), ...add({ location: "freezer" })]))).toHaveLength(2);
  });

  it("consumo dalla più vicina: l'ordine per scadenza mette prima quella che scade prima", () => {
    const budino = groupEntries(entriesOf(events)).find((g) => g.entries.length === 3)!;
    const shuffled = [budino.entries[2], budino.entries[0], budino.entries[1]];
    const nearest = byNearestExpiry(shuffled)[0];
    expect(nearest.lot.expiry?.date).toBe("2026-11-20");
    const ctx = { now: "2026-11-17T09:00:00.000Z", deviceId: "d" };
    const r = buildConsume(nearest.lot, { kind: "all" }, ctx);
    if (!r.ok) throw new Error(r.error);
    const left = derivePantry([...events, ...r.events]).lots.filter((l) => l.productRef === "Budino" && l.remaining > 0);
    expect(left.map((l) => l.expiry?.date).sort()).toEqual(["2026-11-28", "2026-11-28"]);
  });
});
