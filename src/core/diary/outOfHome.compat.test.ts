// Prova di compatibilità scritta e fatta girare PRIMA di aggiungere `energyKcal` a `MealItem`: un telefono con la
// versione di prima deve ricevere il pasto fuori casa senza rifiutarlo e senza perderne il contenuto.

import { describe, expect, it } from "vitest";
import { mergeAllEvents, validateAnyEvent, type AnyEvent } from "../events";
import { canonicalStringify } from "../ledger";
import { computeIntake } from "../nutrition/intake";
import { createResolver } from "../nutrition/resolve";
import { FAKE_FOODS } from "../nutrition/test-helpers";
import { deriveDiary } from "./derive";
import { meal } from "./test-helpers";
import type { MealEvent } from "./types";
import { validateDiaryEvent } from "./validate";

const AT = "2026-03-10T12:00:00.000Z";
const resolver = createResolver({ foods: FAKE_FOODS, productByRef: () => undefined });

function outOfHome(extra: Record<string, unknown>): MealEvent {
  return meal("m-out", AT, {
    mealId: "out",
    kind: "lunch",
    certainty: "estimated",
    items: [
      { name: "Fuori casa · normale", quantity: { value: 1, unit: "pz" }, certainty: "estimated", ...extra },
    ],
  });
}

describe("pasto fuori casa: compatibilità con la versione di prima", () => {
  const event = outOfHome({ energyKcal: 800 });

  it("la validazione accetta la voce con il campo in più", () => {
    expect(validateDiaryEvent(event)).toEqual([]);
    expect(validateAnyEvent(event)).toEqual([]);
  });

  it("entra nel diario come un pasto con quella voce", () => {
    const diary = deriveDiary([event]);
    expect(diary.anomalies).toEqual([]);
    const meals = diary.days.flatMap((d) => d.meals);
    expect(meals).toHaveLength(1);
    expect(meals[0]).toMatchObject({ mealId: "out", kind: "lunch", certainty: "estimated" });
    expect(meals[0].items).toHaveLength(1);
    expect(meals[0].items[0]).toMatchObject({
      name: "Fuori casa · normale",
      quantity: { value: 1, unit: "pz" },
      certainty: "estimated",
    });
  });

  it("la nutrizione lo legge come un pasto con una voce, senza scartarlo", () => {
    const day = computeIntake([event], resolver).days[0];
    expect(day.meals).toHaveLength(1);
    expect(day.meals[0].lines).toHaveLength(1);
    expect(day.meals[0].lines[0]).toMatchObject({ kind: "mealItem", label: "Fuori casa · normale" });
    expect(day.coverage.missing).not.toContain("lunch");
    // Né proteine né altro: per chi non conosce il campo la voce non ha valori, per chi lo conosce ha la sola energia.
    expect(day.totals.proteinG).toBeUndefined();
  });

  it("l'unione di due telefoni tiene l'evento intero, campo compreso, in tutti e due i versi", () => {
    const other = meal("m-b", "2026-03-10T07:00:00.000Z", { mealId: "b", kind: "breakfast", items: [] });
    const ab = mergeAllEvents([event as AnyEvent], [other as AnyEvent]);
    const ba = mergeAllEvents([other as AnyEvent], [event as AnyEvent]);
    expect(ab.conflicts).toEqual([]);
    expect(ab.rejected).toEqual([]);
    expect(canonicalStringify(ab.events)).toBe(canonicalStringify(ba.events));
    const kept = ab.events.find((e) => e.id === "m-out");
    expect(canonicalStringify(kept)).toBe(canonicalStringify(event));
    // passa per il testo, come nella copia di sicurezza e nella sincronizzazione
    const viaJson = JSON.parse(JSON.stringify(event)) as AnyEvent;
    expect(mergeAllEvents([event as AnyEvent], [viaJson]).conflicts).toEqual([]);
  });
});

describe("i campi sconosciuti di una voce non fanno rifiutare l'evento", () => {
  // Un campo che nessuna versione conosce: resta a guardia della regola anche dopo che `energyKcal` è diventato noto.
  const event = outOfHome({ somethingFromTheFuture: { any: ["shape"] } });

  it("validazione, diario e nutrizione lo trattano come una voce libera qualunque", () => {
    expect(validateDiaryEvent(event)).toEqual([]);
    const diary = deriveDiary([event]);
    expect(diary.anomalies).toEqual([]);
    expect(diary.days[0].meals[0].items).toEqual([
      { name: "Fuori casa · normale", quantity: { value: 1, unit: "pz" }, certainty: "estimated" },
    ]);
    const day = computeIntake([event], resolver).days[0];
    expect(day.meals[0].lines[0]).toMatchObject({ status: "unresolved", reason: "no_composition" });
    expect(day.totals.energyKcal).toBeUndefined();
  });
});
