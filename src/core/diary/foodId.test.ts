import { describe, expect, it } from "vitest";
import {
  archiveHabit,
  createHabit,
  createMeal,
  createMealFromHabit,
  InvalidDiaryEventError,
} from "./create";
import { deriveDiary } from "./derive";
import { mealsWithPantry, pantryMealReport } from "./pantry";
import { habitsToPropose } from "./selectors";
import { consume, habit, meal } from "./test-helpers";
import { FOOD_ID_MAX_LENGTH, type MealItem } from "./types";
import { validateDiaryEvent } from "./validate";

const AT = "2026-03-10T08:00:00.000Z";
const pasta: MealItem = {
  name: "Pasta",
  quantity: { value: 80, unit: "g" },
  certainty: "label",
  foodId: "pasta-semola-secca",
};
const caffe: MealItem = {
  name: "Caffè",
  quantity: { value: 30, unit: "ml" },
  certainty: "estimated",
};
const opts = { deviceId: "dev-a", now: () => AT };

const mealWith = (items: unknown[]) =>
  meal("m", AT, { mealId: "meal-1", kind: "lunch", items: items as MealItem[] });
const codes = (e: unknown) => validateDiaryEvent(e).map((x) => `${x.path}:${x.code}`);

describe("foodId: validazione", () => {
  it("accetta minuscolo, cifre e trattini, fino a 80 caratteri", () => {
    for (const foodId of ["pasta-semola-secca", "a", "latte-2", "0-9", "a".repeat(FOOD_ID_MAX_LENGTH)]) {
      expect(validateDiaryEvent(mealWith([{ ...pasta, foodId }]))).toEqual([]);
    }
    expect(FOOD_ID_MAX_LENGTH).toBe(80);
  });

  it("stringa vuota o assente valgono come assente", () => {
    expect(validateDiaryEvent(mealWith([{ ...pasta, foodId: "" }]))).toEqual([]);
    expect(validateDiaryEvent(mealWith([caffe]))).toEqual([]);
    expect(validateDiaryEvent(mealWith([{ ...pasta, foodId: undefined }]))).toEqual([]);
  });

  it("rifiuta maiuscole, spazi, underscore, accenti, punti e oltre 80 caratteri", () => {
    for (const foodId of ["Pasta", "pasta secca", "pasta_secca", "caffè", "pasta.secca", " ", "a".repeat(81)]) {
      expect(codes(mealWith([{ ...pasta, foodId }]))).toEqual(["items.0.foodId:invalid_value"]);
    }
  });

  it("rifiuta un foodId che non è una stringa", () => {
    for (const foodId of [7, null, true, {}, ["pasta"]]) {
      expect(codes(mealWith([{ ...pasta, foodId }]))).toEqual(["items.0.foodId:invalid_type"]);
    }
  });

  it("vale anche per le voci dei pasti abituali, con il percorso giusto", () => {
    const h = (items: unknown[]) =>
      habit("a", AT, { habitId: "h", title: "x", kind: "lunch", items: items as MealItem[] });
    expect(validateDiaryEvent(h([pasta, caffe]))).toEqual([]);
    expect(codes(h([caffe, { ...pasta, foodId: "Pasta" }]))).toEqual(["items.1.foodId:invalid_value"]);
  });
});

describe("foodId: attraversa la derivazione", () => {
  it("arriva intatto nei pasti e nei pasti abituali; il vuoto sparisce", () => {
    const state = deriveDiary([
      meal("m1", AT, { mealId: "meal-1", kind: "lunch", items: [pasta, caffe, { ...caffe, name: "Té", foodId: "" }] }),
      habit("a1", AT, { habitId: "h1", title: "Solito pranzo", kind: "lunch", items: [pasta, caffe] }),
    ]);
    expect(state.anomalies).toEqual([]);
    const items = state.days[0].meals[0].items;
    expect(items[0]).toEqual(pasta);
    expect(items[1]).toEqual(caffe);
    expect("foodId" in items[1]).toBe(false);
    expect("foodId" in items[2]).toBe(false);
    expect(state.habits[0].items).toEqual([pasta, caffe]);
  });

  it("un evento con foodId non valido è scartato e segnalato", () => {
    const state = deriveDiary([mealWith([{ ...pasta, foodId: "Pasta Secca" }])]);
    expect(state.days).toEqual([]);
    expect(state.anomalies).toEqual([
      {
        code: "invalid_event",
        eventId: "m",
        errors: [{ path: "items.0.foodId", code: "invalid_value" }],
      },
    ]);
  });

  it("la derivazione non condivide riferimenti con l'ingresso", () => {
    const input = mealWith([pasta]);
    const state = deriveDiary([input]);
    state.days[0].meals[0].items[0].foodId = "altro";
    expect(pasta.foodId).toBe("pasta-semola-secca");
  });

  it("passa da mealsWithPantry, pantryMealReport e habitsToPropose", () => {
    const events = [
      meal("m1", "2026-03-10T11:00:00Z", { mealId: "meal-1", kind: "lunch", items: [pasta] }),
      consume("c1", "2026-03-10T11:01:00Z", {
        lotId: "lot-1",
        quantity: { value: 10, unit: "g" },
        mealId: "meal-1",
      }),
      habit("a1", AT, { habitId: "h1", title: "Solito pranzo", kind: "lunch", usualTime: "13:00", items: [pasta] }),
    ];
    const state = deriveDiary(events);
    expect(mealsWithPantry(state, events)[0].items).toEqual([pasta]);
    expect(pantryMealReport(state, events).meals[0].items[0].foodId).toBe("pasta-semola-secca");
    // 12:30 a Roma (inverno) = 11:30 UTC, in un giorno senza pranzo
    const proposed = habitsToPropose(state, "2026-03-11T11:30:00Z");
    expect(proposed[0].items).toEqual([pasta]);
  });
});

describe("foodId: aiuti di creazione e pasto abituale", () => {
  it("createMeal conserva il foodId e scarta quello vuoto", () => {
    const e = createMeal({ kind: "lunch", items: [pasta, { ...caffe, foodId: "" }] }, opts);
    expect(e.items?.[0]).toEqual(pasta);
    expect(e.items?.[1] && "foodId" in e.items[1]).toBe(false);
    expect(validateDiaryEvent(e)).toEqual([]);
  });

  it("un foodId non valido fa lanciare l'aiuto con il percorso giusto", () => {
    expect(() => createMeal({ kind: "lunch", items: [{ ...pasta, foodId: "Pasta" }] }, opts)).toThrow(
      /items\.0\.foodId:invalid_value/,
    );
    expect(() =>
      createHabit({ habitId: "h", title: "x", kind: "lunch", items: [{ ...pasta, foodId: 3 as never }] }, opts),
    ).toThrow(InvalidDiaryEventError);
  });

  it("un pasto abituale con voci con foodId diventa un pasto con le stesse voci", () => {
    const def = createHabit(
      { habitId: "h1", title: "Solito pranzo", kind: "lunch", usualTime: "13:00", items: [pasta, caffe] },
      opts,
    );
    expect(def.items).toEqual([pasta, caffe]);
    expect(def.items[0]).not.toBe(pasta);

    const state = deriveDiary([def]);
    const m = createMealFromHabit(state.habits[0], opts);
    expect(m.items).toEqual([pasta, caffe]);
    expect(m.items?.[0]).not.toBe(state.habits[0].items[0]);
    expect(m.habitId).toBe("h1");

    const day = deriveDiary([def, m]).days[0];
    expect(day.meals[0].items[0].foodId).toBe("pasta-semola-secca");
    expect(day.meals[0].habitId).toBe("h1");
  });

  it("ritirare un pasto abituale conserva i foodId nella definizione ripetuta", () => {
    const def = createHabit({ habitId: "h1", title: "x", kind: "lunch", items: [pasta] }, opts);
    const archived = archiveHabit(deriveDiary([def]).habits[0], {
      ...opts,
      now: () => "2026-03-11T08:00:00.000Z",
    });
    expect(archived.items).toEqual([pasta]);
    expect(archived.archived).toBe(true);
  });
});
