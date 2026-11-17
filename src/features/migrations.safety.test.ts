import { describe, expect, it } from "vitest";
import type { AnyEvent } from "@/core/events";
import { correctLot, derivePantry, type LedgerEvent, type Lot, type PurchaseEvent } from "@/core/ledger";
import { buildEdit, findCreationEvent, formFromLot } from "./actions";
import { buildCaptureEvents, type CaptureInput } from "./capture";
import { legacyBarcodeUpdates } from "./migrations";

const NOW = "2026-11-17T08:00:00.000Z";
const LATER = "2026-11-17T09:00:00.000Z";
const ctx = { now: NOW, deviceId: "d" };
const CODE = "8001234567890";

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
function legacyLot(): PurchaseEvent {
  const r = buildCaptureEvents(input, { now: "2026-11-01T10:00:00.000Z", deviceId: "d" });
  if (!r.ok) throw new Error("cattura");
  return { ...(r.events[0] as PurchaseEvent), note: `Codice a barre ${CODE}` };
}

const lotOf = (events: AnyEvent[]): Lot => derivePantry(events as LedgerEvent[]).lots[0] as Lot;

describe("la migrazione dei codici a barre non scrive un codice sbagliato", () => {
  it("il caso semplice migra", () => {
    expect(legacyBarcodeUpdates([legacyLot()], ctx)).toHaveLength(1);
  });

  it("salta il lotto rinominato: potrebbe essere un altro prodotto", () => {
    const creation = legacyLot();
    const lot = lotOf([creation]);
    const edit = buildEdit(creation, lot, { ...formFromLot(lot), name: "Latte di soia" }, { now: "2026-11-05T10:00:00.000Z", deviceId: "d" });
    if (!edit.ok) throw new Error("modifica");
    const events = [creation, ...edit.events] as AnyEvent[];
    expect(lotOf(events).productRef).toBe("Latte di soia");
    expect(legacyBarcodeUpdates(events, ctx)).toEqual([]);
  });

  it("salta il lotto con un updateLot che tocca barcode, anche per toglierlo", () => {
    const creation = legacyLot();
    const lot = lotOf([creation]);
    const set = correctLot(creation, { barcode: "8076800195057" }, { lot, deviceId: "d", now: () => "2026-11-05T10:00:00.000Z" });
    const withCode = [creation, ...set] as AnyEvent[];
    expect(legacyBarcodeUpdates(withCode, ctx)).toEqual([]);

    const removed = correctLot(creation, { barcode: null }, { lot: { ...lot, barcode: CODE }, deviceId: "d", now: () => "2026-11-06T10:00:00.000Z" });
    expect(removed[0]).toMatchObject({ type: "updateLot", patch: { barcode: null } });
    expect(legacyBarcodeUpdates([creation, ...removed] as AnyEvent[], ctx)).toEqual([]);
  });

  it("salta anche se quell'updateLot è stato annullato: non si indovina", () => {
    const creation = legacyLot();
    const lot = lotOf([creation]);
    const removed = correctLot(creation, { barcode: null }, { lot: { ...lot, barcode: CODE }, deviceId: "d", now: () => "2026-11-06T10:00:00.000Z" });
    const voided: AnyEvent = { id: "v1", type: "void", at: LATER, recordedAt: LATER, deviceId: "d", schemaVersion: 1, certainty: "measured", source: "manual", targetEventId: removed[0].id };
    expect(legacyBarcodeUpdates([creation, ...removed, voided] as AnyEvent[], ctx)).toEqual([]);
  });

  it("una correzione di quantità non impedisce la migrazione, una che ha cambiato il codice sì", () => {
    const creation = legacyLot();
    const lot = lotOf([creation]);
    const fixed = correctLot(creation, { quantity: { value: 900, unit: "ml" } }, { lot, deviceId: "d", now: () => "2026-11-05T10:00:00.000Z" });
    const replacement = fixed.find((e) => e.type === "purchase") as PurchaseEvent;
    expect(replacement.replaces).toBe(creation.id);
    const quantityFixed = [creation, ...fixed] as AnyEvent[];
    expect(findCreationEvent(quantityFixed, lot.lotId, derivePantry(quantityFixed as LedgerEvent[]).voidedEventIds)?.id).toBe(replacement.id);
    expect(legacyBarcodeUpdates(quantityFixed, ctx)).toHaveLength(1);

    // l'originale aveva un altro codice nel campo e la correzione no: qualcuno l'ha tolto
    const original: PurchaseEvent = { ...creation, barcode: "8076800195057" };
    const withoutCode = { ...replacement, note: `Codice a barre ${CODE}` } as PurchaseEvent;
    delete (withoutCode as { barcode?: string }).barcode;
    const voidOriginal = fixed.find((e) => e.type === "void") as LedgerEvent;
    expect(legacyBarcodeUpdates([original, voidOriginal, withoutCode] as AnyEvent[], ctx)).toEqual([]);
  });

  it("salta se l'originale corretto non si trova più", () => {
    const creation = legacyLot();
    const orphan = { ...creation, id: "nuovo", replaces: "sparito" } as PurchaseEvent;
    expect(legacyBarcodeUpdates([orphan], ctx)).toEqual([]);
  });
});
