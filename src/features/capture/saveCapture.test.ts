import { describe, expect, it } from "vitest";
import type { AnyEvent } from "@/core/events";
import { derivePantry } from "@/core/ledger";
import type { CaptureInput } from "../capture";
import { saveCapture, singleFlight, undoCapture, type SaveDeps } from "./saveCapture";

const input: CaptureInput = {
  name: "Farfalle n° 265",
  quantityText: "500 g",
  location: "dispensa",
  category: "pasta_dry",
  expiryKind: "none",
  expiryDate: "",
  priceText: "",
  alreadyHave: false,
  barcode: "8076800195057",
  brand: "Barilla",
};

function fakeDeps(): SaveDeps & { written: AnyEvent[] } {
  const written: AnyEvent[] = [];
  return {
    written,
    appendEvents: async (events) => {
      await Promise.resolve();
      written.push(...events);
      return { added: events.length };
    },
    getDeviceId: async () => "device-1",
    now: () => "2026-11-17T08:00:00.000Z",
  };
}

describe("saveCapture", () => {
  it("scrive un acquisto da codice a barre con la certezza letta in etichetta", async () => {
    const deps = fakeDeps();
    const result = await saveCapture(input, deps);
    expect(result.ok).toBe(true);
    expect(deps.written).toHaveLength(1);
    expect(deps.written[0]).toMatchObject({
      type: "purchase",
      source: "barcode",
      certainty: "label",
      barcode: "8076800195057",
      productRef: "Farfalle n° 265",
      category: "pasta_dry",
      location: "dispensa",
      quantity: { value: 500, unit: "g" },
    });
    expect(derivePantry(deps.written).lots).toHaveLength(1);
  });

  it("con dati non validi non scrive niente e dice quale", async () => {
    const deps = fakeDeps();
    const result = await saveCapture({ ...input, quantityText: "" }, deps);
    expect(result).toMatchObject({ ok: false, errors: { quantity: expect.any(String) } });
    expect(deps.written).toHaveLength(0);
  });

  it("se il registro non scrive, lo dice", async () => {
    const deps = { ...fakeDeps(), appendEvents: async () => ({ added: 0 }) };
    expect(await saveCapture(input, deps)).toMatchObject({ ok: false, errors: { form: expect.any(String) } });
  });
});

describe("doppio tocco", () => {
  it("due chiamate ravvicinate scrivono un solo lotto", async () => {
    const deps = fakeDeps();
    const save = singleFlight((i: CaptureInput) => saveCapture(i, deps));
    const [a, b] = await Promise.all([save(input), save(input)]);
    expect(a).toBe(b);
    expect(deps.written).toHaveLength(1);
    expect(derivePantry(deps.written).lots).toHaveLength(1);
  });

  it("finita la prima, una nuova chiamata può partire", async () => {
    const deps = fakeDeps();
    const save = singleFlight((i: CaptureInput) => saveCapture(i, deps));
    await save(input);
    await save(input);
    expect(deps.written).toHaveLength(2);
  });
});

describe("annulla", () => {
  it("scrive un evento void e il lotto sparisce dalla dispensa, senza cancellare l'acquisto", async () => {
    const deps = fakeDeps();
    const result = await saveCapture(input, deps);
    if (!result.ok) throw new Error("salvataggio fallito");
    expect(derivePantry(deps.written).lots).toHaveLength(1);
    await undoCapture(result.events, deps);
    expect(deps.written).toHaveLength(2);
    expect(deps.written[1]).toMatchObject({ type: "void", targetEventId: result.events[0].id });
    expect(derivePantry(deps.written).lots).toHaveLength(0);
  });

  it("se l'annullamento non si scrive, lancia", async () => {
    const deps = { ...fakeDeps(), appendEvents: async () => ({ added: 0 }) };
    await expect(undoCapture([], deps)).rejects.toThrow();
  });
});
