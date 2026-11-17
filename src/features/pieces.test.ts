import { describe, expect, it } from "vitest";
import { derivePantry, type LedgerEvent, type Lot } from "@/core/ledger";
import { buildConsume, buildUndo } from "./actions";
import { buildCaptureEvents } from "./capture";
import { pieceChoices, pieceNameFor, piecesText, pluralIt } from "./pieces";

const NOW = "2026-11-17T08:00:00.000Z";
const ctx = { now: "2026-11-17T12:00:00.000Z", deviceId: "d" };

function piadine(over: Record<string, unknown> = {}) {
  const r = buildCaptureEvents(
    {
      name: "Piadina",
      quantityText: "200 g",
      location: "dispensa",
      category: "bread_packaged",
      expiryKind: "none",
      expiryDate: "",
      priceText: "",
      alreadyHave: false,
      barcode: "8003170063532",
      pieces: { count: 2, each: 100, name: "piadina" },
      ...over,
    },
    { now: NOW, deviceId: "d" },
  );
  if (!r.ok) throw new Error("setup");
  const events: LedgerEvent[] = r.events;
  return { events, lot: derivePantry(events).lots[0] as Lot };
}

describe("pezzi nel modulo di cattura", () => {
  it("2 piadine da 100 g in una confezione da 200 g: un lotto solo, in grammi", () => {
    const { events, lot } = piadine();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ pieces: { count: 2, each: 100, name: "piadina" }, quantity: { value: 200, unit: "g" } });
    expect(lot).toMatchObject({ unit: "g", initial: 200 });
  });

  it("senza pezzi, o con un pezzo solo, l'evento è quello di prima", () => {
    expect(piadine({ pieces: undefined }).events[0]).not.toHaveProperty("pieces");
    expect(piadine({ pieces: { count: 1, each: 200 } }).events[0]).not.toHaveProperty("pieces");
  });

  it("un lotto contato a pezzi non porta pezzi", () => {
    expect(piadine({ quantityText: "4 pz" }).events[0]).not.toHaveProperty("pieces");
  });
});

describe("testo dei pezzi", () => {
  it("piena: «2 pezzi da 100 g»; dopo un pezzo «1 pezzo»; dopo mezzo «mezzo pezzo»", () => {
    const { events, lot } = piadine();
    expect(piecesText([lot])).toBe("2 pezzi da 100 g");
    const one = buildConsume(lot, { kind: "value", value: 100 }, ctx);
    if (!one.ok) throw new Error(one.error);
    const after = derivePantry([...events, ...one.events]).lots[0];
    expect(after.remaining).toBe(100);
    expect(piecesText([after])).toBe("1 pezzo");
    const half = buildConsume(after, { kind: "value", value: 50, estimated: true }, { ...ctx, now: "2026-11-17T13:00:00.000Z" });
    if (!half.ok) throw new Error(half.error);
    expect(piecesText([derivePantry([...events, ...one.events, ...half.events]).lots[0]])).toBe("mezzo pezzo");
  });

  it("più confezioni insieme: «4 pezzi da 100 g»", () => {
    const a = piadine().lot;
    const b = { ...a, lotId: "L2" };
    expect(piecesText([a, b])).toBe("4 pezzi da 100 g");
  });

  it("pezzi che non tornano: stima", () => {
    const { lot } = piadine({ pieces: { count: 2, each: 120 } });
    expect(piecesText([lot])).toBe("2 pezzi da 100 g (stima)");
  });

  it("senza pezzi nessun testo", () => {
    expect(piecesText([piadine({ pieces: undefined }).lot])).toBeUndefined();
  });
});

describe("scelte di consumo", () => {
  it("1 piadina, 2 piadine, mezza piadina", () => {
    const { lot } = piadine();
    expect(pieceChoices(lot).map((c) => c.label)).toEqual(["1 piadina = 100 g", "2 piadine = 200 g", "mezza piadina = 50 g"]);
    expect(pieceChoices(lot).map((c) => c.quantity.value)).toEqual([100, 200, 50]);
    expect(pieceChoices(lot).at(-1)?.estimated).toBe(true);
  });

  it("non offre più di quanto resta", () => {
    const { events, lot } = piadine();
    const one = buildConsume(lot, { kind: "value", value: 100 }, ctx);
    if (!one.ok) throw new Error(one.error);
    const left = derivePantry([...events, ...one.events]).lots[0];
    expect(pieceChoices(left).map((c) => c.label)).toEqual(["1 piadina = 100 g", "mezza piadina = 50 g"]);
    expect(buildConsume(left, { kind: "value", value: 200 }, ctx).ok).toBe(false);
  });

  it("senza nome il pezzo è «pezzo»; Annulla ripristina il consumo", () => {
    const { events, lot } = piadine({ pieces: { count: 2, each: 100 } });
    expect(pieceChoices(lot)[0].label).toBe("1 pezzo = 100 g");
    expect(pieceChoices(lot)[2].label).toBe("mezzo pezzo = 50 g");
    const r = buildConsume(lot, { kind: "value", value: 100 }, ctx);
    if (!r.ok) throw new Error(r.error);
    const back = derivePantry([...events, ...r.events, ...buildUndo(r.events, ctx)]).lots[0];
    expect(back.remaining).toBe(200);
  });

  it("un lotto senza pezzi non ha scelte", () => {
    expect(pieceChoices(piadine({ pieces: undefined }).lot)).toEqual([]);
  });
});

describe("nome del pezzo e plurale", () => {
  it("si ricava dal nome del prodotto", () => {
    expect(pieceNameFor("Piadina romagnola")).toBe("piadina");
    expect(pieceNameFor("Pancakes freschi")).toBe("pancake");
    expect(pieceNameFor("Mousse cacao protein")).toBeUndefined();
    expect(pieceNameFor(undefined)).toBeUndefined();
  });

  it("plurale", () => {
    expect(pluralIt("piadina")).toBe("piadine");
    expect(pluralIt("panino")).toBe("panini");
    expect(pluralIt("wrap")).toBe("wrap");
  });
});
