import { describe, expect, it } from "vitest";
import { DIARY_EVENT_TYPES, DIARY_LIMITS } from "./types";
import { isDiaryEvent, validateDiaryEvent } from "./validate";
import {
  drink,
  habit,
  meal,
  mood,
  sampleDiaryEvents,
  supplement,
  symptom,
  untracked,
  voidOf,
  water,
  weight,
} from "./test-helpers";

const AT = "2026-03-10T08:00:00.000Z";
const codes = (e: unknown) => validateDiaryEvent(e).map((x) => `${x.path}:${x.code}`);
const item = { name: "Pane", quantity: { value: 50, unit: "g" }, certainty: "label" };

describe("validateDiaryEvent", () => {
  it("accetta un esempio valido per ogni tipo", () => {
    const samples = sampleDiaryEvents();
    expect(samples.map((s) => s.type).sort()).toEqual([...DIARY_EVENT_TYPES].sort());
    for (const s of samples) expect(validateDiaryEvent(s)).toEqual([]);
  });

  it("accetta un void", () => {
    expect(validateDiaryEvent(voidOf("v1", AT, "m1"))).toEqual([]);
    expect(codes({ ...voidOf("v1", AT, "m1"), targetEventId: undefined })).toEqual([
      "targetEventId:required",
    ]);
  });

  it("segnala gli errori di busta nello stesso formato del libro mastro", () => {
    expect(validateDiaryEvent(null)).toEqual([{ path: "", code: "not_an_object" }]);
    expect(validateDiaryEvent([])).toEqual([{ path: "", code: "not_an_object" }]);
    const broken = { ...water("w1", AT, { ml: 100 }), at: "ieri", deviceId: undefined };
    expect(codes(broken)).toEqual(
      expect.arrayContaining(["at:invalid_instant", "deviceId:required"]),
    );
  });

  it("rifiuta tipi mancanti, sconosciuti e della dispensa", () => {
    const base = water("w1", AT, { ml: 100 });
    expect(codes({ ...base, type: undefined })).toEqual(["type:required"]);
    expect(codes({ ...base, type: "foo" })).toEqual(["type:invalid_value"]);
    expect(codes({ ...base, type: "consume" })).toEqual(["type:invalid_value"]);
    expect(isDiaryEvent({ ...base, type: "consume" })).toBe(false);
    expect(isDiaryEvent(base)).toBe(true);
    expect(isDiaryEvent(null)).toBe(false);
  });

  it("meal", () => {
    expect(validateDiaryEvent(meal("m", AT, { mealId: "x", kind: "lunch" }))).toEqual([]);
    expect(
      validateDiaryEvent(meal("m", AT, { mealId: "x", kind: "lunch", items: [item] as never })),
    ).toEqual([]);
    expect(codes({ ...meal("m", AT, { mealId: "x", kind: "lunch" }), mealId: undefined })).toEqual([
      "mealId:required",
    ]);
    expect(codes(meal("m", AT, { mealId: "x", kind: "brunch" as never }))).toEqual([
      "kind:invalid_value",
    ]);
    expect(codes(meal("m", AT, { mealId: "x", kind: "lunch", title: 3 as never }))).toEqual([
      "title:invalid_type",
    ]);
    expect(codes(meal("m", AT, { mealId: "x", kind: "lunch", items: "pane" as never }))).toEqual([
      "items:invalid_type",
    ]);
    const bad = { name: "", quantity: { value: 0, unit: "kg" }, certainty: "boh" };
    expect(codes(meal("m", AT, { mealId: "x", kind: "lunch", items: [bad] as never }))).toEqual([
      "items.0.name:invalid_type",
      "items.0.certainty:invalid_value",
      "items.0.quantity.value:not_positive",
      "items.0.quantity.unit:invalid_value",
    ]);
    expect(
      codes(
        meal("m", AT, {
          mealId: "x",
          kind: "lunch",
          items: [{ name: "a", certainty: "label" }] as never,
        }),
      ),
    ).toEqual(["items.0.quantity:required"]);
  });

  it("untrackedMeal", () => {
    expect(validateDiaryEvent(untracked("u", AT, { kind: "dinner" }))).toEqual([]);
    expect(codes({ ...untracked("u", AT, { kind: "dinner" }), kind: undefined })).toEqual([
      "kind:required",
    ]);
  });

  it("water", () => {
    expect(validateDiaryEvent(water("w", AT, { ml: 1 }))).toEqual([]);
    expect(codes(water("w", AT, { ml: 0 }))).toEqual(["ml:not_positive"]);
    expect(codes(water("w", AT, { ml: -5 }))).toEqual(["ml:not_positive"]);
    expect(codes(water("w", AT, { ml: Number.NaN }))).toEqual(["ml:invalid_value"]);
    expect(codes(water("w", AT, { ml: "250" as never }))).toEqual(["ml:invalid_value"]);
    expect(codes({ ...water("w", AT, { ml: 1 }), ml: undefined })).toEqual(["ml:required"]);
  });

  it("drink", () => {
    expect(
      validateDiaryEvent(drink("d", AT, { name: "Birra", ml: 330, alcoholG: 13 })),
    ).toEqual([]);
    expect(
      validateDiaryEvent(drink("d", AT, { name: "Acqua tonica", ml: 200, caffeineMg: 0 })),
    ).toEqual([]);
    expect(codes(drink("d", AT, { name: "", ml: 0, caffeineMg: -1, alcoholG: -2 }))).toEqual([
      "name:invalid_type",
      "ml:not_positive",
      "caffeineMg:negative",
      "alcoholG:negative",
    ]);
  });

  it("weight", () => {
    expect(validateDiaryEvent(weight("k", AT, { kg: 70.5 }))).toEqual([]);
    expect(codes(weight("k", AT, { kg: 0 }))).toEqual(["kg:not_positive"]);
    expect(codes(weight("k", AT, { kg: Infinity }))).toEqual(["kg:invalid_value"]);
  });

  it("mood", () => {
    for (const score of [1, 2, 3, 4, 5]) {
      expect(validateDiaryEvent(mood("o", AT, { score }))).toEqual([]);
    }
    for (const score of [0, 6, 2.5, "3", Number.NaN]) {
      expect(codes(mood("o", AT, { score: score as never }))).toEqual(["score:invalid_value"]);
    }
    expect(codes({ ...mood("o", AT, { score: 3 }), score: undefined })).toEqual(["score:required"]);
    expect(codes(mood("o", AT, { score: 3, tags: "x" as never }))).toEqual(["tags:invalid_type"]);
    expect(codes(mood("o", AT, { score: 3, tags: ["ok", ""] }))).toEqual(["tags.1:invalid_type"]);
  });

  it("symptom", () => {
    for (const kind of ["digestion", "energy", "sleep", "other"] as const) {
      expect(validateDiaryEvent(symptom("s", AT, { kind, score: 3 }))).toEqual([]);
    }
    expect(codes(symptom("s", AT, { kind: "mal di testa" as never, score: 9 }))).toEqual([
      "kind:invalid_value",
      "score:invalid_value",
    ]);
    expect(codes(symptom("s", AT, { kind: "other", score: 3, label: 1 as never }))).toEqual([
      "label:invalid_type",
    ]);
  });

  it("supplement", () => {
    expect(validateDiaryEvent(supplement("p", AT, { name: "Magnesio" }))).toEqual([]);
    expect(codes(supplement("p", AT, { name: " " }))).toEqual(["name:invalid_type"]);
    expect(
      codes(supplement("p", AT, { name: "Mg", dose: 2 as never, lotId: 7 as never })),
    ).toEqual(["dose:invalid_type", "lotId:invalid_type"]);
  });

  it("habit", () => {
    const ok = { habitId: "h", title: "Solita colazione", kind: "breakfast" };
    const make = (extra: Record<string, unknown>) =>
      habit("a", AT, { ...ok, items: [], ...extra } as never);
    expect(validateDiaryEvent(make({ items: [item] }))).toEqual([]);
    expect(validateDiaryEvent(make({ usualTime: "00:00", archived: true }))).toEqual([]);
    for (const usualTime of ["24:00", "7:30", "07:60", "0730", ""]) {
      expect(codes(make({ usualTime }))).toEqual(["usualTime:invalid_value"]);
    }
    expect(codes({ ...make({}), items: undefined })).toEqual(["items:required"]);
    expect(codes(make({ archived: "sì" }))).toEqual(["archived:invalid_type"]);
    expect(codes({ ...make({}), habitId: undefined, title: undefined })).toEqual([
      "habitId:required",
      "title:required",
    ]);
  });

  it("non lancia mai su valori strani", () => {
    const cyclic: Record<string, unknown> = { type: "water" };
    cyclic.self = cyclic;
    for (const v of [undefined, 1, "x", cyclic, { type: "meal", items: [null] }]) {
      expect(() => validateDiaryEvent(v)).not.toThrow();
      expect(validateDiaryEvent(v).length).toBeGreaterThan(0);
    }
  });
});

describe("limiti di plausibilità", () => {
  it("peso tra 1 e 500 kg", () => {
    for (const kg of [1, 1.5, 72.4, 500]) {
      expect(validateDiaryEvent(weight("k", AT, { kg }))).toEqual([]);
    }
    for (const kg of [0.5, 0.999, 500.1, 720, 7240]) {
      expect(codes(weight("k", AT, { kg }))).toEqual(["kg:invalid_value"]);
    }
    expect(codes(weight("k", AT, { kg: 0 }))).toEqual(["kg:not_positive"]);
    expect(codes(weight("k", AT, { kg: -70 }))).toEqual(["kg:not_positive"]);
  });

  it("acqua e bevande fino a 10 litri per evento", () => {
    expect(DIARY_LIMITS.volumeMlMax).toBe(10_000);
    expect(validateDiaryEvent(water("w", AT, { ml: 10_000 }))).toEqual([]);
    expect(codes(water("w", AT, { ml: 10_001 }))).toEqual(["ml:invalid_value"]);
    expect(codes(water("w", AT, { ml: 250_000 }))).toEqual(["ml:invalid_value"]);
    expect(validateDiaryEvent(drink("d", AT, { name: "Tè", ml: 10_000 }))).toEqual([]);
    expect(codes(drink("d", AT, { name: "Tè", ml: 10_001 }))).toEqual(["ml:invalid_value"]);
  });

  it("caffeina fino a 2000 mg e alcol fino a 500 g per evento", () => {
    expect(
      validateDiaryEvent(drink("d", AT, { name: "x", ml: 100, caffeineMg: 2000, alcoholG: 500 })),
    ).toEqual([]);
    expect(codes(drink("d", AT, { name: "x", ml: 100, caffeineMg: 2000.5 }))).toEqual([
      "caffeineMg:invalid_value",
    ]);
    expect(codes(drink("d", AT, { name: "x", ml: 100, alcoholG: 501 }))).toEqual([
      "alcoholG:invalid_value",
    ]);
    expect(
      codes(drink("d", AT, { name: "x", ml: 100, caffeineMg: 63000, alcoholG: 1300 })),
    ).toEqual(["caffeineMg:invalid_value", "alcoholG:invalid_value"]);
  });

  it("punteggi interi da 1 a 5", () => {
    for (const score of [0, 6, 1.5, -1, Number.NaN, Infinity]) {
      expect(codes(mood("o", AT, { score }))).toEqual(["score:invalid_value"]);
      expect(codes(symptom("s", AT, { kind: "sleep", score }))).toEqual(["score:invalid_value"]);
    }
    for (const score of [1, 5]) {
      expect(validateDiaryEvent(symptom("s", AT, { kind: "sleep", score }))).toEqual([]);
    }
  });
});
