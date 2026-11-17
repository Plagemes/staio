import { describe, expect, it } from "vitest";
import { parseLine, parseManualLines, toManualItems } from "./manual";

describe("righe a mano", () => {
  it("legge quantità davanti o dietro al nome", () => {
    expect(parseLine("2 l latte")).toMatchObject({ product: "Latte", quantity: { value: 2000, unit: "ml" }, assumedOne: false });
    expect(parseLine("latte 2 l")).toMatchObject({ product: "Latte", quantity: { value: 2000, unit: "ml" } });
    expect(parseLine("500 g di farina")).toMatchObject({ product: "Farina", quantity: { value: 500, unit: "g" } });
    expect(parseLine("6 uova")).toMatchObject({ product: "Uova", quantity: { value: 6, unit: "pz" } });
  });

  it("senza quantità vale un pezzo, e lo dice", () => {
    expect(parseLine("pane")).toMatchObject({ product: "Pane", quantity: { value: 1, unit: "pz" }, assumedOne: true });
  });

  it("toglie i punti elenco", () => {
    expect(parseLine("- pane")?.product).toBe("Pane");
  });

  it("più righe insieme, scartando le vuote", () => {
    const r = parseManualLines("2 l latte\n\npane\n  \nmele 1 kg");
    expect(r.items.map((i) => i.product)).toEqual(["Latte", "Pane", "Mele"]);
    expect(r.rejected).toEqual([]);
  });

  it("riporta le righe che non capisce", () => {
    const r = parseManualLines("3 \npane");
    expect(r.rejected).toEqual(["3"]);
    expect(r.items).toHaveLength(1);
  });

  it("crea voci con id e data", () => {
    const items = toManualItems(parseManualLines("pane").items, "2026-11-16T10:00:00.000Z", () => "id1");
    expect(items).toEqual([{ id: "id1", product: "Pane", quantity: { value: 1, unit: "pz" }, addedAt: "2026-11-16T10:00:00.000Z" }]);
  });
});
