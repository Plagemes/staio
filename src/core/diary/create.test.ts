import { describe, expect, it } from "vitest";
import { createIdGenerator, voidEvent } from "../ledger";
import {
  archiveHabit,
  createDrink,
  createHabit,
  createMeal,
  createMealFromHabit,
  createMood,
  createSupplement,
  createSymptom,
  createUntrackedMeal,
  createWater,
  createWeight,
  InvalidDiaryEventError,
  type DiaryEventOptions,
} from "./create";
import { deriveDiary } from "./derive";
import { seededRandom } from "./test-helpers";
import { validateDiaryEvent } from "./validate";

const NOW = "2026-03-10T08:00:00.000Z";

function options(extra: Partial<DiaryEventOptions> = {}): DiaryEventOptions {
  return {
    deviceId: "dev-a",
    now: () => NOW,
    idGenerator: createIdGenerator({ now: () => Date.parse(NOW), random: seededRandom(1) }),
    ...extra,
  };
}

describe("aiuti per creare eventi", () => {
  it("ogni evento creato da dati minimi è valido e ha la busta completa", () => {
    const o = options();
    const events = [
      createMeal({ kind: "lunch" }, o),
      createUntrackedMeal({ kind: "dinner" }, o),
      createWater({ ml: 250 }, o),
      createDrink({ name: "Espresso", ml: 30, caffeineMg: 63 }, o),
      createWeight({ kg: 71.8 }, o),
      createMood({ score: 4 }, o),
      createSymptom({ kind: "energy", score: 2 }, o),
      createSupplement({ name: "Magnesio" }, o),
      createHabit({ habitId: "h", title: "Colazione", kind: "breakfast", items: [] }, o),
    ];
    for (const e of events) {
      expect(validateDiaryEvent(e)).toEqual([]);
      expect(e).toEqual(
        expect.objectContaining({
          at: NOW,
          recordedAt: NOW,
          deviceId: "dev-a",
          schemaVersion: 1,
          source: "manual",
        }),
      );
    }
    expect(new Set(events.map((e) => e.id)).size).toBe(events.length);
    expect(events.map((e) => e.certainty)).toEqual([
      "estimated",
      "measured",
      "estimated",
      "label",
      "measured",
      "measured",
      "measured",
      "label",
      "measured",
    ]);
  });

  it("senza chiavi con valore undefined", () => {
    const e = createMeal({ kind: "lunch", title: undefined, items: undefined }, options());
    expect(Object.keys(e)).not.toContain("title");
    expect(Object.keys(e)).not.toContain("items");
    expect(Object.keys(e)).not.toContain("note");
  });

  it("rispetta at, certezza, fonte, nota e mealId indicati", () => {
    const e = createMeal(
      { kind: "snack", mealId: "meal-fisso" },
      options({ at: "2026-03-09T20:00:00.000Z", certainty: "label", source: "voice", note: "fuori casa" }),
    );
    expect(e).toEqual(
      expect.objectContaining({
        mealId: "meal-fisso",
        at: "2026-03-09T20:00:00.000Z",
        recordedAt: NOW,
        certainty: "label",
        source: "voice",
        note: "fuori casa",
      }),
    );
  });

  it("un pasto nuovo riceve un mealId proprio, diverso dall'id dell'evento", () => {
    const e = createMeal({ kind: "lunch" }, options());
    expect(e.mealId).not.toBe(e.id);
    expect(e.mealId.length).toBeGreaterThan(0);
  });

  it("lancia con l'elenco degli errori se i dati non sono validi", () => {
    expect(() => createWater({ ml: 0 }, options())).toThrow(InvalidDiaryEventError);
    expect(() => createMood({ score: 7 }, options())).toThrow(/score:invalid_value/);
    expect(() => createWeight({ kg: 70 }, options({ at: "ieri" }))).toThrow(/at:invalid_instant/);
    try {
      createDrink({ name: "", ml: -1 }, options());
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidDiaryEventError);
      expect((err as InvalidDiaryEventError).errors).toEqual([
        { path: "name", code: "invalid_type" },
        { path: "ml", code: "not_positive" },
      ]);
    }
  });

  it("il pasto abituale diventa un pasto con source habit e la stessa composizione", () => {
    const o = options();
    const def = createHabit(
      {
        habitId: "h1",
        title: "Solita colazione",
        kind: "breakfast",
        usualTime: "07:30",
        items: [{ name: "Caffè", quantity: { value: 30, unit: "ml" }, certainty: "estimated" }],
      },
      o,
    );
    const state = deriveDiary([def]);
    const m = createMealFromHabit(state.habits[0], o);
    expect(m).toEqual(
      expect.objectContaining({
        type: "meal",
        kind: "breakfast",
        title: "Solita colazione",
        habitId: "h1",
        source: "habit",
      }),
    );
    expect(m.items).toEqual(def.items);
    expect(m.items).not.toBe(def.items);
    expect(validateDiaryEvent(m)).toEqual([]);
  });

  it("ritirare un pasto abituale: vale come ultima definizione, e si può annullare", () => {
    const o = options();
    const def = createHabit({ habitId: "h1", title: "Colazione", kind: "breakfast", items: [] }, o);
    const archived = archiveHabit(deriveDiary([def]).habits[0], {
      ...o,
      now: () => "2026-03-11T08:00:00.000Z",
    });
    expect(archived.archived).toBe(true);
    expect(deriveDiary([def, archived]).habits).toEqual([]);
    const undo = voidEvent(archived, { ...o, now: () => "2026-03-12T08:00:00.000Z" });
    expect(deriveDiary([def, archived, undo]).habits.map((h) => h.habitId)).toEqual(["h1"]);
  });

  it("gli eventi creati con l'orologio di sistema sono validi", () => {
    const e = createWater({ ml: 100 }, { deviceId: "dev-b" });
    expect(validateDiaryEvent(e)).toEqual([]);
    expect(Date.parse(e.at)).not.toBeNaN();
  });
});
