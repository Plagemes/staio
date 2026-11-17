import { describe, expect, it } from "vitest";
import { derivePantry, type LedgerEvent, type Lot } from "@/core/ledger";
import { buildConsume, buildUndo } from "./actions";
import { buildCaptureEvents, type CaptureInput } from "./capture";
import { buildRealign, fractionChoices, needsRealign, orderForRealign } from "./realign";

const DAY0 = "2026-11-01T10:00:00.000Z";
const NOW = "2026-11-16T10:00:00.000Z";

const base: CaptureInput = {
  name: "Pasta",
  quantityText: "500 g",
  location: "dispensa",
  category: "pasta_dry",
  expiryKind: "none",
  expiryDate: "",
  priceText: "",
  alreadyHave: false,
};

function add(over: Partial<CaptureInput>, at: string): LedgerEvent[] {
  const r = buildCaptureEvents({ ...base, ...over }, { now: at, deviceId: "d" });
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.events;
}
const lotOf = (events: LedgerEvent[], name: string): Lot => derivePantry(events).lots.find((l) => l.productRef === name) as Lot;
const ctx = (now = NOW) => ({ now, deviceId: "d" });

describe("orderForRealign", () => {
  it("prima le stime mai controllate, poi le più vecchie senza conferma", () => {
    const events = [
      ...add({ name: "Riso vecchio" }, "2026-10-01T10:00:00.000Z"), // label, 46 giorni
      ...add({ name: "Farro" }, "2026-10-20T10:00:00.000Z"), // label, 27 giorni
      ...add({ name: "Latte", alreadyHave: true, category: "milk_fresh", location: "frigo" }, "2026-11-15T10:00:00.000Z"), // stima, ieri
      ...add({ name: "Fresco" }, "2026-11-15T10:00:00.000Z"), // label, ieri: non serve
    ];
    const lots = derivePantry(events).lots;
    expect(orderForRealign(lots, NOW).map((l) => l.productRef)).toEqual(["Latte", "Riso vecchio", "Farro"]);
  });

  it("le voci finite non si chiedono", () => {
    const events = add({ name: "Riso" }, DAY0);
    const lot = lotOf(events, "Riso");
    const eat = buildConsume(lot, { kind: "all" }, ctx());
    if (!eat.ok) throw new Error(eat.error);
    expect(orderForRealign(derivePantry([...events, ...eat.events]).lots, NOW)).toEqual([]);
  });

  it("una quantità appena controllata, anche a occhio, non torna subito", () => {
    const events = add({ name: "Riso" }, DAY0);
    const answer = buildRealign(lotOf(events, "Riso"), { kind: "fraction", fraction: 0.5 }, ctx());
    if (!answer.ok) throw new Error(answer.error);
    const lot = lotOf([...events, ...answer.events], "Riso");
    expect(lot.remainingCertainty).toBe("estimated");
    expect(needsRealign(lot, NOW)).toBe(false);
    expect(needsRealign(lot, "2026-11-24T10:00:00.000Z")).toBe(true);
  });
});

describe("buildRealign", () => {
  const events = add({ name: "Pasta" }, DAY0);
  const lot = () => lotOf(events, "Pasta");
  const apply = (answer: Parameters<typeof buildRealign>[1]) => {
    const r = buildRealign(lot(), answer, ctx());
    if (!r.ok) throw new Error(r.error);
    return { r, after: lotOf([...events, ...r.events], "Pasta") };
  };

  it("«uguale» conferma senza cambiare la quantità", () => {
    const { r, after } = apply({ kind: "same" });
    expect(r.events[0]).toMatchObject({ type: "adjust", remaining: { value: 500, unit: "g" }, certainty: "measured" });
    expect(after).toMatchObject({ remaining: 500, remainingCertainty: "measured", status: "active" });
  });

  it("le frazioni sono della quantità iniziale e restano stime", () => {
    const { after } = apply({ kind: "fraction", fraction: 0.5 });
    expect(after).toMatchObject({ remaining: 250, remainingCertainty: "estimated" });
  });

  it("una quantità scritta vale come misurata", () => {
    const { after } = apply({ kind: "text", text: "120 g" });
    expect(after).toMatchObject({ remaining: 120, remainingCertainty: "measured" });
  });

  it("«finito» porta a zero senza inventare un consumo", () => {
    const { r, after } = apply({ kind: "finished" });
    expect(r.events).toHaveLength(1);
    expect(r.events[0].type).toBe("adjust");
    expect(after).toMatchObject({ remaining: 0, status: "finished", consumed: 0, discarded: 0 });
  });

  it("quantità scritte da rifiutare", () => {
    for (const text of ["", "tanto", "2 l", "0", "900 g"]) {
      expect(buildRealign(lot(), { kind: "text", text }, ctx()).ok, text).toBe(false);
    }
  });

  it("un riallineamento annullato riporta la quantità di prima", () => {
    const { r } = apply({ kind: "fraction", fraction: 0.25 });
    const undo = buildUndo(r.events, ctx("2026-11-16T10:05:00.000Z"));
    expect(lotOf([...events, ...r.events, ...undo], "Pasta")).toMatchObject({ remaining: 500, remainingCertainty: "label" });
  });
});

describe("fractionChoices", () => {
  it("propone solo ciò che è davvero meno del rimasto", () => {
    const lot = { initial: 500, unit: "g", remaining: 300 } as const;
    expect(fractionChoices(lot).map((c) => c.fraction)).toEqual([0.5, 0.25]);
    expect(fractionChoices({ ...lot, remaining: 500 }).map((c) => c.fraction)).toEqual([0.75, 0.5, 0.25]);
    expect(fractionChoices({ ...lot, remaining: 100 })).toEqual([]);
  });

  it("i pezzi restano interi", () => {
    const lot = { initial: 6, unit: "pz", remaining: 6 } as const;
    expect(fractionChoices(lot).map((c) => c.quantity.value)).toEqual([5, 3, 2]);
  });
});
