import { describe, expect, it } from "vitest";
import { computeIntake, createResolver } from "../nutrition";
import { FAKE_FOODS } from "../nutrition/test-helpers";
import { deriveDiary } from "./derive";
import { mealsWithPantry } from "./pantry";
import { dayCoverage, getDay, mealMoments } from "./selectors";
import { consume, declaration, meal, purchase, voidOf } from "./test-helpers";

const D = "2026-03-10";
const TZ = { timeZone: "UTC" };
const at = (hhmm: string) => `${D}T${hhmm}:00.000Z`;
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

const lot = purchase("p1", at("06:00"), { lotId: "lot-1", productRef: "pasta", quantity: q(500), location: "dispensa" });
const lot2 = purchase("p2", at("06:00"), { lotId: "lot-2", productRef: "riso", quantity: q(500), location: "dispensa" });

// «Inserito per sbaglio» annulla i consumi del lotto ma lascia l'evento del pasto.
describe("pasto fantasma: fatto solo di consumi poi annullati", () => {
  const ghost = [
    lot,
    meal("m1", at("12:30"), { mealId: "meal-1", kind: "lunch" }),
    consume("c1", at("12:31"), { lotId: "lot-1", quantity: q(80), mealId: "meal-1" }),
    voidOf("v1", at("13:00"), "c1"),
  ];

  it("non compare tra i pasti del giorno né in quelli con la dispensa", () => {
    const state = deriveDiary(ghost, TZ);
    expect(getDay(state, D)?.meals ?? []).toEqual([]);
    expect(mealsWithPantry(state, ghost)).toEqual([]);
  });

  it("per lo stato del momento vale come niente segnato", () => {
    const day = getDay(deriveDiary(ghost, TZ), D);
    expect(mealMoments(day).find((m) => m.kind === "lunch")?.status).toBe("none");
    expect(dayCoverage(day, D).missing).toContain("lunch");
    expect(dayCoverage(day, D).tracked).toBe(0);
  });

  it("una dichiarazione «saltato» del momento torna a contare", () => {
    const decl = declaration("x", at("15:00"), { date: D, kind: "lunch", status: "skipped" });
    const day = getDay(deriveDiary([...ghost, decl], TZ), D);
    expect(mealMoments(day).find((m) => m.kind === "lunch")?.status).toBe("skipped");
  });

  it("non è contato come pasto nei nutrienti: nessun pasto con zero righe, nessun motivo «pasto vuoto»", () => {
    const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });
    const out = computeIntake(ghost, resolver, TZ).days.find((d) => d.date === D);
    expect(out?.meals ?? []).toEqual([]);
    expect(out?.reasons ?? []).not.toContain("empty_meals");
  });

  it("annullando l'annullamento il consumo torna e il pasto con lui", () => {
    const restored = [...ghost, voidOf("v2", at("13:05"), "v1")];
    expect(getDay(deriveDiary(restored, TZ), D)?.meals).toHaveLength(1);
  });

  it("un pasto senza voci e senza consumi mai scritti resta un pasto (nessun consumo annullato, nessun fantasma)", () => {
    const bare = [meal("m9", at("12:30"), { mealId: "meal-9", kind: "lunch" })];
    expect(getDay(deriveDiary(bare, TZ), D)?.meals).toHaveLength(1);
  });
});

describe("pasto misto: perde solo le righe annullate", () => {
  const mixed = [
    lot,
    lot2,
    meal("m1", at("12:30"), {
      mealId: "meal-1",
      kind: "lunch",
      items: [{ name: "Insalata", quantity: q(100), certainty: "estimated" }],
    }),
    consume("c1", at("12:31"), { lotId: "lot-1", quantity: q(80), mealId: "meal-1" }),
    consume("c2", at("12:31"), { lotId: "lot-2", quantity: q(60), mealId: "meal-1" }),
    voidOf("v1", at("13:00"), "c1"),
  ];

  it("resta registrato, con le righe che non sono state annullate", () => {
    const state = deriveDiary(mixed, TZ);
    const [m] = mealsWithPantry(state, mixed);
    expect(m.items.map((i) => i.name)).toEqual(["Insalata"]);
    expect(m.pantryConsumes.map((c) => c.id)).toEqual(["c2"]);
    expect(mealMoments(getDay(state, D)).find((x) => x.kind === "lunch")?.status).toBe("recorded");
  });

  it("dice con discrezione che una voce è stata tolta", () => {
    const [m] = mealsWithPantry(deriveDiary(mixed, TZ), mixed);
    expect(m.removedLines).toBe(1);
    const untouched = mixed.filter((e) => e.id !== "v1");
    expect(mealsWithPantry(deriveDiary(untouched, TZ), untouched)[0].removedLines).toBeUndefined();
  });

  it("anche senza voci libere, un pasto con un consumo ancora attivo resta e segnala la riga tolta", () => {
    const onlyPantry = [
      lot,
      lot2,
      meal("m1", at("12:30"), { mealId: "meal-1", kind: "lunch" }),
      consume("c1", at("12:31"), { lotId: "lot-1", quantity: q(80), mealId: "meal-1" }),
      consume("c2", at("12:31"), { lotId: "lot-2", quantity: q(60), mealId: "meal-1" }),
      voidOf("v1", at("13:00"), "c1"),
    ];
    const [m] = mealsWithPantry(deriveDiary(onlyPantry, TZ), onlyPantry);
    expect(m.removedLines).toBe(1);
    expect(m.pantryConsumes).toHaveLength(1);
  });

  it("nei nutrienti il pasto conta solo le righe rimaste", () => {
    const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });
    const day = computeIntake(mixed, resolver, TZ).days.find((d) => d.date === D);
    expect(day?.meals).toHaveLength(1);
    expect(day?.meals[0].lines.length).toBe(2); // insalata + consumo c2
  });
});
