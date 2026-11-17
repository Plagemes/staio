import { describe, expect, it } from "vitest";
import type { Difference } from "@/core/ai";
import { createIdGenerator, derivePantry } from "@/core/ledger";
import { purchase, q } from "@/core/ledger/test-helpers";
import { buildPhotoEvents, type PhotoContext } from "./photoEvents";
import { toExpectedLots } from "./photoScan";

const NOW = "2026-11-17T09:30:00.000Z";
const events = [
  purchase("e1", "2026-11-10T10:00:00.000Z", { lotId: "lot-latte", productRef: "Latte intero", category: "milk_fresh", quantity: q(1000, "ml"), location: "frigo", expiry: { date: "2026-11-20", kind: "use_by" }, certainty: "label" }),
];
const pantry = derivePantry(events);
const target = toExpectedLots(pantry.lots);

const notice: Difference = {
  key: "L1:soon",
  kind: "use_soon",
  mode: "proposal",
  lotId: "L1",
  name: "Latte intero",
  confidence: 0.9,
  reason: "motivo",
  confirmLabel: "Ho capito",
  declineLabel: "Ho capito",
  food: "cat:milk_fresh",
  change: { type: "notice", labelDate: "2026-11-20", labelKind: "use_by" },
};

const ctx = (actions?: PhotoContext["actions"]): PhotoContext => ({
  now: NOW,
  deviceId: "dev-1",
  idGenerator: createIdGenerator({ now: () => 1_790_000_000_000, random: () => 0.5 }),
  location: "frigo",
  lotsById: target.lotsById,
  events,
  voidedEventIds: pantry.voidedEventIds,
  actions,
});

describe("avviso su un lotto con data d'etichetta", () => {
  it("da solo non scrive nulla, nemmeno se è nell'elenco delle confermate", () => {
    expect(buildPhotoEvents([notice], ctx())).toEqual({ events: [], written: [], errors: [] });
  });

  it("«l'ho mangiato» è l'azione di sempre: un consumo, senza toccare la scadenza", () => {
    const r = buildPhotoEvents([notice], ctx({ "L1:soon": "eaten" }));
    expect(r.errors).toEqual([]);
    expect(r.events.map((e) => e.type)).toEqual(["consume"]);
    expect(r.events[0]).toMatchObject({ lotId: "lot-latte", quantity: { value: 1000, unit: "ml" } });
    const lot = derivePantry([...events, ...r.events]).lots[0];
    expect(lot.status).toBe("finished");
    expect(lot.expiry).toEqual({ date: "2026-11-20", kind: "use_by" });
  });

  it("«l'ho buttato»: uno spreco", () => {
    const r = buildPhotoEvents([notice], ctx({ "L1:soon": "discarded" }));
    expect(r.events.map((e) => e.type)).toEqual(["discard"]);
    expect(derivePantry([...events, ...r.events]).lots[0].discarded).toBe(1000);
  });

  it("nessun evento di scadenza né di correzione dell'acquisto, in nessun caso", () => {
    for (const actions of [undefined, { "L1:soon": "eaten" as const }, { "L1:soon": "discarded" as const }]) {
      const r = buildPhotoEvents([notice], ctx(actions));
      expect(r.events.some((e) => e.type === "updateLot" || e.type === "void" || e.type === "purchase" || e.type === "declare" || e.type === "adjust")).toBe(false);
    }
  });
});
