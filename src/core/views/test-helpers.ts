// Stati costruiti per i test delle viste. Tutti i valori sono FINTI, scelti per far tornare i conti a mente.
import { deriveDiary } from "../diary";
import { drink, meal, mood, symptom, water, weight } from "../diary/test-helpers";
import { derivePantry } from "../ledger";
import { consume, discard, purchase, q } from "../ledger/test-helpers";
import { computeIntake, createResolver, type ReferenceWithVariant } from "../nutrition";
import { FAKE_FOODS } from "../nutrition/test-helpers";
import type { ViewContext } from "./types";

export const TODAY = "2026-11-16";

const SOURCE = { body: "FINTO", document: "solo test", url: "https://example.invalid" };

export const FAKE_REFERENCES: readonly ReferenceWithVariant[] = [
  { nutrient: "proteinG", kind: "PRI", ageMin: 18, ageMax: 64, amount: 50, source: SOURCE },
  { nutrient: "caffeineMg", kind: "UL", ageMin: 18, ageMax: 64, amount: 400, source: SOURCE },
];

const item = (name: string, value: number, unit: "g" | "ml" | "pz") => ({ name, quantity: q(value, unit), certainty: "measured" as const });

/** Colazione, pranzo e cena per i giorni dal 10 al 15 novembre: 38 g di proteine al giorno, tutto da tabella. */
function completeDays() {
  const events = [];
  for (let day = 10; day <= 15; day++) {
    const d = `2026-11-${day}`;
    events.push(
      meal(`b${day}`, `${d}T07:00:00Z`, { mealId: `mb${day}`, kind: "breakfast", items: [item("Latte intero", 200, "ml")] }),
      meal(`l${day}`, `${d}T12:00:00Z`, { mealId: `ml${day}`, kind: "lunch", items: [item("Pasta di semola secca", 100, "g")] }),
      meal(`d${day}`, `${d}T19:00:00Z`, { mealId: `md${day}`, kind: "dinner", items: [item("Petto di pollo crudo", 100, "g")] }),
    );
  }
  // oggi: solo la colazione, quindi giornata incompleta
  events.push(meal("b16", "2026-11-16T07:00:00Z", { mealId: "mb16", kind: "breakfast", items: [item("Latte intero", 200, "ml")] }));
  return events;
}

export function sampleEvents() {
  return [
    ...completeDays(),
    // spesa
    purchase("p-milk", "2026-11-12T10:00:00Z", {
      lotId: "lot-milk", productRef: "Latte fresco", category: "milk_fresh", quantity: q(1000, "ml"), priceCents: 150, store: "Coop", location: "frigo",
      expiry: { date: "2026-11-17", kind: "use_by" },
    }),
    purchase("p-yogurt", "2026-11-05T10:00:00Z", { lotId: "lot-yogurt", productRef: "Yogurt", category: "yogurt", quantity: q(500, "g"), priceCents: 250, store: "Coop", location: "frigo" }),
    purchase("p-pasta", "2026-11-13T10:00:00Z", { lotId: "lot-pasta", productRef: "Pasta", category: "pasta_dry", quantity: q(500, "g"), priceCents: 120, store: "Esselunga", location: "dispensa" }),
    purchase("p-misc", "2026-11-14T10:00:00Z", { lotId: "lot-misc", productRef: "Cose varie", quantity: q(1, "pz"), priceCents: 300, location: "dispensa" }),
    purchase("p-bread", "2026-11-14T11:00:00Z", { lotId: "lot-bread", productRef: "Pane", category: "bread_fresh", quantity: q(400, "g"), location: "dispensa" }),
    consume("c-milk", "2026-11-13T08:00:00Z", { lotId: "lot-milk", quantity: q(200, "ml") }),
    discard("x-pasta", "2026-11-15T10:00:00Z", { lotId: "lot-pasta", quantity: q(100, "g"), reason: "expired" }),
    discard("x-bread", "2026-11-15T10:30:00Z", { lotId: "lot-bread", quantity: q(50, "g"), reason: "leftover" }),
    // corpo
    water("w13", "2026-11-13T10:00:00Z", { ml: 1000 }),
    water("w14", "2026-11-14T10:00:00Z", { ml: 500 }),
    water("w15", "2026-11-15T10:00:00Z", { ml: 1500 }),
    weight("kg1", "2026-11-01T07:00:00Z", { kg: 72 }),
    weight("kg10", "2026-11-10T07:00:00Z", { kg: 71.5 }),
    weight("kg15", "2026-11-15T07:00:00Z", { kg: 71 }),
    mood("m12", "2026-11-12T20:00:00Z", { score: 4 }),
    mood("m13", "2026-11-13T20:00:00Z", { score: 2 }),
    mood("m14", "2026-11-14T20:00:00Z", { score: 3 }),
    symptom("s14", "2026-11-14T21:00:00Z", { kind: "energy", score: 3 }),
    drink("dr15", "2026-11-15T09:00:00Z", { name: "Caffè", ml: 40, caffeineMg: 80 }),
  ];
}

export function buildContext(events: readonly unknown[] = sampleEvents(), extra: Partial<ViewContext> = {}): ViewContext {
  const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });
  return {
    today: TODAY,
    pantry: derivePantry(events as never),
    diary: deriveDiary(events),
    intake: computeIntake(events, resolver),
    references: FAKE_REFERENCES,
    profile: { sex: "female", ageYears: 30 },
    ...extra,
  };
}

export const EMPTY_CONTEXT: ViewContext = buildContext([]);
