import { describe, expect, it } from "vitest";
import { canonicalStringify, compareEvents, mergeEventLists, mergeEvents } from "./merge";
import {
  consume,
  open,
  purchase,
  q,
  seededRandom,
  shuffled,
  voidOf,
} from "./test-helpers";
import type { LedgerEvent } from "./types";

const T = (h: number) => `2026-03-10T${String(h).padStart(2, "0")}:00:00.000Z`;

const e1 = purchase("e1", T(8), {
  lotId: "L1",
  productRef: "latte",
  quantity: q(1000, "ml"),
  location: "frigo",
});
const e2 = consume("e2", T(9), { lotId: "L1", quantity: q(100, "ml") });
const e3 = open("e3", T(10), { lotId: "L1" });
const e4 = voidOf("e4", T(11), "e2");
const e5 = consume("e5", T(9), { lotId: "L1", quantity: q(50, "ml") });

describe("mergeEvents", () => {
  it("unisce per id ed è idempotente", () => {
    const a = [e1, e2];
    const b = [e2, e3];
    const m = mergeEvents(a, b);
    expect(m.events.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
    expect(m.conflicts).toEqual([]);
    expect(mergeEvents(m.events, m.events).events).toEqual(m.events);
    expect(mergeEvents(a, a).events).toEqual(mergeEvents(a, []).events);
  });

  it("è commutativa", () => {
    const a = [e1, e5, e3];
    const b = [e2, e4, e1];
    expect(mergeEvents(a, b).events).toEqual(mergeEvents(b, a).events);
  });

  it("è associativa", () => {
    const a = [e1, e3];
    const b = [e2, e5];
    const c = [e4, e1];
    const left = mergeEvents(mergeEvents(a, b).events, c).events;
    const right = mergeEvents(a, mergeEvents(b, c).events).events;
    expect(left).toEqual(right);
    expect(left).toEqual(mergeEventLists([a, b, c]).events);
  });

  it("commutativa/associativa/idempotente anche con conflitti, su permutazioni casuali", () => {
    const e2alt = { ...e2, recordedAt: T(12), quantity: q(999, "ml") } as LedgerEvent;
    const e2alt2 = { ...e2, note: "altro" } as LedgerEvent;
    const pool = [e1, e2, e2alt, e2alt2, e3, e4, e5];
    const random = seededRandom(99);
    const reference = mergeEventLists([pool]).events;
    for (let i = 0; i < 25; i++) {
      const s = shuffled(pool, random);
      const i1 = Math.floor(random() * s.length);
      const i2 = i1 + Math.floor(random() * (s.length - i1));
      const [a, b, c] = [s.slice(0, i1), s.slice(i1, i2), s.slice(i2)];
      expect(mergeEvents(mergeEvents(a, b).events, c).events).toEqual(reference);
      expect(mergeEvents(c, mergeEvents(b, a).events).events).toEqual(reference);
    }
  });

  it("stesso id con contenuti diversi: sceglie il registrato più tardi e segnala", () => {
    const later = { ...e2, recordedAt: T(12), quantity: q(999, "ml") } as LedgerEvent;
    const ab = mergeEvents([e2], [later]);
    const ba = mergeEvents([later], [e2]);
    expect(ab.events).toEqual([later]);
    expect(ba.events).toEqual([later]);
    expect(ab.conflicts).toEqual([{ id: "e2", kept: later, discarded: [e2] }]);
    expect(ba.conflicts).toEqual(ab.conflicts);
  });

  it("a parità di recordedAt decide il contenuto canonico, in modo indipendente dall'ordine", () => {
    const x = { ...e2, note: "a" } as LedgerEvent;
    const y = { ...e2, note: "b" } as LedgerEvent;
    expect(mergeEvents([x], [y]).events).toEqual(mergeEvents([y], [x]).events);
  });

  it("restituisce gli eventi in ordine canonico (at, recordedAt, id)", () => {
    const m = mergeEvents([e3, e2], [e5, e1]);
    expect(m.events.map((e) => e.id)).toEqual(["e1", "e2", "e5", "e3"]);
  });
});

describe("compareEvents / canonicalStringify", () => {
  it("l'ordine di chiavi non cambia la forma canonica; undefined è ignorato", () => {
    expect(canonicalStringify({ b: 1, a: { d: undefined, c: [1, undefined] } })).toBe(
      canonicalStringify({ a: { c: [1, null] }, b: 1 }),
    );
  });

  it("ordina per istante numerico e poi per id", () => {
    expect(compareEvents(e1, e2)).toBeLessThan(0);
    expect(compareEvents(e2, e5)).toBeLessThan(0); // stesso istante: id
    expect(compareEvents(e2, e2)).toBe(0);
  });
});
