// Durata dopo l'apertura per prodotto: dal codice a barre al lotto, fino alla scadenza mostrata.
import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { derivePantry, validateEvent, type LedgerEvent, type Lot } from "@/core/ledger";
import { buildOpen } from "./actions";
import { buildCaptureEvents } from "./capture";
import { readCaptureParams, resolveCaptureFields } from "./captureParams";
import { buildPackInputs, draftFromProduct, inputFromDraft } from "./barcode/directAdd";
import { captureHref } from "./barcode/links";
import { evaluateLots, expiryExplanation, expiryTagView, type PantryEntry } from "./lots";
import { saveActions } from "./pantry/saveActions";

const NOW = "2026-11-12T10:00:00.000Z";
const ctx = { now: "2026-11-10T08:00:00.000Z", deviceId: "d" };

const YOGURT: Product = {
  barcode: "8001234567890",
  name: "Yogurt bianco",
  quantity: { text: "125 g", value: 125, unit: "g" },
  categories: ["yogurts"],
  daysAfterOpening: 10,
  fetchedAt: "2026-11-10T08:00:00.000Z",
  source: "openfoodfacts",
};

function bought(product: Product = YOGURT): LedgerEvent[] {
  const draft = draftFromProduct(product);
  const input = inputFromDraft({ ...draft, category: "yogurt" }, "frigo");
  const r = buildCaptureEvents(input, ctx);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.events;
}

const entryOf = (events: LedgerEvent[]): PantryEntry => evaluateLots(derivePantry(events).lots, NOW)[0];

describe("dal prodotto al lotto", () => {
  it("l'acquisto da codice a barre porta con sé la durata del prodotto", () => {
    const events = bought();
    expect(events[0]).toMatchObject({ type: "purchase", source: "barcode", daysAfterOpening: 10 });
    expect(validateEvent(events[0])).toEqual([]);
    expect(derivePantry(events).lots[0].daysAfterOpening).toBe(10);
  });

  it("senza il dato, o con un dato inutilizzabile, l'evento resta com'era", () => {
    const { daysAfterOpening: _drop, ...plain } = YOGURT;
    void _drop;
    expect(bought(plain)[0]).not.toHaveProperty("daysAfterOpening");
    expect(bought({ ...YOGURT, daysAfterOpening: 0 })[0]).not.toHaveProperty("daysAfterOpening");
    const draft = draftFromProduct({ ...YOGURT, daysAfterOpening: 2.5 });
    expect(draft).not.toHaveProperty("daysAfterOpening");
    const direct = buildCaptureEvents({ ...inputFromDraft({ ...draftFromProduct(YOGURT), category: "yogurt" }, "frigo"), daysAfterOpening: 99999 }, ctx);
    expect(direct.ok && direct.events[0]).not.toHaveProperty("daysAfterOpening");
  });

  it("più confezioni dello stesso prodotto: ognuna porta la durata", () => {
    const inputs = buildPackInputs({ ...draftFromProduct(YOGURT), category: "yogurt" }, "frigo", {}, [{ count: 3, expiryDate: "" }]);
    expect(inputs).toHaveLength(3);
    expect(inputs.every((i) => i.daysAfterOpening === 10)).toBe(true);
  });

  it("anche dal modulo completo la durata passa dall'indirizzo, e si perde se si scollega il codice", () => {
    const href = captureHref(YOGURT);
    const params = readCaptureParams((k) => new URL(href, "https://esempio.test").searchParams.get(k));
    expect(params).toMatchObject({ barcode: YOGURT.barcode, daysAfterOpening: 10 });
    expect(resolveCaptureFields(params, {}).daysAfterOpening).toBe(10);
    expect(resolveCaptureFields(params, { barcode: null }).daysAfterOpening).toBeUndefined();
    // senza codice a barre il parametro non vale
    expect(readCaptureParams((k) => (k === "apertura" ? "10" : null))).toEqual({});
  });
});

describe("scadenza dopo l'apertura", () => {
  const openedLot = (events: LedgerEvent[]): LedgerEvent[] => {
    const lot = derivePantry(events).lots[0];
    const opened = buildOpen(lot, { now: "2026-11-11T08:00:00.000Z", deviceId: "d" });
    if (!opened.ok) throw new Error(opened.error);
    return [...events, ...opened.events];
  };
  const SHORT: Product = { ...YOGURT, daysAfterOpening: 2 };

  it("un dato del prodotto più breve della categoria vale e lo dice", () => {
    const entry = entryOf(openedLot(bought(SHORT)));
    expect(entry.expiry).toMatchObject({ date: "2026-11-13", basis: "opened", certainty: "estimated", openedFrom: "product" });
    expect(expiryExplanation(entry)).toBe(
      "Dopo l'apertura: entro 13 nov 2026. Durata dai dati di Open Food Facts, più breve della stima per categoria.",
    );
    expect(expiryTagView(entry)?.estimated).toBe(true);
  });

  it("un dato più lungo della categoria non allunga: vale la categoria e lo dice", () => {
    const entry = entryOf(openedLot(bought()));
    expect(entry.expiry).toMatchObject({ date: "2026-11-15", basis: "opened", certainty: "estimated" });
    expect(entry.expiry).not.toHaveProperty("openedFrom");
    expect(expiryExplanation(entry)).toBe("Dopo l'apertura: entro 15 nov 2026, stima per categoria");
  });

  it("non supera la data stampata", () => {
    const r = buildCaptureEvents({ ...inputFromDraft({ ...draftFromProduct(SHORT), category: "yogurt" }, "frigo", { expiryKind: "use_by", expiryDate: "2026-11-12" }) }, ctx);
    if (!r.ok) throw new Error("non valido");
    const entry = entryOf(openedLot(r.events));
    expect(entry.expiry).toMatchObject({ date: "2026-11-12", basis: "label" });
    expect(expiryExplanation(entry)).toBe("Da consumare entro 12 nov 2026");
  });

  it("un vecchio acquisto senza il campo funziona come prima", () => {
    const old = bought()[0] as unknown as Record<string, unknown>;
    delete old.daysAfterOpening;
    const entry = entryOf(openedLot([old as unknown as LedgerEvent]));
    expect(entry.expiry).toMatchObject({ date: "2026-11-15", certainty: "estimated" });
  });
});

describe("salvare ciò che sta scadendo", () => {
  const lotEntry = (over: Partial<Lot>, now = NOW): PantryEntry => {
    const [lot] = derivePantry(bought()).lots;
    return evaluateLots([{ ...lot, ...over }], now)[0];
  };

  it("vicino alla scadenza: freezer, cosa cucinare, con cosa sta bene, in quest'ordine", () => {
    // yogurt acquistato il 10 nov: stima frigo 14 giorni, quindi 24 nov
    const entry = lotEntry({ expiry: { date: "2026-11-13", kind: "use_by" } });
    expect(entry.urgency?.level).toBe("tomorrow");
    expect(saveActions(entry)).toEqual(["freeze", "cook", "pair"]);
  });

  it("già in freezer, scongelato o non congelabile: niente freezer", () => {
    const near = { expiry: { date: "2026-11-13", kind: "use_by" as const } };
    expect(saveActions(lotEntry({ ...near, location: "freezer", frozenAt: NOW }))).not.toContain("freeze");
    expect(saveActions(lotEntry({ ...near, thawedAt: "2026-11-11T08:00:00.000Z" }))).not.toContain("freeze");
    expect(saveActions(lotEntry({ ...near, category: "beverages" }))).toEqual(["cook", "pair"]);
    // uova in guscio, verdure a foglia e surgelati (fuori dal freezer sarebbe un ricongelamento) non si propongono
    for (const category of ["eggs", "leafy_vegetables", "frozen_foods"]) {
      expect(saveActions(lotEntry({ ...near, category })), category).toEqual(["cook", "pair"]);
    }
  });

  it("scaduto, lontano dalla scadenza o finito: nessuna proposta; data di qualità passata: solo le idee", () => {
    expect(saveActions(lotEntry({ expiry: { date: "2026-11-01", kind: "use_by" } }))).toEqual([]);
    expect(saveActions(lotEntry({ expiry: { date: "2027-01-01", kind: "use_by" } }))).toEqual([]);
    expect(saveActions(lotEntry({ expiry: { date: "2026-11-13", kind: "use_by" }, remaining: 0 }))).toEqual([]);
    expect(saveActions(lotEntry({ expiry: { date: "2026-11-01", kind: "best_before" } }))).toEqual(["cook", "pair"]);
  });
});
