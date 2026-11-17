import { describe, expect, it, vi } from "vitest";
import type { Difference } from "@/core/ai";
import { createIdGenerator, derivePantry, validateEvent, voidEvent, type LedgerEvent } from "@/core/ledger";
import { adjust, declare, purchase, q, updateLot, voidOf } from "@/core/ledger/test-helpers";
import { PHOTO_NOTE, buildPhotoEvents, zoneObservations, type PhotoContext } from "./photoEvents";
import { scanPantry, toExpectedLots } from "./photoScan";
import { memorySettingsStore, setApiKey } from "./settings";
import { loadZoneMap, recordZones } from "./zonesStore";

const NOW = "2026-11-17T09:30:00.000Z";
const KEY = "sk-ant-api03-SEGRETISSIMA-1234567890";

const events: LedgerEvent[] = [
  purchase("e1", "2026-11-10T10:00:00.000Z", { lotId: "lot-latte", productRef: "Latte intero", category: "milk_fresh", quantity: q(1000, "ml"), location: "frigo", expiry: { date: "2026-11-20", kind: "use_by" }, certainty: "label" }),
  purchase("e2", "2026-11-10T10:00:00.000Z", { lotId: "lot-yogurt", productRef: "Yogurt bianco", category: "yogurt", quantity: q(4, "pz"), location: "frigo" }),
  declare("e3", "2026-11-11T10:00:00.000Z", { lotId: "lot-passata", productRef: "Passata di pomodoro", quantity: q(700, "ml"), location: "frigo" }),
  purchase("e4", "2026-11-12T10:00:00.000Z", { lotId: "lot-pane", productRef: "Pane", quantity: q(500, "g"), location: "dispensa" }),
];
const pantry = derivePantry(events);
const fridge = pantry.lots.filter((l) => l.location === "frigo");
const target = toExpectedLots(fridge);

const ctxOf = (over: Partial<PhotoContext> = {}): PhotoContext => ({
  now: NOW,
  deviceId: "dev-1",
  idGenerator: createIdGenerator({ now: () => 1_790_000_000_000, random: () => 0.5 }),
  location: "frigo",
  lotsById: target.lotsById,
  events,
  voidedEventIds: pantry.voidedEventIds,
  ...over,
});

const diff = (over: Partial<Difference> & Pick<Difference, "change">): Difference => ({
  key: "k",
  kind: "quantity_changed",
  mode: "proposal",
  lotId: "L1",
  name: "Latte intero",
  confidence: 0.9,
  reason: "motivo",
  confirmLabel: "Conferma",
  declineLabel: "Ignora",
  food: "cat:milk_fresh",
  ...over,
});

describe("toExpectedLots", () => {
  it("un identificativo corto per ogni lotto, con quantità, aperto e scadenza", () => {
    expect(target.expected.map((e) => e.id)).toEqual(["L1", "L2", "L3"]);
    expect(target.expected[0]).toEqual({
      id: "L1",
      name: "Latte intero",
      remaining: { value: 1000, unit: "ml" },
      initial: 1000,
      opened: false,
      category: "milk_fresh",
      expiry: { date: "2026-11-20", kind: "use_by" },
    });
    expect(target.lotsById.get("L2")?.lotId).toBe("lot-yogurt");
    expect(JSON.stringify(target.expected)).not.toContain("lot-");
  });

  it("un lotto aperto lo è anche per il modello", () => {
    const opened = derivePantry([...events, { ...(events[0] as LedgerEvent), id: "o1", type: "open", lotId: "lot-latte" } as LedgerEvent]);
    expect(toExpectedLots(opened.lots.filter((l) => l.location === "frigo")).expected[0].opened).toBe(true);
  });
});

describe("buildPhotoEvents", () => {
  it("senza conferme non scrive niente", () => {
    expect(buildPhotoEvents([], ctxOf())).toEqual({ events: [], written: [], errors: [] });
  });

  it("quantità cambiata: un riallineamento stimato, fonte foto", () => {
    const r = buildPhotoEvents([diff({ change: { type: "adjust", remaining: { value: 500, unit: "ml" } } })], ctxOf());
    expect(r.errors).toEqual([]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ type: "adjust", lotId: "lot-latte", remaining: { value: 500, unit: "ml" }, certainty: "estimated", source: "photo", note: PHOTO_NOTE, deviceId: "dev-1", at: NOW });
    expect(validateEvent(r.events[0])).toEqual([]);
    expect(r.written[0].summary).toBe("Latte intero: ne resta circa 500 ml");
    expect(derivePantry([...events, ...r.events]).lots.find((l) => l.lotId === "lot-latte")).toMatchObject({ remaining: 500, remainingCertainty: "estimated" });
  });

  it("probabilmente finito: un riallineamento a zero, non un consumo né uno spreco", () => {
    const r = buildPhotoEvents([diff({ key: "f", kind: "probably_finished", lotId: "L3", name: "Passata di pomodoro", change: { type: "adjust", remaining: { value: 0, unit: "ml" } } })], ctxOf());
    expect(r.events.map((e) => e.type)).toEqual(["adjust"]);
    expect(r.written[0].summary).toBe("Passata di pomodoro: segnato finito");
    expect(derivePantry([...events, ...r.events]).lots.find((l) => l.lotId === "lot-passata")?.status).toBe("finished");
  });

  it("non porta la quantità oltre l'iniziale", () => {
    const r = buildPhotoEvents([diff({ change: { type: "adjust", remaining: { value: 99999, unit: "ml" } } })], ctxOf());
    expect(r.events[0]).toMatchObject({ remaining: { value: 1000 } });
  });

  it("elemento inatteso: una dichiarazione stimata nel luogo scelto, con categoria dedotta dal nome", () => {
    const r = buildPhotoEvents(
      [diff({ key: "new:0", kind: "unexpected_item", lotId: undefined, name: "maionese", food: "name:maionese", change: { type: "declare", name: "maionese", quantity: { value: 1, unit: "pz" }, quantityGuessed: true } })],
      ctxOf({ location: "dispensa" }),
    );
    expect(r.errors).toEqual([]);
    expect(r.events[0]).toMatchObject({ type: "declare", productRef: "Maionese", category: "condiments_sauces", location: "dispensa", quantity: { value: 1, unit: "pz" }, certainty: "estimated", source: "photo", note: PHOTO_NOTE });
    expect("priceCents" in r.events[0]).toBe(false);
    expect(validateEvent(r.events[0])).toEqual([]);
    expect(derivePantry([...events, ...r.events]).lots.some((l) => l.productRef === "Maionese" && l.location === "dispensa")).toBe(true);
  });

  describe("scadenza", () => {
    const expiryDiff = diff({ key: "x", kind: "expiry_differs", change: { type: "expiry", expiry: { date: "2026-11-22", kind: "best_before" }, registered: "2026-11-20" } });

    it("passa da correctLot: un solo updateLot, senza toccare l'acquisto", () => {
      const r = buildPhotoEvents([expiryDiff], ctxOf());
      expect(r.errors).toEqual([]);
      expect(r.events).toHaveLength(1);
      expect(r.events[0]).toMatchObject({ type: "updateLot", lotId: "lot-latte", patch: { expiry: { date: "2026-11-22", kind: "best_before" } }, certainty: "estimated", source: "photo", note: PHOTO_NOTE });
      expect(r.events.some((e) => e.type === "void" || e.type === "purchase" || e.type === "declare")).toBe(false);
      expect(validateEvent(r.events[0])).toEqual([]);
      const after = derivePantry([...events, ...r.events]).lots.find((l) => l.lotId === "lot-latte");
      expect(after?.expiry).toEqual({ date: "2026-11-22", kind: "best_before" });
      expect(after?.initialCertainty).toBe("label");
      expect(r.written[0].summary).toBe("Latte intero: scadenza 22 nov 2026");
    });

    it("usa lo stato attuale del lotto: una scadenza già uguale non produce niente", () => {
      const withUpdate = [...events, updateLot("u1", "2026-11-12T10:00:00.000Z", { lotId: "lot-latte", patch: { expiry: { date: "2026-11-22", kind: "best_before" } } })];
      const state = derivePantry(withUpdate);
      const lots = toExpectedLots(state.lots.filter((l) => l.location === "frigo"));
      const r = buildPhotoEvents([expiryDiff], ctxOf({ events: withUpdate, lotsById: lots.lotsById, voidedEventIds: state.voidedEventIds }));
      expect(r.events).toEqual([]);
      expect(r.errors).toEqual([{ key: "x", message: "La scadenza è già questa." }]);
    });

    it("da consumare presto: scadenza stimata, dichiarata tale", () => {
      const soon = diff({ key: "s", kind: "use_soon", lotId: "L2", name: "Yogurt bianco", change: { type: "expiry", expiry: { date: "2026-11-19", kind: "estimated" } } });
      const r = buildPhotoEvents([soon], ctxOf());
      expect(r.events[0]).toMatchObject({ type: "updateLot", lotId: "lot-yogurt", patch: { expiry: { date: "2026-11-19", kind: "estimated" } } });
      expect(r.written[0].summary).toContain("(stimata)");
    });

    it("se l'acquisto è stato annullato non si può correggere", () => {
      const v = voidOf("v1", "2026-11-13T10:00:00.000Z", "e1");
      const withVoid = [...events, v];
      const state = derivePantry(withVoid);
      const r = buildPhotoEvents([expiryDiff], ctxOf({ events: withVoid, voidedEventIds: state.voidedEventIds }));
      expect(r.events).toEqual([]);
      expect(r.errors[0].message).toMatch(/acquisto/);
    });
  });

  it("un lotto che non c'è più o un id sconosciuto: errore, nessun evento", () => {
    const r = buildPhotoEvents([diff({ lotId: "L99", change: { type: "adjust", remaining: { value: 1, unit: "ml" } } }), diff({ key: "y", lotId: undefined, change: { type: "expiry", expiry: { date: "2026-12-01", kind: "best_before" } } })], ctxOf());
    expect(r.events).toEqual([]);
    expect(r.errors).toHaveLength(2);
  });

  it("scrive solo le differenze confermate, nell'ordine dato, con id diversi", () => {
    const confirmed = [
      diff({ key: "a", change: { type: "adjust", remaining: { value: 500, unit: "ml" } } }),
      diff({ key: "b", lotId: "L2", name: "Yogurt bianco", change: { type: "adjust", remaining: { value: 2, unit: "pz" } } }),
    ];
    const r = buildPhotoEvents(confirmed, ctxOf());
    expect(r.written.map((w) => w.key)).toEqual(["a", "b"]);
    expect(new Set(r.events.map((e) => e.id)).size).toBe(2);
  });

  it("annullabile con un void per evento, come ogni altra scrittura", () => {
    const r = buildPhotoEvents([diff({ change: { type: "adjust", remaining: { value: 500, unit: "ml" } } })], ctxOf());
    const undo = r.events.map((e) => voidEvent(e, { now: () => NOW, deviceId: "dev-1" }));
    expect(derivePantry([...events, ...r.events, ...undo]).lots.find((l) => l.lotId === "lot-latte")?.remaining).toBe(1000);
  });

  it("dopo un vecchio riallineamento il lotto riparte da quello nuovo", () => {
    const withAdjust = [...events, adjust("a1", "2026-11-12T10:00:00.000Z", { lotId: "lot-latte", remaining: q(800, "ml") })];
    const state = derivePantry(withAdjust);
    const lots = toExpectedLots(state.lots.filter((l) => l.location === "frigo"));
    expect(lots.expected[0].remaining.value).toBe(800);
  });
});

describe("mappa delle zone dalle conferme", () => {
  it("ogni conferma con una zona diventa un'osservazione; senza zona no", () => {
    const confirmed = [diff({ zone: "sportello", change: { type: "adjust", remaining: { value: 1, unit: "ml" } } }), diff({ key: "z", change: { type: "adjust", remaining: { value: 1, unit: "ml" } } })];
    expect(zoneObservations(confirmed, "frigo", NOW)).toEqual([{ location: "frigo", food: "cat:milk_fresh", zone: "sportello", at: NOW }]);
  });

  it("si accumula nel tempo nell'archivio locale, e regge un contenuto rovinato", async () => {
    const store = memorySettingsStore();
    expect(await loadZoneMap(store)).toEqual({});
    await recordZones(store, [{ location: "frigo", food: "cat:milk_fresh", zone: "sportello", at: NOW }]);
    const map = await recordZones(store, [{ location: "frigo", food: "cat:milk_fresh", zone: "sportello", at: NOW }]);
    expect(map["frigo:cat:milk_fresh"].counts).toEqual({ sportello: 2 });
    expect(await loadZoneMap(memorySettingsStore("rovinato"))).toEqual({});
    expect(await recordZones(memorySettingsStore(42), [])).toEqual({});
  });
});

describe("scanPantry con una risposta simulata", () => {
  const reply = (body: unknown) =>
    new Response(JSON.stringify({ type: "message", model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify(body) }], stop_reason: "end_turn", usage: { input_tokens: 2500, output_tokens: 400 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  it("dall'elenco atteso alle differenze, senza scrivere niente e senza fidarsi di id inventati", async () => {
    const store = memorySettingsStore();
    await setApiKey(store, "anthropic", KEY, NOW);
    const fetchImpl = vi.fn(async () =>
      reply({
        lots: [
          { id: "L1", status: "seen", confidence: 0.9, level: { fraction: 0.5, confidence: 0.85 }, zone: "sportello" },
          { id: "L2", status: "not_seen", confidence: 0.3 },
          { id: "L3", status: "absent", confidence: 0.9 },
          { id: "L77", status: "absent", confidence: 1 },
        ],
        unexpected: [{ name: "Burro", quantity: 250, unit: "g", confidence: 0.9, zone: "ripiano_alto" }],
      }),
    ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

    const out = await scanPantry({ store, zoneStore: memorySettingsStore(), location: "frigo", lots: fridge, images: [{ mediaType: "image/jpeg", dataBase64: "QUJD" }], today: "2026-11-17", now: () => NOW, fetchImpl });

    const sent = JSON.parse(String((fetchImpl.mock.calls[0] as unknown[])[1] ? ((fetchImpl.mock.calls[0] as unknown[])[1] as RequestInit).body : "{}")) as { system: string };
    expect(sent.system).toContain("L1 | Latte intero");
    expect(sent.system).not.toContain("lot-latte");

    expect(out.differences.map((d) => d.key).sort()).toEqual(["L1:quantity", "L3:finished", "new:0"]);
    expect(out.differences.every((d) => d.lotId !== "L2" && d.lotId !== "L77")).toBe(true);
    expect(out.scan.problems.some((p) => p.code === "unknown_id")).toBe(true);
    expect(out.usage).toEqual({ inputTokens: 2500, outputTokens: 400 });
    // il registro non è stato toccato: nessuno scrive senza conferma
    expect(fridge.find((l) => l.lotId === "lot-latte")?.remaining).toBe(1000);
  });

  it("una risposta illeggibile non è un errore: nessuna differenza, e tutto vale non visto", async () => {
    const store = memorySettingsStore();
    await setApiKey(store, "anthropic", KEY, NOW);
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ type: "message", model: "m", content: [{ type: "text", text: "Non vedo bene." }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200 }),
    ) as unknown as typeof fetch;
    const out = await scanPantry({ store, zoneStore: memorySettingsStore(), location: "frigo", lots: fridge, images: [], today: "2026-11-17", now: () => NOW, fetchImpl });
    expect(out.differences).toEqual([]);
    expect(out.scan.lots.every((l) => l.status === "not_seen")).toBe(true);
  });
});
