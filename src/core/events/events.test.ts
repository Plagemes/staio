import { describe, expect, it } from "vitest";
import { EVENT_TYPES, mergeEvents, voidEvent } from "../ledger";
import { DIARY_EVENT_TYPES } from "../diary";
import {
  consume,
  drink,
  meal,
  purchase,
  sampleDiaryEvents,
  seededRandom,
  shuffled,
  voidOf,
  water,
  weight,
} from "../diary/test-helpers";
import { isKnownEvent, mergeAllEvents, validateAnyEvent, type AnyEvent } from "./index";

const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });
const codes = (e: unknown) => validateAnyEvent(e).map((x) => `${x.path}:${x.code}`);

const pantryEvents = (): AnyEvent[] => [
  purchase("pu1", "2026-03-10T06:00:00Z", {
    lotId: "lot-1",
    productRef: "latte",
    quantity: q(1000, "ml"),
    location: "frigo",
  }),
  consume("c1", "2026-03-10T07:31:00Z", { lotId: "lot-1", quantity: q(200, "ml"), mealId: "meal-1" }),
  voidOf("v1", "2026-03-10T08:00:00Z", "c1"),
];

describe("validateAnyEvent", () => {
  it("accetta un evento valido per ogni tipo di dispensa e di diario", () => {
    const diary = sampleDiaryEvents();
    expect(diary.map((e) => e.type).sort()).toEqual([...DIARY_EVENT_TYPES].sort());
    for (const e of diary) expect(validateAnyEvent(e)).toEqual([]);
    for (const e of pantryEvents()) expect(validateAnyEvent(e)).toEqual([]);
    expect(EVENT_TYPES).toContain("consume");
  });

  it("un void è valido per entrambi i domini, anche quando punta a un evento di diario", () => {
    expect(validateAnyEvent(voidOf("v", "2026-03-10T08:00:00Z", "w1"))).toEqual([]);
    const target = water("w1", "2026-03-10T08:00:00Z", { ml: 100 });
    expect(validateAnyEvent(voidEvent(target, { deviceId: "dev-a" }))).toEqual([]);
    expect(codes({ ...voidOf("v", "2026-03-10T08:00:00Z", "w1"), targetEventId: "" })).toEqual([
      "targetEventId:invalid_type",
    ]);
  });

  it("instrada ogni tipo al suo validatore", () => {
    expect(codes({ ...water("w", "2026-03-10T08:00:00Z", { ml: 100 }), ml: -1 })).toEqual([
      "ml:not_positive",
    ]);
    expect(codes({ ...consume("c", "2026-03-10T08:00:00Z", { lotId: "l", quantity: q(5) }), quantity: q(-1) })).toEqual([
      "quantity.value:not_positive",
    ]);
    // Un campo del diario su un tipo di dispensa (e viceversa) non salva l'evento.
    expect(codes({ ...water("w", "2026-03-10T08:00:00Z", { ml: 100 }), type: "consume" })).toEqual(
      expect.arrayContaining(["lotId:required", "quantity:required"]),
    );
  });

  it("un tipo sconosciuto o assente è un errore", () => {
    const base = water("w", "2026-03-10T08:00:00Z", { ml: 100 });
    expect(codes({ ...base, type: "sonno" })).toEqual(["type:invalid_value"]);
    expect(codes({ ...base, type: undefined })).toEqual(["type:required"]);
    expect(codes({ ...base, type: 7 })).toEqual(["type:invalid_value"]);
  });

  it("non lancia mai", () => {
    const cyclic: Record<string, unknown> = { type: "water" };
    cyclic.self = cyclic;
    expect(validateAnyEvent(null)).toEqual([{ path: "", code: "not_an_object" }]);
    expect(validateAnyEvent("x")).toEqual([{ path: "", code: "not_an_object" }]);
    for (const v of [undefined, BigInt(3), cyclic, () => 1]) {
      expect(() => validateAnyEvent(v)).not.toThrow();
      expect(validateAnyEvent(v).length).toBeGreaterThan(0);
    }
  });
});

describe("isKnownEvent", () => {
  it("riconosce dispensa, diario e void; non guarda la validità", () => {
    for (const e of [...sampleDiaryEvents(), ...pantryEvents()]) expect(isKnownEvent(e)).toBe(true);
    expect(isKnownEvent({ type: "water" })).toBe(true);
    expect(isKnownEvent({ type: "void" })).toBe(true);
    expect(isKnownEvent({ type: "sonno" })).toBe(false);
    expect(isKnownEvent({})).toBe(false);
    expect(isKnownEvent(null)).toBe(false);
    expect(isKnownEvent("water")).toBe(false);
  });
});

describe("mergeAllEvents", () => {
  const diary: AnyEvent[] = [
    meal("m1", "2026-03-10T07:30:00Z", { mealId: "meal-1", kind: "breakfast" }),
    water("w1", "2026-03-10T09:00:00Z", { ml: 250 }),
    weight("k1", "2026-03-10T06:30:00Z", { kg: 72.4 }),
    drink("d1", "2026-03-10T08:10:00Z", { name: "Espresso", ml: 30, caffeineMg: 63 }),
  ];
  const a: AnyEvent[] = [diary[0], diary[1], ...pantryEvents().slice(0, 2)];
  const b: AnyEvent[] = [diary[1], diary[2], pantryEvents()[1], pantryEvents()[2]];
  const c: AnyEvent[] = [diary[3], diary[0], pantryEvents()[0]];

  const ids = (events: readonly { id: string }[]) => events.map((e) => e.id);

  it("unisce eventi misti di dispensa e di diario per id, in ordine canonico", () => {
    const r = mergeAllEvents(a, b);
    expect(ids(r.events)).toEqual(["pu1", "k1", "m1", "c1", "v1", "w1"]);
    expect(r.conflicts).toEqual([]);
    expect(r.rejected).toEqual([]);
  });

  it("è idempotente", () => {
    const once = mergeAllEvents(a, b);
    expect(mergeAllEvents(once.events, once.events).events).toEqual(once.events);
    expect(mergeAllEvents(once.events, a).events).toEqual(once.events);
    expect(mergeAllEvents(a, a).events).toEqual(mergeAllEvents(a, []).events);
  });

  it("è commutativa", () => {
    expect(mergeAllEvents(a, b).events).toEqual(mergeAllEvents(b, a).events);
    expect(mergeAllEvents(a, c).events).toEqual(mergeAllEvents(c, a).events);
  });

  it("è associativa", () => {
    const left = mergeAllEvents(mergeAllEvents(a, b).events, c).events;
    const right = mergeAllEvents(a, mergeAllEvents(b, c).events).events;
    expect(left).toEqual(right);
    expect(left).toEqual(mergeAllEvents(mergeAllEvents(c, a).events, b).events);
  });

  it("vale anche con conflitti e voci non valide, su permutazioni casuali a seme fisso", () => {
    const good = water("x", "2026-03-10T10:00:00Z", { ml: 100 });
    const newerGood = { ...good, ml: 200, recordedAt: "2026-03-10T11:00:00Z" };
    const corrupt = { ...good, ml: -1, recordedAt: "2026-03-10T12:00:00Z" } as AnyEvent;
    const sameDiaryOldPantry = { ...consume("y", "2026-03-10T10:00:00Z", { lotId: "l", quantity: q(5) }) };
    const brokenPantry = { ...sameDiaryOldPantry, quantity: q(-5), recordedAt: "2026-03-10T13:00:00Z" } as AnyEvent;
    const all: AnyEvent[] = [
      ...a,
      ...b,
      ...c,
      good,
      newerGood,
      corrupt,
      sameDiaryOldPantry,
      brokenPantry,
      { id: "senza-resto" } as unknown as AnyEvent,
      "spazzatura" as unknown as AnyEvent,
    ];
    const expected = mergeAllEvents(all, []);
    expect(expected.conflicts.map((x) => x.id)).toEqual(["x", "y"]);
    expect(expected.rejected).toHaveLength(1);
    const random = seededRandom(424242);
    for (let i = 0; i < 40; i++) {
      const shuffledAll = shuffled(all, random);
      const cut = Math.floor(random() * shuffledAll.length);
      const left = shuffledAll.slice(0, cut);
      const right = shuffledAll.slice(cut);
      const merged = mergeAllEvents(left, right);
      expect(merged.events).toEqual(expected.events);
      expect(merged.rejected).toEqual(expected.rejected);
      expect(mergeAllEvents(right, left).events).toEqual(expected.events);
      expect(mergeAllEvents(merged.events, shuffledAll).events).toEqual(expected.events);
    }
  });

  it("tra versioni dello stesso id vince quella valida per il suo dominio, anche se più vecchia", () => {
    const good = water("x", "2026-03-10T10:00:00Z", { ml: 100 });
    const corrupt = { ...good, ml: -1, recordedAt: "2026-03-10T12:00:00Z" } as AnyEvent;
    const r = mergeAllEvents([corrupt], [good]);
    expect(r.events).toEqual([good]);
    expect(r.conflicts).toEqual([{ id: "x", kept: good, discarded: [corrupt] }]);

    // Il validatore predefinito della dispensa avrebbe scartato un evento di diario valido.
    const plain = mergeEvents([corrupt as never], [good as never]);
    expect(plain.events).not.toEqual([good]);
  });

  it("tra due versioni valide vince la registrata più tardi", () => {
    const old = water("x", "2026-03-10T10:00:00Z", { ml: 100 });
    const recent = { ...old, ml: 300, recordedAt: "2026-03-10T11:00:00Z" } as AnyEvent;
    expect(mergeAllEvents([old], [recent]).events).toEqual([recent]);
    expect(mergeAllEvents([recent], [old]).events).toEqual([recent]);
  });

  it("non modifica gli ingressi", () => {
    const left = [...a];
    const right = [...b];
    const snapshot = JSON.stringify([left, right]);
    mergeAllEvents(left, right);
    expect(JSON.stringify([left, right])).toBe(snapshot);
  });
});
