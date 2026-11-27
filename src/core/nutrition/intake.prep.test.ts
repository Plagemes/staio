import { describe, expect, it } from "vitest";
import { consume, meal, purchase } from "../diary/test-helpers";
import { derivePantry } from "../ledger";
import { composePrep } from "../prep";
import { computeIntake } from "./intake";
import { compositionFromFood, createResolver, type CompositionResolver } from "./resolve";
import { FAKE_FOODS } from "./test-helpers";

const q = (value: number, unit: "g" | "ml" | "pz") => ({ value, unit });
const pollo = FAKE_FOODS.find((f) => f.id === "pollo-petto-crudo")!;

/** 400 g di pollo (100 kcal/100 g) cotti il 9 in 4 porzioni; una porzione mangiata a pranzo il 10. */
function cooked() {
  const bought = purchase("p-pollo", "2026-03-01T08:00:00.000Z", {
    lotId: "pollo",
    productRef: pollo.name,
    quantity: q(600, "g"),
    location: "frigo",
  });
  const lot = derivePantry([bought]).lots[0];
  let n = 0;
  const composed = composePrep(
    { prepId: "pp", title: "Pollo al forno", portions: 4, location: "frigo", ingredients: [{ lot, quantity: q(400, "g") }] },
    { deviceId: "d", now: () => "2026-03-09T17:00:00.000Z", idGenerator: () => `prep-${++n}` },
  );
  if (!composed.ok) throw new Error("preparazione non valida");
  const declare = composed.events.find((e) => e.type === "declare")!;
  const batch = (declare as { lotId: string }).lotId;
  return {
    batch,
    events: [
      bought,
      ...composed.events,
      meal("m", "2026-03-10T12:30:00.000Z", { mealId: "lunch", kind: "lunch" }),
      consume("c-porzione", "2026-03-10T12:30:00.000Z", { lotId: batch, quantity: q(1, "pz"), mealId: "lunch" }),
    ],
  };
}

const base = createResolver({ foods: FAKE_FOODS });

describe("computeIntake: preparazioni", () => {
  it("i consumi degli ingredienti non sono mangiato: il giorno della cottura resta vuoto, conta la porzione", () => {
    const { batch, events } = cooked();
    // la porzione vale un quarto del pollo: 100 g, 100 kcal
    const resolve: CompositionResolver = (s) =>
      s.kind === "pantry" && s.lotId === batch
        ? { ...compositionFromFood(pollo), name: "Pollo al forno", ref: "prep:pp", origin: "derived", unitWeightG: 100 }
        : base(s);
    const { days } = computeIntake(events, resolve);
    expect(days.map((d) => d.date)).toEqual(["2026-03-10"]);
    const lines = days[0].meals.flatMap((m) => m.lines);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "pantry", eventId: "c-porzione", status: "ok" });
    expect(days[0].standalone).toEqual([]);
    expect(days[0].totals.energyKcal?.value).toBe(100);
  });

  it("gli altri consumi senza pasto dello stesso giorno contano ancora", () => {
    const { events } = cooked();
    const snack = consume("c-assaggio", "2026-03-09T18:00:00.000Z", { lotId: "pollo", quantity: q(50, "g") });
    const day = computeIntake([...events, snack], base).days.find((d) => d.date === "2026-03-09");
    expect(day?.standalone.map((l) => l.eventId)).toEqual(["c-assaggio"]);
    expect(day?.totals.energyKcal?.value).toBe(50);
  });
});
