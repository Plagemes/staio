import { describe, expect, it } from "vitest";
import { mainCandidates } from "./mainIngredient";

describe("mainCandidates", () => {
  it("salta sale, olio, acqua e simili, tenendo l'ordine scritto", () => {
    expect(mainCandidates([{ name: "Olio extravergine" }, { name: "Pomodori" }, { name: "Sale grosso" }, { name: "Basilico" }])).toEqual([1, 3]);
  });
  it("se sono tutti di base li tiene tutti", () => {
    expect(mainCandidates([{ name: "Acqua" }, { name: "Sale" }])).toEqual([0, 1]);
  });
  it("senza ingredienti non c'è nulla", () => {
    expect(mainCandidates([])).toEqual([]);
  });
});
