// Stato assunto per le voci di pasto e di dispensa, con dati FINTI (FAKE_STATE_FOODS).
import { describe, expect, it } from "vitest";
import { consume, meal, purchase } from "../diary/test-helpers";
import { computeIntake } from "./intake";
import { createResolver, type CompositionResolver, type IntakeSubject } from "./resolve";
import { FAKE_STATE_FOODS } from "./test-helpers";

const resolver = createResolver({ foods: FAKE_STATE_FOODS });
const AT = "2026-03-10T08:00:00.000Z";
const q = (value: number, unit: "g" | "ml" | "pz") => ({ value, unit });

const mealOf = (name: string, grams: number) =>
  meal("m-" + name, AT, {
    mealId: "m-" + name,
    kind: "lunch",
    items: [{ name, quantity: q(grams, "g"), certainty: "measured" }],
  });

const events = [
  purchase("p1", "2026-03-10T06:00:00.000Z", {
    lotId: "lot-1",
    productRef: "pasta",
    quantity: q(500, "g"),
    location: "dispensa",
  }),
  mealOf("pasta", 200),
  consume("c1", "2026-03-10T15:00:00.000Z", { lotId: "lot-1", quantity: q(80, "g") }),
];

const firstLine = (evts: unknown[]) => computeIntake(evts, resolver).days[0].meals[0].lines[0];

describe("computeIntake: stato assunto", () => {
  const day = computeIntake(events, resolver).days[0];

  it("una voce libera di pasto è calcolata come cotta", () => {
    const line = day.meals[0].lines[0];
    expect(line.status).toBe("ok");
    if (line.status !== "ok") return;
    expect(line.composition).toMatchObject({
      ref: "pasta-cotta-s",
      state: "cooked",
      statePreference: { preferred: ["cooked"], honored: true },
    });
    expect(line.nutrients.energyKcal).toBe(300); // 200 g * 150 kcal / 100 g, non 700
  });

  it("un consumo dalla dispensa resta pasta secca", () => {
    const line = day.standalone[0];
    expect(line.status).toBe("ok");
    if (line.status !== "ok") return;
    expect(line.composition).toMatchObject({ ref: "pasta-secca-s", state: "dried" });
    expect(line.composition.statePreference?.honored).toBe(true);
    expect(line.nutrients.energyKcal).toBe(280);
  });

  it("il risolutore riceve gli stati preferiti con ogni voce", () => {
    const seen: IntakeSubject[] = [];
    const spy: CompositionResolver = (s) => {
      seen.push(s);
      return resolver(s);
    };
    computeIntake(events, spy);
    expect(seen.find((s) => s.kind === "mealItem")?.preferStates).toEqual(["cooked"]);
    expect(seen.find((s) => s.kind === "pantry")?.preferStates).toEqual(["dried", "raw", "as_sold"]);
  });

  it("le preferenze si possono cambiare con le opzioni", () => {
    const out = computeIntake(events, resolver, {
      statePreference: { mealItem: ["dried"], pantry: ["cooked"] },
    });
    const item = out.days[0].meals[0].lines[0];
    const pantry = out.days[0].standalone[0];
    expect(item.status === "ok" && item.composition.state).toBe("dried");
    expect(pantry.status === "ok" && pantry.composition.state).toBe("cooked");
  });

  it("un alimento senza variantOf non porta preferenza di stato", () => {
    const bread = firstLine([mealOf("pane", 50)]);
    expect(bread.status === "ok" && bread.composition.state).toBe("as_sold");
    expect(bread.status === "ok" && bread.composition.statePreference).toBeUndefined();
  });

  it("solo il crudo in un pasto: usato, con honored falso", () => {
    const line = firstLine([mealOf("bistecca di manzo", 100)]);
    expect(line.status === "ok" && line.composition).toMatchObject({
      state: "raw",
      statePreference: { preferred: ["cooked"], honored: false },
    });
  });

  it("solo il secco in un pasto: non risolto con il motivo dedicato, nessun valore", () => {
    const line = firstLine([mealOf("polenta", 250)]);
    expect(line).toMatchObject({ status: "unresolved", reason: "missing_cooked_entry", label: "polenta" });
    expect(line.status === "unresolved" && line.message).toContain("manca la voce cotta");
    const out = computeIntake([mealOf("polenta", 250)], resolver).days[0];
    expect(out.totals).toEqual({});
    expect(out.unresolved).toHaveLength(1);
  });

  it("la stessa polenta dalla dispensa è la farina secca", () => {
    const out = computeIntake(
      [
        purchase("p2", "2026-03-10T06:00:00.000Z", {
          lotId: "lot-2",
          productRef: "polenta",
          quantity: q(500, "g"),
          location: "dispensa",
        }),
        consume("c2", "2026-03-10T15:00:00.000Z", { lotId: "lot-2", quantity: q(100, "g") }),
      ],
      resolver,
    );
    const line = out.days[0].standalone[0];
    expect(line.status === "ok" && line.composition).toMatchObject({ ref: "farina-mais-s", state: "dried" });
    expect(line.status === "ok" && line.nutrients.energyKcal).toBe(360);
  });

  it("alimenti diversi con lo stesso alias restano non risolti", () => {
    const line = firstLine([mealOf("tonno", 80)]);
    expect(line).toMatchObject({ status: "unresolved", reason: "no_composition" });
  });
});
