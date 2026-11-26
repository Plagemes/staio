import { describe, expect, it } from "vitest";
import { missingFor, type ExpandRef, type StockLine } from "./index";
import { food, prepEntry, recipe } from "./test-helpers";

const D = "2026-03-10";

const expand: ExpandRef = (ref, servings) => {
  if (ref.kind === "recipe" && ref.id === "ragu") {
    return [
      { name: "Carne macinata", quantity: { value: 100 * servings, unit: "g" } },
      { name: "Passata", foodId: "passata", quantity: { value: 50 * servings, unit: "ml" } },
    ];
  }
  if (ref.kind === "recipe" && ref.id === "pasta") {
    return [
      { name: "Pasta", quantity: { value: 80 * servings, unit: "g" } },
      { name: "Passata", quantity: { value: 100 * servings, unit: "ml" } },
    ];
  }
  if (ref.kind === "prep" && ref.id === "zuppa") {
    return [
      { name: "Lenticchie", quantity: { value: 40 * servings, unit: "g" } },
      { name: "Carote", quantity: { value: 30 * servings, unit: "g" } },
    ];
  }
  return undefined;
};

const stock = (...lines: [string, number, StockLine["unit"]][]): StockLine[] => lines.map(([name, quantity, unit]) => ({ name, quantity, unit }));

describe("missingFor", () => {
  it("nessuna voce: nessun risultato", () => {
    expect(missingFor([], { expand, stock: [] })).toEqual({ lines: [], covered: [], unresolved: [] });
  });

  it("pasta 500 g in dispensa e 80 g nel piano: coperta, e dice che c'è già", () => {
    const r = missingFor([food(D, "lunch", "Pasta", 80)], { expand, stock: stock(["Pasta", 500, "g"]) });
    expect(r.lines).toEqual([]);
    expect(r.covered.map((l) => [l.name, l.needed, l.have, l.missing])).toEqual([["Pasta", 80, 500, 0]]);
  });

  it("nessuna conversione: pasta in pezzi in dispensa e in grammi nel piano è mancante, con le quantità", () => {
    const r = missingFor([food(D, "lunch", "Pasta", 80)], { expand, stock: stock(["Pasta", 2, "pz"]) });
    expect(r.covered).toEqual([]);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ name: "Pasta", unit: "g", needed: 80, have: 0, missing: 80 });
  });

  it("il nome si piega: maiuscole, accenti e spazi non contano", () => {
    const r = missingFor([food(D, "lunch", "  Caffè  ", 10)], { expand, stock: stock(["caffe", 250, "g"]) });
    expect(r.lines).toEqual([]);
    expect(r.covered).toHaveLength(1);
  });

  it("una ricetta chiede i suoi ingredienti per le porzioni; la dispensa copre in parte", () => {
    const r = missingFor([recipe(D, "dinner", "ragu", 2)], { expand, stock: stock(["Carne macinata", 120, "g"]) });
    expect(r.lines.map((l) => [l.name, l.needed, l.have, l.missing])).toEqual([
      ["Carne macinata", 200, 120, 80],
      ["Passata", 100, 0, 100],
    ]);
    expect(r.lines[1].foodId).toBe("passata");
  });

  it("somma lo stesso ingrediente su più voci, con i nomi di chi lo chiede", () => {
    const r = missingFor([recipe(D, "lunch", "ragu", 1), recipe(D, "dinner", "pasta", 1), food(D, "dinner", "passata", 25, "ml")], {
      expand,
      stock: [],
      nameOf: (item) => (item.kind === "recipe" ? `ricetta ${item.recipeId}` : item.kind === "food" ? item.name : "prep"),
    });
    const passata = r.lines.find((l) => l.name.toLowerCase() === "passata");
    expect(passata).toMatchObject({ needed: 175, unit: "ml" });
    expect(passata?.for).toEqual(["ricetta ragu", "ricetta pasta", "passata"]);
  });

  it("ordina i mancanti per nome", () => {
    const r = missingFor([food(D, "lunch", "Zucchine", 100), food(D, "lunch", "Aglio", 5), food(D, "lunch", "Basilico", 5)], { expand, stock: [] });
    expect(r.lines.map((l) => l.name)).toEqual(["Aglio", "Basilico", "Zucchine"]);
  });

  it("la stessa quantità con unità diverse resta in righe diverse", () => {
    const r = missingFor([food(D, "lunch", "Latte", 200, "ml"), food(D, "dinner", "Latte", 1, "pz")], { expand, stock: [] });
    expect(r.lines.map((l) => [l.unit, l.needed])).toEqual([
      ["ml", 200],
      ["pz", 1],
    ]);
  });

  it("ricetta ritirata: non si sa che cosa serve, e le altre voci contano lo stesso", () => {
    const gone = recipe(D, "dinner", "sparita", 2);
    const r = missingFor([gone, food(D, "dinner", "Insalata", 100)], { expand, stock: [] });
    expect(r.unresolved).toEqual([gone]);
    expect(r.lines.map((l) => l.name)).toEqual(["Insalata"]);
  });

  it("preparazione con porzioni pronte quante le pianificate: coperta, nessun ingrediente", () => {
    const r = missingFor([prepEntry(D, "dinner", "zuppa", 2)], { expand, stock: [], portionsLeft: () => 2 });
    expect(r).toEqual({ lines: [], covered: [], unresolved: [] });
  });

  it("preparazione con una porzione pronta su due: mancano gli ingredienti di una", () => {
    const r = missingFor([prepEntry(D, "dinner", "zuppa", 2)], { expand, stock: [], portionsLeft: (id) => (id === "zuppa" ? 1 : 0) });
    expect(r.lines.map((l) => [l.name, l.needed])).toEqual([
      ["Carote", 30],
      ["Lenticchie", 40],
    ]);
  });

  it("preparazione senza porzioni pronte (o senza sapere): gli ingredienti di tutte", () => {
    const r = missingFor([prepEntry(D, "dinner", "zuppa", 2)], { expand, stock: [] });
    expect(r.lines.find((l) => l.name === "Lenticchie")?.needed).toBe(80);
  });

  it("due voci della stessa preparazione dividono le porzioni pronte", () => {
    const r = missingFor([prepEntry(D, "lunch", "zuppa", 1), prepEntry(D, "dinner", "zuppa", 1)], { expand, stock: [], portionsLeft: () => 1 });
    expect(r.lines.find((l) => l.name === "Lenticchie")?.needed).toBe(40);
  });

  it("preparazione sparita e senza porzioni pronte: non risolta", () => {
    const gone = prepEntry(D, "dinner", "mai-esistita", 2);
    const r = missingFor([gone], { expand, stock: [] });
    expect(r.unresolved).toEqual([gone]);
    expect(r.lines).toEqual([]);
  });

  it("gli ingredienti senza quantità non entrano", () => {
    const noQty: ExpandRef = () => [
      { name: "Sale", quantity: { value: 0, unit: "g" } },
      { name: "Riso", quantity: { value: 100, unit: "g" } },
    ];
    const r = missingFor([recipe(D, "lunch", "x", 1)], { expand: noQty, stock: [] });
    expect(r.lines.map((l) => l.name)).toEqual(["Riso"]);
    expect(r.covered).toEqual([]);
  });

  it("somma i lotti dello stesso prodotto nella scorta", () => {
    const r = missingFor([food(D, "lunch", "Riso", 300)], { expand, stock: stock(["Riso", 200, "g"], ["riso", 150, "g"]) });
    expect(r.lines).toEqual([]);
    expect(r.covered[0].have).toBe(350);
  });
});
