// Registro misto con eventi di tutte e cinque le famiglie, per i test del punto unico.
import { derivePantry, type LedgerEvent } from "../ledger";
import { consume as pantryConsume, purchase as pantryPurchase, q, voidOf as pantryVoid } from "../ledger/test-helpers";
import { drink, habit, meal, mood, untracked, water, weight } from "../diary/test-helpers";
import { composePrep } from "../prep";
import { dayTypeEv, food, recipe, structureEv, targetsEv, weekEv } from "../plan/test-helpers";
import { recipeEvent } from "../recipes/test-helpers";
import type { AnyEvent } from "./index";

const T0 = "2026-03-01T08:00:00.000Z";

export interface MixedLog {
  /** Tutti gli eventi, in ordine di costruzione. */
  all: AnyEvent[];
  pantry: LedgerEvent[];
  diary: AnyEvent[];
  plan: AnyEvent[];
  prep: AnyEvent[];
  recipes: AnyEvent[];
  /** `void` fra famiglie diverse. */
  voids: AnyEvent[];
}

/**
 * Un registro misto realistico: dispensa (acquisti, consumi legati a un pasto), diario, piano,
 * una preparazione composta da `composePrep`, una ricetta e `void` che attraversano le famiglie.
 */
export function mixedLog(): MixedLog {
  const base = [
    pantryPurchase("p-rice", T0, { lotId: "rice", productRef: "Riso", quantity: q(500), location: "dispensa", priceCents: 250 }),
    pantryPurchase("p-milk", T0, { lotId: "milk", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo", priceCents: 199 }),
    pantryPurchase("p-pasta", T0, { lotId: "pasta", productRef: "Pasta", quantity: q(500), location: "dispensa" }),
  ];
  const lots = Object.fromEntries(derivePantry(base).lots.map((l) => [l.lotId, l]));

  const composed = composePrep(
    {
      prepId: "riso-latte",
      title: "Riso al latte",
      portions: 4,
      location: "frigo",
      ingredients: [
        { lot: lots.rice, quantity: q(200) },
        { lot: lots.milk, quantity: q(250, "ml") },
      ],
    },
    {
      deviceId: "dev-a",
      now: () => "2026-03-10T17:00:00.000Z",
      idGenerator: (() => {
        let n = 0;
        return () => `prep-${String(++n).padStart(3, "0")}`;
      })(),
    },
  );
  if (!composed.ok) throw new Error(JSON.stringify(composed.errors));
  const prepEvents = composed.events as AnyEvent[];

  const pantry: LedgerEvent[] = [
    ...base,
    pantryConsume("c-meal", "2026-03-10T12:31:00.000Z", { lotId: "pasta", quantity: q(80), mealId: "meal-lunch" }),
    pantryConsume("c-free", "2026-03-10T16:00:00.000Z", { lotId: "pasta", quantity: q(30) }),
  ];

  const diary: AnyEvent[] = [
    meal("m-lunch", "2026-03-10T12:30:00.000Z", { mealId: "meal-lunch", kind: "lunch" }),
    meal("m-break", "2026-03-10T07:30:00.000Z", { mealId: "meal-break", kind: "breakfast" }),
    untracked("u-dinner", "2026-03-10T19:30:00.000Z", { kind: "dinner" }),
    water("w1", "2026-03-10T08:00:00.000Z", { ml: 250 }),
    water("w-gone", "2026-03-10T09:00:00.000Z", { ml: 500 }),
    drink("d1", "2026-03-10T08:10:00.000Z", { name: "Espresso", ml: 30, caffeineMg: 63 }),
    weight("k1", "2026-03-10T06:30:00.000Z", { kg: 72.4 }),
    mood("o1", "2026-03-10T10:00:00.000Z", { score: 4 }),
    habit("h1", T0, { habitId: "hb", title: "Solita colazione", kind: "breakfast", items: [] }),
  ];

  const plan: AnyEvent[] = [
    structureEv("pl-s", T0, {}),
    targetsEv("pl-t", T0, "rest", { energyKcal: { min: 1800, max: 2200 } }),
    weekEv("pl-w", T0, "2026-03-09", [
      food("2026-03-09", "lunch", "Riso", 80),
      recipe("2026-03-10", "dinner", "r1", 2),
    ]),
    dayTypeEv("pl-d1", T0, "2026-03-09", "rest"),
    dayTypeEv("pl-d2", T0, "2026-03-11", "rest"),
  ];

  const recipes: AnyEvent[] = [
    recipeEvent("rc1", T0),
    recipeEvent("rc2", "2026-03-02T08:00:00.000Z", { recipeId: "r2", title: "Risotto" }),
  ];

  // Ogni void punta a una famiglia diversa dalla propria (che per i void è nessuna).
  const voids: AnyEvent[] = [
    pantryVoid("v-diary", "2026-03-10T11:00:00.000Z", "w-gone") as AnyEvent,
    pantryVoid("v-pantry", "2026-03-10T17:00:00.000Z", "c-free") as AnyEvent,
    pantryVoid("v-plan", "2026-03-10T11:00:00.000Z", "pl-d2") as AnyEvent,
    pantryVoid("v-recipe", "2026-03-10T11:00:00.000Z", "rc2") as AnyEvent,
    pantryVoid("v-prep", "2026-03-10T18:00:00.000Z", composed.events.find((e) => e.type === "prep")!.id) as AnyEvent,
  ];

  const all = [...pantry, ...diary, ...plan, ...prepEvents, ...recipes, ...voids];
  return { all, pantry, diary, plan, prep: prepEvents, recipes, voids };
}
