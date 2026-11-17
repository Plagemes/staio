import { describe, expect, it } from "vitest";
import { computeNeeds, coverPrepUses, derivePlan, getWeek, type ExpandRef } from "./index";
import { prepEntry, weekEv } from "./test-helpers";

const T = "2026-03-01T10:00:00.000Z";

const weekOf = (entries: Parameters<typeof weekEv>[3]) =>
  getWeek(derivePlan([weekEv("w", T, "2026-03-09", entries)]), "2026-03-09");

const expand: ExpandRef = (ref, servings) =>
  ref.kind === "prep" && ref.id === "zuppa"
    ? [
        { name: "Lenticchie", quantity: { value: 40 * servings, unit: "g" } },
        { name: "Carote", quantity: { value: 30 * servings, unit: "g" } },
      ]
    : undefined;

const week = () =>
  weekOf([
    prepEntry("2026-03-10", "lunch", "zuppa", 2),
    prepEntry("2026-03-11", "lunch", "zuppa", 1),
    prepEntry("2026-03-13", "lunch", "zuppa", 2),
  ]);

describe("fabbisogni con porzioni già pronte", () => {
  it("senza porzioni esistenti il risultato è invariato e la copertura è zero", () => {
    const r = computeNeeds(week(), { expand, portionLifeDays: () => 10 });
    expect(r.coveredPortions).toEqual([{ prepId: "zuppa", needed: 5, covered: 0, toCook: 5, uses: [] }]);
    expect(r.lines.map((l) => [l.date, l.product, l.quantity.value])).toEqual([
      ["2026-03-10", "Carote", 150],
      ["2026-03-10", "Lenticchie", 200],
    ]);
  });

  it("usa prima le porzioni esistenti e chiede ingredienti solo per quelle mancanti", () => {
    const r = computeNeeds(week(), {
      expand,
      portionLifeDays: () => 10,
      existingPortions: [{ prepId: "zuppa", remaining: 3, goodUntil: "2026-03-20", lotId: "lot-1" }],
    });
    expect(r.coveredPortions).toEqual([
      {
        prepId: "zuppa",
        needed: 5,
        covered: 3,
        toCook: 2,
        uses: [
          { date: "2026-03-10", meal: "lunch", servings: 2, lotId: "lot-1" },
          { date: "2026-03-11", meal: "lunch", servings: 1, lotId: "lot-1" },
        ],
      },
    ]);
    expect(r.lines.map((l) => [l.date, l.product, l.quantity.value])).toEqual([
      ["2026-03-13", "Carote", 60],
      ["2026-03-13", "Lenticchie", 80],
    ]);
  });

  it("coperte del tutto: nessun ingrediente e nessuna voce non risolta, anche senza espansione", () => {
    const r = computeNeeds(week(), { existingPortions: [{ prepId: "zuppa", remaining: 10 }] });
    expect(r.lines).toEqual([]);
    expect(r.unresolved).toEqual([]);
    expect(r.coveredPortions[0]).toMatchObject({ covered: 5, toCook: 0 });
  });

  it("compatibilmente con la scadenza: oltre l'ultimo giorno buono non si usano", () => {
    const r = computeNeeds(week(), {
      expand,
      portionLifeDays: () => 10,
      existingPortions: [{ prepId: "zuppa", remaining: 10, goodUntil: "2026-03-11" }],
    });
    expect(r.coveredPortions[0]).toMatchObject({ covered: 3, toCook: 2 });
    expect(r.lines.map((l) => l.date)).toEqual(["2026-03-13", "2026-03-13"]);
  });

  it("prima quelle che scadono prima; scadenza ignota per ultima", () => {
    const w = weekOf([prepEntry("2026-03-10", "lunch", "zuppa", 2), prepEntry("2026-03-12", "lunch", "zuppa", 2)]);
    const r = computeNeeds(w, {
      expand,
      existingPortions: [
        { prepId: "zuppa", remaining: 2, lotId: "senza" },
        { prepId: "zuppa", remaining: 2, goodUntil: "2026-03-12", lotId: "b" },
        { prepId: "zuppa", remaining: 1, goodUntil: "2026-03-10", lotId: "a" },
      ],
    });
    expect(r.coveredPortions[0].uses.map((u) => [u.date, u.servings, u.lotId])).toEqual([
      ["2026-03-10", 1, "a"],
      ["2026-03-10", 1, "b"],
      ["2026-03-12", 1, "b"],
      ["2026-03-12", 1, "senza"],
    ]);
    expect(r.coveredPortions[0].toCook).toBe(0);
  });

  it("porzioni di un'altra preparazione, vuote o non valide non contano", () => {
    const r = computeNeeds(week(), {
      expand,
      existingPortions: [
        { prepId: "altra", remaining: 9 },
        { prepId: "zuppa", remaining: 0 },
        { prepId: "zuppa", remaining: Number.NaN },
      ],
    });
    expect(r.coveredPortions[0].covered).toBe(0);
  });

  it("porzioni frazionarie e indipendenza dall'ordine dei lotti", () => {
    const stocks = [
      { prepId: "zuppa", remaining: 0.5, goodUntil: "2026-03-30", lotId: "x" },
      { prepId: "zuppa", remaining: 1.25, goodUntil: "2026-03-30", lotId: "y" },
    ];
    const a = computeNeeds(week(), { expand, existingPortions: stocks });
    const b = computeNeeds(week(), { expand, existingPortions: [...stocks].reverse() });
    expect(b).toEqual(a);
    expect(a.coveredPortions[0]).toMatchObject({ covered: 1.75, toCook: 3.25 });
  });

  it("coverPrepUses senza settimana è vuoto", () => {
    expect(coverPrepUses(undefined, [{ prepId: "zuppa", remaining: 3 }])).toEqual([]);
  });
});
