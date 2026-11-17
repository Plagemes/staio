import { describe, expect, it } from "vitest";
import { correct, voidEvent } from "./correct";
import { derivePantry } from "./derive";
import { createIdGenerator, generateId } from "./ids";
import { consume, purchase, q } from "./test-helpers";
import { validateEvent } from "./validate";

const T = (h: number) => `2026-03-10T${String(h).padStart(2, "0")}:00:00.000Z`;

const buy = purchase("p1", T(8), {
  lotId: "L1",
  productRef: "latte",
  quantity: q(1000, "ml"),
  location: "frigo",
});
const eat = consume("c1", T(9), { lotId: "L1", quantity: q(500, "ml") });

function fixedOptions() {
  let n = 0;
  return {
    idGenerator: () => `gen${++n}`,
    now: () => T(12),
    deviceId: "dev-b",
  };
}

describe("correct", () => {
  it("produce la coppia void + nuovo evento e lo stato derivato è quello corretto", () => {
    const [v, next] = correct(
      eat,
      { type: "consume", lotId: "L1", quantity: q(200, "ml"), certainty: "measured", source: "manual" },
      fixedOptions(),
    );
    expect(v).toMatchObject({
      type: "void",
      id: "gen1",
      targetEventId: "c1",
      deviceId: "dev-b",
      at: T(12),
      recordedAt: T(12),
      schemaVersion: 1,
    });
    expect(next).toMatchObject({
      type: "consume",
      id: "gen2",
      at: T(9), // eredita l'istante dell'evento corretto
      recordedAt: T(12),
      deviceId: "dev-b",
      schemaVersion: 1,
    });
    expect(validateEvent(v)).toEqual([]);
    expect(validateEvent(next)).toEqual([]);

    const state = derivePantry([buy, eat, v, next]);
    expect(state.lots[0].remaining).toBe(800);
    expect(state.anomalies).toEqual([]);
    expect(state.voidedEventIds).toEqual(["c1"]);
  });

  it("correggere un acquisto mantenendo il lotId non crea duplicati", () => {
    const [v, next] = correct(
      buy,
      {
        type: "purchase",
        lotId: "L1",
        productRef: "latte intero",
        quantity: q(1500, "ml"),
        location: "frigo",
        certainty: "label",
        source: "manual",
      },
      fixedOptions(),
    );
    const state = derivePantry([buy, eat, v, next]);
    expect(state.anomalies).toEqual([]);
    expect(state.lots).toHaveLength(1);
    expect(state.lots[0]).toMatchObject({ productRef: "latte", initial: 1500, remaining: 1000 });
  });

  it("usa i valori espliciti del nuovo evento e, in mancanza, il dispositivo del bersaglio", () => {
    const [, next] = correct(
      eat,
      {
        type: "consume",
        id: "mine",
        at: T(10),
        recordedAt: T(11),
        lotId: "L1",
        quantity: q(1, "ml"),
        certainty: "measured",
        source: "manual",
      },
      { now: () => T(12), idGenerator: () => "x" },
    );
    expect(next).toMatchObject({ id: "mine", at: T(10), recordedAt: T(11), deviceId: "dev-a" });
  });

  it("rifiuta un nuovo evento con lo stesso id del vecchio", () => {
    expect(() =>
      correct(eat, { ...eat, id: "c1" }, fixedOptions()),
    ).toThrow(RangeError);
  });
});

describe("voidEvent", () => {
  it("annullare un void ripristina l'evento originale", () => {
    const v1 = voidEvent(eat, { ...fixedOptions() });
    const v2 = voidEvent(v1, { idGenerator: () => "gen9", now: () => T(13) });
    expect(v2.targetEventId).toBe(v1.id);
    expect(derivePantry([buy, eat, v1]).lots[0].remaining).toBe(1000);
    expect(derivePantry([buy, eat, v1, v2]).lots[0].remaining).toBe(500);
  });
});

describe("generatore di id", () => {
  it("è ordinabile nel tempo e senza collisioni nello stesso millisecondo", () => {
    let t = 1_800_000_000_000;
    const gen = createIdGenerator({ now: () => t, random: () => 0.5 });
    const same = [gen(), gen(), gen()];
    t += 1;
    const next = gen();
    const all = [...same, next];
    expect([...all].sort()).toEqual(all);
    expect(new Set(all).size).toBe(4);
  });

  it("non va mai indietro anche se l'orologio retrocede", () => {
    let t = 1_800_000_000_000;
    const gen = createIdGenerator({ now: () => t, random: () => 0 });
    const a = gen();
    t -= 5000;
    const b = gen();
    expect(b > a).toBe(true);
  });

  it("l'id predefinito è unico e ordinabile", () => {
    const ids = Array.from({ length: 500 }, () => generateId());
    expect(new Set(ids).size).toBe(500);
    expect([...ids].sort()).toEqual(ids);
  });
});
