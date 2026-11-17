// Convivenza con eventi di altri moduli (diario) nello stesso registro.
import { describe, expect, it } from "vitest";
import { derivePantry } from "./derive";
import { mergeEventLists, mergeEvents } from "./merge";
import {
  adjust,
  consume,
  purchase,
  q,
  seededRandom,
  shuffled,
  voidOf,
} from "./test-helpers";
import { EVENT_TYPES, PANTRY_EVENT_TYPES, isPantryEvent, type LedgerEvent } from "./types";
import { validateEnvelope, validateEvent } from "./validate";

const T = (h: number, m = 0) =>
  `2026-03-10T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

const envelope = (id: string, type: string, at: string, extra: Record<string, unknown> = {}) => ({
  id,
  type,
  at,
  recordedAt: at,
  deviceId: "dev-a",
  schemaVersion: 1,
  certainty: "measured",
  source: "manual",
  ...extra,
});

interface DiaryEvent {
  id: string;
  type: string;
  at: string;
  recordedAt: string;
  kcal?: unknown;
}

const pantry: LedgerEvent[] = [
  purchase("p1", T(8), {
    lotId: "L1",
    productRef: "latte",
    quantity: q(1000, "ml"),
    location: "frigo",
  }),
  consume("c1", T(9), { lotId: "L1", quantity: q(300, "ml") }),
  consume("c2", T(10), { lotId: "L1", quantity: q(5000, "ml") }), // consumo eccessivo
  consume("c3", T(11), { lotId: "NOPE", quantity: q(1) }), // lotto sconosciuto
  adjust("a1", T(12), { lotId: "L1", remaining: q(500, "ml") }),
  voidOf("v1", T(13), "c1"),
];

const foreign = [
  envelope("m1", "meal", T(9), { items: [{ food: "pasta", grams: 80 }] }),
  envelope("w1", "water", T(9, 30), { ml: 250 }),
  envelope("kg1", "weight", T(7), { kg: 71.2 }),
  envelope("mood1", "mood", T(20), { score: 4 }),
  envelope("sup1", "supplement", T(8, 30)),
  { type: "meal" }, // senza id e senza il resto: ignorato lo stesso
  { id: "bad", type: "water", at: 5, ml: BigInt(3) }, // non valido e non serializzabile
];

describe("tipi di evento della dispensa", () => {
  it("PANTRY_EVENT_TYPES comprende tutti i tipi, void incluso", () => {
    expect([...PANTRY_EVENT_TYPES].sort()).toEqual([...EVENT_TYPES].sort());
    expect(PANTRY_EVENT_TYPES).toContain("void");
    expect(PANTRY_EVENT_TYPES).toContain("purchase");
  });

  it("isPantryEvent guarda solo il tipo", () => {
    expect(isPantryEvent(pantry[0])).toBe(true);
    expect(isPantryEvent({ type: "void" })).toBe(true);
    expect(isPantryEvent({ type: "meal" })).toBe(false);
    expect(isPantryEvent({ type: 3 })).toBe(false);
    for (const v of [null, undefined, 5, "purchase", [], {}]) expect(isPantryEvent(v)).toBe(false);
  });
});

describe("derivePantry ignora gli eventi di altri moduli", () => {
  it("non cambiano lo stato né le anomalie, con permutazioni casuali", () => {
    const alone = derivePantry(pantry);
    expect(alone.anomalies.map((a) => a.code).sort()).toEqual(["over_consumption", "unknown_lot"]);
    const mixed = [...pantry, ...foreign];
    expect(derivePantry(mixed)).toEqual(alone);
    const random = seededRandom(77);
    for (let i = 0; i < 20; i++) {
      expect(derivePantry(shuffled(mixed, random))).toEqual(alone);
    }
  });

  it("senza eventi della dispensa lo stato è vuoto e senza anomalie", () => {
    expect(derivePantry(foreign)).toEqual({ lots: [], anomalies: [], voidedEventIds: [] });
  });

  it("un type non stringa o assente resta una voce non valida", () => {
    const state = derivePantry([{ id: "x", type: 5 }, { id: "y" }] as unknown[]);
    expect(state.anomalies.map((a) => a.code)).toEqual(["invalid_event", "invalid_event"]);
  });

  it("un void di un evento di altro tipo presente: nessuna anomalia, annullamento registrato", () => {
    const v = voidOf("v9", T(21), "m1");
    const state = derivePantry([...pantry, ...foreign, v]);
    expect(state.anomalies.filter((a) => a.code === "void_target_missing")).toEqual([]);
    expect(state.voidedEventIds).toEqual(["c1", "m1"]);
    expect(state.lots).toEqual(derivePantry(pantry).lots);
  });

  it("un void di un id assente segnala ancora il bersaglio mancante", () => {
    const v = voidOf("v9", T(21), "ghost");
    expect(derivePantry([v, ...foreign]).anomalies).toEqual([
      { code: "void_target_missing", eventId: "v9", targetEventId: "ghost" },
    ]);
  });
});

describe("mergeEvents con validate personalizzato", () => {
  const isValidDiary = (e: unknown) =>
    typeof e === "object" && e !== null && Number.isFinite((e as DiaryEvent).kcal);

  const good: DiaryEvent = { id: "m1", type: "meal", at: T(9), recordedAt: T(9, 1), kcal: 500 };
  const corrupt: DiaryEvent = { ...good, recordedAt: T(20), kcal: "tanta" };

  it("la versione valida per quella funzione batte la più recente non valida", () => {
    const ab = mergeEvents([good], [corrupt], { validate: isValidDiary });
    const ba = mergeEvents([corrupt], [good], { validate: isValidDiary });
    expect(ab.events).toEqual([good]);
    expect(ba.events).toEqual([good]);
    expect(ab.conflicts).toEqual([{ id: "m1", kept: good, discarded: [corrupt] }]);
    // senza validate, per eventi non della dispensa vale la più recente
    expect(mergeEvents([good], [corrupt]).events).toEqual([corrupt]);
  });

  it("una validate che lancia vale come non valida", () => {
    const throwing = (e: unknown) => {
      if ((e as DiaryEvent).kcal === "tanta") throw new Error("boom");
      return true;
    };
    expect(mergeEvents([good], [corrupt], { validate: throwing }).events).toEqual([good]);
  });

  it("senza validate il comportamento per la dispensa è invariato", () => {
    const bad = { ...pantry[1], recordedAt: T(23), quantity: q(-1, "ml") } as LedgerEvent;
    expect(mergeEvents([pantry[1]], [bad]).events).toEqual([pantry[1]]);
    expect(mergeEvents([pantry[1]], [bad], {}).events).toEqual([pantry[1]]);
  });

  it("idempotente, commutativa e associativa su permutazioni, con eventi misti", () => {
    const versions: DiaryEvent[] = [
      good,
      corrupt,
      { ...good, recordedAt: T(22), kcal: 450 },
      { ...good, recordedAt: T(23), kcal: NaN },
      { id: "m2", type: "meal", at: T(12), recordedAt: T(12), kcal: 300 },
      { id: "m2", type: "meal", at: T(12), recordedAt: T(13), kcal: "x" },
      { id: "w1", type: "water", at: T(10), recordedAt: T(10), kcal: 0 },
    ];
    const validate = isValidDiary;
    const reference = mergeEventLists([versions], { validate }).events;
    expect(reference.find((e) => e.id === "m1")).toMatchObject({ kcal: 450 });
    expect(reference.find((e) => e.id === "m2")).toMatchObject({ kcal: 300 });
    const random = seededRandom(123);
    for (let i = 0; i < 25; i++) {
      const s = shuffled(versions, random);
      const i1 = Math.floor(random() * s.length);
      const i2 = i1 + Math.floor(random() * (s.length - i1));
      const [a, b, c] = [s.slice(0, i1), s.slice(i1, i2), s.slice(i2)];
      const opts = { validate };
      expect(mergeEvents(mergeEvents(a, b, opts).events, c, opts).events).toEqual(reference);
      expect(mergeEvents(a, mergeEvents(b, c, opts).events, opts).events).toEqual(reference);
      expect(mergeEvents(c, mergeEvents(b, a, opts).events, opts).events).toEqual(reference);
      expect(mergeEvents(reference, reference, opts).events).toEqual(reference);
    }
  });
});

describe("validateEnvelope", () => {
  const ok = envelope("m1", "meal", T(9), { note: "colazione", replaces: "m0", anything: { a: 1 } });

  it("accetta la busta di un tipo qualsiasi e ignora il resto dei campi", () => {
    expect(validateEnvelope(ok)).toEqual([]);
    expect(validateEnvelope(envelope("x", "qualcosa-di-nuovo", T(1), { note: "" }))).toEqual([]);
    // la validazione completa della dispensa non lo accetta: tipo sconosciuto
    expect(validateEvent(ok)).toEqual([{ path: "type", code: "invalid_value" }]);
  });

  it("segnala gli errori della busta", () => {
    const { id: _id, at: _at, ...rest } = ok;
    void [_id, _at];
    expect(validateEnvelope(rest).map((e) => `${e.path}:${e.code}`).sort()).toEqual([
      "at:required",
      "id:required",
    ]);
    const paths = (e: unknown) => validateEnvelope(e).map((x) => `${x.path}:${x.code}`);
    expect(paths({ ...ok, at: "ieri" })).toEqual(["at:invalid_instant"]);
    expect(paths({ ...ok, recordedAt: "2026-02-30T10:00:00.000Z" })).toEqual([
      "recordedAt:invalid_instant",
    ]);
    expect(paths({ ...ok, schemaVersion: 2 })).toEqual(["schemaVersion:invalid_value"]);
    expect(paths({ ...ok, certainty: "boh", source: "x" })).toEqual([
      "certainty:invalid_value",
      "source:invalid_value",
    ]);
    expect(paths({ ...ok, deviceId: "" })).toEqual(["deviceId:invalid_type"]);
    expect(paths({ ...ok, note: 3, replaces: 4 })).toEqual([
      "note:invalid_type",
      "replaces:invalid_type",
    ]);
    expect(paths({ ...ok, type: undefined })).toEqual(["type:required"]);
    expect(paths({ ...ok, type: "" })).toEqual(["type:invalid_type"]);
    expect(paths({ ...ok, type: 7 })).toEqual(["type:invalid_type"]);
  });

  it("non lancia su input non oggetto", () => {
    for (const v of [null, undefined, 3, "x", []]) {
      expect(validateEnvelope(v)).toEqual([{ path: "", code: "not_an_object" }]);
    }
  });

  it("validateEvent resta coerente con la busta per gli eventi della dispensa", () => {
    const e = { ...pantry[0], certainty: "boh", note: 4 };
    const env = validateEnvelope(e);
    expect(validateEvent(e).filter((x) => env.some((y) => y.path === x.path))).toEqual(env);
  });
});
