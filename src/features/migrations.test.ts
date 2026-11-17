import { describe, expect, it } from "vitest";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type LedgerEvent } from "@/core/ledger";
import { buildUndo } from "./actions";
import { buildCaptureEvents, type CaptureInput } from "./capture";
import { legacyBarcodeOfNote, legacyBarcodeUpdates } from "./migrations";

const NOW = "2026-11-17T08:00:00.000Z";
const ctx = { now: NOW, deviceId: "d" };

const input: CaptureInput = {
  name: "Latte intero",
  quantityText: "1 l",
  location: "frigo",
  category: "milk_fresh",
  expiryKind: "none",
  expiryDate: "",
  priceText: "",
  alreadyHave: false,
};

/** Un lotto come lo scriveva la cattura prima del campo `barcode`: il codice solo nella nota. */
function legacy(note: string | undefined, over: Partial<CaptureInput> = {}): AnyEvent {
  const r = buildCaptureEvents({ ...input, ...over }, { now: "2026-11-01T10:00:00.000Z", deviceId: "d" });
  if (!r.ok) throw new Error("cattura");
  const { note: _ignored, ...rest } = r.events[0] as LedgerEvent & { note?: string };
  void _ignored;
  return (note === undefined ? rest : { ...rest, note }) as AnyEvent;
}

describe("legacyBarcodeOfNote", () => {
  it("riconosce solo il testo esatto della cattura", () => {
    expect(legacyBarcodeOfNote("Codice a barre 8001234567890")).toBe("8001234567890");
    expect(legacyBarcodeOfNote("Codice a barre 8001234567890 · Granarolo")).toBe("8001234567890");
    expect(legacyBarcodeOfNote("Riga scontrino: Codice a barre 8001234567890")).toBeUndefined();
    expect(legacyBarcodeOfNote("Riga scontrino: latte")).toBeUndefined();
    expect(legacyBarcodeOfNote("Ho letto il Codice a barre 8001234567890 ieri")).toBeUndefined();
    expect(legacyBarcodeOfNote("Codice a barre 12345")).toBeUndefined();
    expect(legacyBarcodeOfNote(undefined)).toBeUndefined();
  });
});

describe("legacyBarcodeUpdates", () => {
  it("scrive il campo per i lotti vecchi, con la marca nella nota o senza", () => {
    const a = legacy("Codice a barre 8001234567890 · Granarolo");
    const b = legacy("Codice a barre 8076800195057", { name: "Spaghetti", category: "pasta_dry", quantityText: "500 g" });
    const updates = legacyBarcodeUpdates([a, b], ctx);
    expect(updates).toHaveLength(2);
    expect(updates.every((e) => e.type === "updateLot")).toBe(true);
    const lots = derivePantry([a as LedgerEvent, b as LedgerEvent, ...updates]).lots;
    expect(lots.map((l) => l.barcode).sort()).toEqual(["8001234567890", "8076800195057"]);
  });

  it("non tocca né i lotti che hanno già il codice né quelli da scontrino", () => {
    const withField = buildCaptureEvents({ ...input, barcode: "8001234567890" }, { now: "2026-11-01T10:00:00.000Z", deviceId: "d" });
    if (!withField.ok) throw new Error("cattura");
    const receipt = legacy("Riga scontrino: Codice a barre 8001234567890", { name: "Da scontrino" });
    const plain = legacy(undefined, { name: "Senza nota" });
    expect(legacyBarcodeUpdates([...withField.events, receipt, plain], ctx)).toEqual([]);
  });

  it("è idempotente: dopo la migrazione non c'è più niente da fare", () => {
    const a = legacy("Codice a barre 8001234567890");
    const updates = legacyBarcodeUpdates([a], ctx);
    expect(legacyBarcodeUpdates([a, ...updates], { ...ctx, now: "2026-11-17T09:00:00.000Z" })).toEqual([]);
  });

  it("un ingresso annullato non produce niente", () => {
    const a = legacy("Codice a barre 8001234567890");
    const undo = buildUndo([a], ctx);
    expect(legacyBarcodeUpdates([a, ...undo], ctx)).toEqual([]);
  });

  it("senza eventi non fa niente", () => {
    expect(legacyBarcodeUpdates([], ctx)).toEqual([]);
  });
});
