import { describe, expect, it } from "vitest";
import { parseReceiptResponse } from "@/core/ai";
import { createIdGenerator, validateEvent } from "@/core/ledger";
import { buildReceiptEvents, includedTotalCents, purchaseInstant, receiptNote, storeLabel, toReviewLines, type ReviewLine } from "./receiptEvents";

const NOW = "2026-11-17T09:30:00.000Z";

const reading = parseReceiptResponse(
  JSON.stringify({
    store: "VIA ROMA 12",
    chain: "Esselunga",
    date: "2026-11-14",
    lines: [
      { raw: "LATTE UHT PS 1L", name: "Latte UHT", quantity: 1, unit: "l", priceCents: 129, isFood: true, category: "milk_uht" },
      { raw: "PROSC.COTTO AQ", name: "Prosciutto cotto", priceCents: 249, isFood: true, category: "cold_cuts_sliced" },
      { raw: "BANANE 0,532 kg", name: "Banane", quantity: 0.532, unit: "kg", priceCents: 106, isFood: true, category: "fruit_fresh" },
      { raw: "SACCHETTO BIO", name: "Sacchetto", priceCents: 10, isFood: false },
      { raw: "GELATO VANIGLIA", name: "Gelato alla vaniglia", quantity: 500, unit: "g", priceCents: 350, isFood: true, category: "frozen_foods" },
      { raw: "ROBA STRANA", name: "Roba strana", priceCents: 99, isFood: true },
    ],
    totalCents: 943,
  }),
);

const sequentialIds = () => {
  let t = 1_790_000_000_000;
  return createIdGenerator({ now: () => t++, random: () => 0.5 });
};

describe("toReviewLines", () => {
  const lines = toReviewLines(reading);

  it("include gli alimenti ed esclude in partenza i non alimentari", () => {
    expect(lines.map((l) => [l.name, l.include])).toEqual([
      ["Latte UHT", true],
      ["Prosciutto cotto", true],
      ["Banane", true],
      ["Sacchetto", false],
      ["Gelato alla vaniglia", true],
      ["Roba strana", true],
    ]);
  });

  it("propone quantità leggibili dal registro, e un 1 pezzo segnalato quando non c'è", () => {
    expect(lines.map((l) => l.quantityText)).toEqual(["1000 ml", "1 pz", "532 g", "1 pz", "500 g", "1 pz"]);
    expect(lines[1].quantityGuessed).toBe(true);
    expect(lines[0].quantityGuessed).toBe(false);
  });

  it("propone luogo dalla categoria, e una categoria dal nome se il modello non l'ha data", () => {
    expect(lines[4].location).toBe("freezer");
    expect(lines[0].location).toBe("dispensa");
    expect(lines[1].location).toBe("frigo");
    expect(lines[5].category).toBe("");
  });

  it("porta il prezzo di riga", () => {
    expect(lines.map((l) => l.priceCents)).toEqual([129, 249, 106, 10, 350, 99]);
    expect(includedTotalCents(lines)).toBe(129 + 249 + 106 + 350 + 99);
  });
});

describe("buildReceiptEvents", () => {
  const fixed = (lines: ReviewLine[]) => lines.map((l) => (l.key === "line-5" ? { ...l, category: "snacks_dry" } : l));
  const meta = { store: "Esselunga · Via Roma 12", date: "2026-11-14" };
  const ctx = () => ({ now: NOW, deviceId: "dev-1", idGenerator: sequentialIds() });

  it("scrive un acquisto per ogni riga inclusa, con lo stesso receiptId e certezza stimata", () => {
    const result = buildReceiptEvents(fixed(toReviewLines(reading)), meta, ctx());
    if (!result.ok) throw new Error(JSON.stringify(result));
    expect(result.events).toHaveLength(5);
    expect(new Set(result.events.map((e) => e.receiptId)).size).toBe(1);
    expect(result.events[0].receiptId).toBe(result.receiptId);
    for (const e of result.events) {
      expect(e).toMatchObject({ type: "purchase", source: "receipt", certainty: "estimated", store: "Esselunga · Via Roma 12", deviceId: "dev-1", recordedAt: NOW });
      expect(validateEvent(e)).toEqual([]);
    }
    expect(new Set(result.events.map((e) => e.id)).size).toBe(5);
    expect(new Set(result.events.map((e) => e.lotId)).size).toBe(5);
  });

  it("porta nome, quantità in unità di base, categoria, luogo e prezzo della riga", () => {
    const result = buildReceiptEvents(fixed(toReviewLines(reading)), meta, ctx());
    if (!result.ok) throw new Error("atteso ok");
    const [latte, prosciutto, banane, gelato] = result.events;
    expect(latte).toMatchObject({ productRef: "Latte UHT", quantity: { value: 1000, unit: "ml" }, category: "milk_uht", location: "dispensa", priceCents: 129 });
    expect(prosciutto).toMatchObject({ quantity: { value: 1, unit: "pz" }, location: "frigo", priceCents: 249 });
    expect(banane).toMatchObject({ quantity: { value: 532, unit: "g" } });
    expect(gelato).toMatchObject({ location: "freezer", priceCents: 350 });
    expect(latte.note).toBe("Riga scontrino: LATTE UHT PS 1L");
  });

  it("le righe escluse non entrano nel registro", () => {
    const result = buildReceiptEvents(fixed(toReviewLines(reading)), meta, ctx());
    if (!result.ok) throw new Error("atteso ok");
    expect(result.events.map((e) => e.productRef)).not.toContain("Sacchetto");
    const lines = fixed(toReviewLines(reading)).map((l) => (l.key === "line-3" ? { ...l, include: true, category: "snacks_dry" } : l));
    const again = buildReceiptEvents(lines, meta, ctx());
    if (!again.ok) throw new Error("atteso ok");
    expect(again.events).toHaveLength(6);
  });

  it("usa le correzioni dell'utente", () => {
    const lines = fixed(toReviewLines(reading)).map((l) => (l.key === "line-0" ? { ...l, name: "  latte intero ", quantityText: "2 l", category: "milk_fresh", location: "frigo" as const } : l));
    const result = buildReceiptEvents(lines, meta, ctx());
    if (!result.ok) throw new Error("atteso ok");
    expect(result.events[0]).toMatchObject({ productRef: "Latte intero", quantity: { value: 2000, unit: "ml" }, category: "milk_fresh", location: "frigo" });
  });

  it("la data dello scontrino è la data dell'acquisto; senza data o nel futuro vale adesso", () => {
    const ok = buildReceiptEvents(fixed(toReviewLines(reading)), meta, ctx());
    if (!ok.ok) throw new Error("atteso ok");
    expect(ok.events[0].at).toBe("2026-11-14T12:00:00.000Z");
    expect(purchaseInstant("", NOW)).toBe(NOW);
    expect(purchaseInstant("2026-12-25", NOW)).toBe(NOW);
    expect(purchaseInstant("2026-11-17", NOW)).toBe("2026-11-17T12:00:00.000Z");
    expect(purchaseInstant("boh", NOW)).toBe(NOW);
  });

  it("senza negozio non scrive il campo", () => {
    const result = buildReceiptEvents(fixed(toReviewLines(reading)), { store: "  ", date: "" }, ctx());
    if (!result.ok) throw new Error("atteso ok");
    expect(result.events.every((e) => !("store" in e))).toBe(true);
  });

  it("non scrive nulla se una riga ha un problema, e dice quale", () => {
    const result = buildReceiptEvents(toReviewLines(reading), meta, ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toEqual(["line-5"]);
    expect(result.errors["line-5"]).toMatch(/categoria/i);
  });

  it("quantità illeggibile o nome vuoto", () => {
    const base = fixed(toReviewLines(reading));
    const bad = base.map((l) => (l.key === "line-0" ? { ...l, quantityText: "boh" } : l.key === "line-1" ? { ...l, name: "  " } : l));
    const result = buildReceiptEvents(bad, meta, ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(["line-0", "line-1"]);
  });

  it("nessuna riga scelta", () => {
    const none = toReviewLines(reading).map((l) => ({ ...l, include: false }));
    const result = buildReceiptEvents(none, meta, ctx());
    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.form).toBeDefined();
  });

  it("una riga senza prezzo si salva senza prezzo", () => {
    const lines = fixed(toReviewLines(reading)).map((l) => (l.key === "line-0" ? { ...l, priceCents: undefined } : l));
    const result = buildReceiptEvents(lines, meta, ctx());
    if (!result.ok) throw new Error("atteso ok");
    expect("priceCents" in result.events[0]).toBe(false);
  });
});

describe("storeLabel", () => {
  it.each([
    [{ chain: "Esselunga", store: "VIA ROMA 12" }, "Esselunga · VIA ROMA 12"],
    [{ chain: "Coop", store: "Coop Alleanza 3.0 Bologna" }, "Coop Alleanza 3.0 Bologna"],
    [{ chain: "Conad" }, "Conad"],
    [{ store: "Alimentari Rossi" }, "Alimentari Rossi"],
    [{}, ""],
  ])("%j", (input, expected) => expect(storeLabel(input)).toBe(expected));
});

describe("receiptNote", () => {
  it("ha sempre il prefisso fisso e tiene il testo della riga", () => {
    expect(receiptNote("LATTE UHT PS 1L")).toBe("Riga scontrino: LATTE UHT PS 1L");
    expect(receiptNote("   ")).toBe("Riga scontrino");
    expect(receiptNote("")).toBe("Riga scontrino");
  });

  it.each([
    ["Codice a barre 8001234567890 · Barilla", "Riga scontrino: · Barilla"],
    ["PASTA CODICE A BARRE: 8001234567890", "Riga scontrino: PASTA"],
    ["codice  a  barre", "Riga scontrino"],
    ["X Codice a barre 123 Y", "Riga scontrino: X Y"],
  ])("toglie «Codice a barre» da %j", (raw, expected) => {
    const note = receiptNote(raw);
    expect(note).toBe(expected);
    expect(note.toLowerCase()).not.toContain("codice a barre");
  });

  it("accorcia le righe lunghe", () => {
    expect(receiptNote("A".repeat(500)).length).toBeLessThanOrEqual("Riga scontrino: ".length + 120);
  });

  it("l'evento scritto porta la nota col prefisso, anche se la riga contiene un codice a barre", () => {
    const lines = toReviewLines(
      parseReceiptResponse(JSON.stringify({ lines: [{ raw: "YOGURT Codice a barre 8001234567890", name: "Yogurt", priceCents: 100, isFood: true, category: "yogurt" }] })),
    );
    const result = buildReceiptEvents(lines, { store: "", date: "" }, { now: NOW, deviceId: "d" });
    if (!result.ok) throw new Error("atteso ok");
    expect(result.events[0].note).toBe("Riga scontrino: YOGURT");
    expect("barcode" in result.events[0]).toBe(false);
  });
});
