import { describe, expect, it } from "vitest";
import { createIdGenerator, derivePantry, validateEvent } from "@/core/ledger";
import { buildCaptureEvents, readQuantity, type CaptureInput } from "./capture";

const NOW = "2026-11-16T10:00:00.000Z";
const ctx = () => ({
  now: NOW,
  deviceId: "dev-1",
  idGenerator: createIdGenerator({ now: () => 1_000, random: () => 0.5 }),
});

const input = (over: Partial<CaptureInput> = {}): CaptureInput => ({
  name: "latte intero",
  quantityText: "1 l",
  location: "frigo",
  category: "milk_fresh",
  expiryKind: "use_by",
  expiryDate: "2026-11-20",
  priceText: "1,49",
  alreadyHave: false,
  ...over,
});

describe("readQuantity", () => {
  it("porta tutto in unità base", () => {
    expect(readQuantity("500 g")).toMatchObject({ ok: true, quantity: { value: 500, unit: "g" } });
    expect(readQuantity("1 l")).toMatchObject({ ok: true, quantity: { value: 1000, unit: "ml" } });
    expect(readQuantity("1,5 kg")).toMatchObject({ ok: true, quantity: { value: 1500, unit: "g" } });
    expect(readQuantity("6 uova")).toMatchObject({ ok: true, quantity: { value: 6, unit: "pz" }, rest: "uova" });
  });

  it("spiega le quantità che non si possono leggere", () => {
    for (const bad of ["", "   ", "tanto", "0 g", "2 confezioni", "un pizzico"]) {
      const r = readQuantity(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(10);
    }
  });
});

describe("buildCaptureEvents", () => {
  it("un acquisto valido: evento purchase con prezzo, scadenza e categoria", () => {
    const r = buildCaptureEvents(input(), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [e] = r.events;
    expect(e).toMatchObject({
      type: "purchase",
      productRef: "Latte intero",
      category: "milk_fresh",
      quantity: { value: 1000, unit: "ml" },
      location: "frigo",
      expiry: { date: "2026-11-20", kind: "use_by" },
      priceCents: 149,
      certainty: "label",
      source: "manual",
      deviceId: "dev-1",
    });
    expect(validateEvent(e)).toEqual([]);
    expect(derivePantry(r.events).lots).toHaveLength(1);
    expect(r.summary).toContain("Latte intero");
  });

  it("«Ce l'avevo già in casa» scrive declare, senza prezzo, e la quantità è una stima", () => {
    const r = buildCaptureEvents(input({ alreadyHave: true }), ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.events[0].type).toBe("declare");
    expect(r.events[0]).not.toHaveProperty("priceCents");
    expect(r.events[0].certainty).toBe("estimated");
  });

  it("senza data: nessuna scadenza nell'evento", () => {
    const r = buildCaptureEvents(input({ expiryKind: "none", expiryDate: "" }), ctx());
    expect(r.ok && r.events[0]).not.toHaveProperty("expiry");
  });

  it("prezzo vuoto va bene", () => {
    const r = buildCaptureEvents(input({ priceText: "" }), ctx());
    expect(r.ok && r.events[0]).not.toHaveProperty("priceCents");
  });

  it("la quantità può dare anche il nome", () => {
    const r = buildCaptureEvents(input({ name: "", quantityText: "6 uova", category: "eggs" }), ctx());
    expect(r.ok && r.events[0]).toMatchObject({ productRef: "Uova", quantity: { value: 6, unit: "pz" } });
  });

  it("errori accanto al campo giusto", () => {
    const r = buildCaptureEvents(
      input({ name: " ", quantityText: "tanto", category: "", expiryDate: "", priceText: "abc" }),
      ctx(),
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["category", "expiryDate", "name", "price", "quantity"]);
  });

  it("data mancante o impossibile", () => {
    const missing = buildCaptureEvents(input({ expiryDate: "" }), ctx());
    expect(!missing.ok && missing.errors.expiryDate).toMatch(/Nessuna data/);
    const impossible = buildCaptureEvents(input({ expiryDate: "2026-02-30" }), ctx());
    expect(!impossible.ok && impossible.errors.expiryDate).toMatch(/non è valida/);
  });

  it("una categoria inventata non passa", () => {
    const r = buildCaptureEvents(input({ category: "cosa_strana" }), ctx());
    expect(!r.ok && r.errors.category).toBeTruthy();
  });

  it("il prezzo di ciò che c'era già non viene letto né segnalato", () => {
    const r = buildCaptureEvents(input({ alreadyHave: true, priceText: "abc" }), ctx());
    expect(r.ok).toBe(true);
  });
});
