import { describe, expect, it } from "vitest";
import { deriveDiary } from "../diary";
import { consume, drink, meal, purchase, untracked, voidOf } from "../diary/test-helpers";
import { derivePantry } from "../ledger";
import { computeIntake } from "./intake";
import { createResolver } from "./resolve";
import { FAKE_FOODS, FAKE_PRODUCT } from "./test-helpers";

const resolver = createResolver({
  foods: FAKE_FOODS,
  productByRef: (ref) => (ref === FAKE_PRODUCT.barcode ? FAKE_PRODUCT : undefined),
});

const q = (value: number, unit: "g" | "ml" | "pz") => ({ value, unit });

// a cavallo della mezzanotte: in fusi diversi gli stessi eventi cadono in giorni diversi
const events = [
  purchase("p1", "2026-03-09T20:00:00.000Z", { lotId: "lot-1", productRef: FAKE_PRODUCT.barcode, quantity: q(500, "g"), location: "dispensa" }),
  purchase("p2", "2026-03-09T20:00:00.000Z", { lotId: "lot-2", productRef: "Mela", quantity: q(3, "pz"), location: "frigo" }),
  meal("m1", "2026-03-09T23:30:00.000Z", { mealId: "late", kind: "dinner", items: [{ name: "Latte intero", quantity: q(200, "ml"), certainty: "measured" }] }),
  consume("c1", "2026-03-09T23:31:00.000Z", { lotId: "lot-1", quantity: q(50, "g"), mealId: "late" }),
  consume("c2", "2026-03-10T07:00:00.000Z", { lotId: "lot-2", quantity: q(1, "pz") }),
  meal("m2", "2026-03-10T12:00:00.000Z", { mealId: "lunch", kind: "lunch", items: [{ name: "Pranzo fuori", quantity: q(1, "pz"), certainty: "estimated", energyKcal: 650 }] }),
  meal("m3", "2026-03-10T12:10:00.000Z", { mealId: "lunch", kind: "lunch", items: [{ name: "Pranzo fuori", quantity: q(1, "pz"), certainty: "estimated", energyKcal: 800 }] }),
  untracked("u1", "2026-03-10T19:00:00.000Z", { kind: "dinner" }),
  drink("d1", "2026-03-10T10:00:00.000Z", { name: "Caffè", ml: 40, caffeineMg: 60 }),
  consume("c3", "2026-03-10T13:00:00.000Z", { lotId: "lot-1", quantity: q(30, "g") }),
  voidOf("v1", "2026-03-10T14:00:00.000Z", "c3"),
];

describe("computeIntake con diario e dispensa già calcolati", () => {
  it("dà lo stesso risultato di quando li calcola da sé", () => {
    const expected = computeIntake(events, resolver);
    const derived = { diary: deriveDiary(events), pantry: derivePantry(events) };
    expect(computeIntake(events, resolver, {}, derived)).toStrictEqual(expected);
    // anche uno solo dei due
    expect(computeIntake(events, resolver, {}, { diary: derived.diary })).toStrictEqual(expected);
    expect(computeIntake(events, resolver, {}, { pantry: derived.pantry })).toStrictEqual(expected);
  });

  it("con un fuso esplicito usa il diario solo se è di quel fuso; altrimenti lo rifà", () => {
    const tz = "America/New_York";
    const expected = computeIntake(events, resolver, { timeZone: tz });
    // un diario nel fuso predefinito darebbe altri giorni: non si usa
    expect(computeIntake(events, resolver, { timeZone: tz }, { diary: deriveDiary(events) })).toStrictEqual(expected);
    expect(computeIntake(events, resolver, { timeZone: tz }, { diary: deriveDiary(events, { timeZone: tz }) })).toStrictEqual(expected);
    // e senza fuso, un diario di un altro fuso non vale per quello predefinito
    expect(computeIntake(events, resolver, {}, { diary: deriveDiary(events, { timeZone: tz }) })).toStrictEqual(computeIntake(events, resolver));
    expect(expected.days.map((d) => d.date)).not.toEqual(computeIntake(events, resolver).days.map((d) => d.date));
  });

  it("non modifica il diario e la dispensa che riceve", () => {
    const diary = deriveDiary(events);
    const pantry = derivePantry(events);
    const before = JSON.stringify({ diary, pantry });
    computeIntake(events, resolver, {}, { diary, pantry });
    expect(JSON.stringify({ diary, pantry })).toBe(before);
  });
});
