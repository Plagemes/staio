import { describe, expect, it } from "vitest";
import { derivePantry } from "../ledger";
import { consume, purchase, q } from "../ledger/test-helpers";
import { derivePlan } from "../plan";
import { prepEntry, weekEv } from "../plan/test-helpers";
import { composePrep, buildPrepSchedule, derivePreps, existingPortionsOf } from "./index";

const T = "2026-03-01T10:00:00.000Z";

const planOf = (entries: Parameters<typeof weekEv>[3]) =>
  derivePlan([weekEv("w", T, "2026-03-09", entries)]);

describe("programma di preparazione con porzioni già pronte", () => {
  it("si cucina solo il resto e si dichiara la copertura", () => {
    const state = planOf([
      prepEntry("2026-03-10", "lunch", "zuppa", 2),
      prepEntry("2026-03-12", "lunch", "zuppa", 2),
      prepEntry("2026-03-15", "lunch", "zuppa", 2),
    ]);
    const r = buildPrepSchedule(state, "2026-03-09", {
      portionLifeDays: () => 2,
      existingPortions: [{ prepId: "zuppa", remaining: 3, goodUntil: "2026-03-12", lotId: "l1" }],
    });
    expect(r.coverage).toEqual([
      {
        prepId: "zuppa",
        needed: 6,
        covered: 3,
        toCook: 3,
        uses: [
          { date: "2026-03-10", meal: "lunch", servings: 2, lotId: "l1" },
          { date: "2026-03-12", meal: "lunch", servings: 1, lotId: "l1" },
        ],
      },
    ]);
    expect(r.tasks.map((t) => [t.cookBy, t.servings])).toEqual([
      ["2026-03-12", 1],
      ["2026-03-15", 2],
    ]);
  });

  it("existingPortionsOf legge porzioni rimaste e scadenza dallo stato reale", () => {
    const base = [
      purchase("p", "2026-03-01T08:00:00.000Z", {
        lotId: "r",
        productRef: "Riso",
        quantity: q(500, "g"),
        location: "dispensa",
        priceCents: 250,
      }),
    ];
    const lot = derivePantry(base).lots[0];
    const res = composePrep(
      {
        prepId: "zuppa",
        title: "Zuppa",
        portions: 4,
        location: "frigo",
        ingredients: [{ lot, quantity: q(100, "g") }],
      },
      { deviceId: "dev-a", now: () => "2026-03-10T17:00:00.000Z" },
    );
    if (!res.ok) throw new Error("compose");
    const events = [...base, ...res.events];
    expect(existingPortionsOf(derivePreps(events))).toEqual([
      { prepId: "zuppa", remaining: 4, goodUntil: "2026-03-13", lotId: res.batchLotId },
    ]);
    const some = [
      ...events,
      consume("e1", "2026-03-11T10:00:00.000Z", { lotId: res.batchLotId, quantity: q(3, "pz") }),
    ];
    expect(existingPortionsOf(derivePreps(some))[0].remaining).toBe(1);
    const all = [
      ...some,
      consume("e2", "2026-03-11T12:00:00.000Z", { lotId: res.batchLotId, quantity: q(1, "pz") }),
    ];
    expect(existingPortionsOf(derivePreps(all))).toEqual([]);
  });
});
