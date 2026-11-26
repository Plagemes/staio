import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkReceiptTotals, parseReceiptResponse } from "@/core/ai";
import { buildReceiptEvents, toReviewLines, type ReviewLine } from "./receiptEvents";
import { reviewLayout } from "./receiptReview";
import type { ReceiptReadResult } from "./readReceipt";
import {
  RECEIPT_DRAFT_DAYS,
  buildDraft,
  createDraftWriter,
  draftSummary,
  excludeWritten,
  lineIds,
  leftOutText,
  lineSignature,
  mergeWritten,
  sameReceipt,
  nothingLeftText,
  parseReceiptDraft,
  pendingLines,
  receiptIdGenerator,
  reviewWithout,
  settleSave,
  writtenReceipt,
  splitForSave,
  type LedgerView,
  type DraftStore,
  type ReceiptDraft,
} from "./receiptDraft";

const NOW = new Date("2026-11-20T10:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

const reading = parseReceiptResponse(
  JSON.stringify({
    store: "Conad",
    lines: [
      { raw: "LATTE PS 1L 1,29", name: "Latte", priceCents: 129, isFood: true, category: "milk_fresh" },
      { raw: "MOZZ BUF 125 1,99", name: "Mozzarella", quantity: 1, unit: "pz", priceCents: 199, isFood: true, category: "cheese_fresh" },
      { raw: "SACCHETTO BIO", name: "Sacchetto", priceCents: 10, isFood: false },
    ],
    totalCents: 338,
  }),
);
const result: ReceiptReadResult = {
  reading,
  check: checkReceiptTotals(reading),
  usage: { inputTokens: 1200, outputTokens: 300 },
  usageEstimated: false,
  provider: "anthropic",
  model: "m",
  cost: 0.01,
  currency: "EUR",
  truncated: false,
};

function draftAt(savedAt: Date, over: Partial<ReceiptDraft> = {}): ReceiptDraft {
  const lines = toReviewLines(reading);
  return {
    ...buildDraft(
      {
        readingId: "r1",
        readAt: new Date(NOW.getTime() - DAY).toISOString(),
        result,
        lines,
        layout: reviewLayout(lines),
        open: { "line-0": true },
        storeName: "Conad",
        date: "2026-11-19",
        readingNo: 1,
      },
      savedAt,
    ),
    ...over,
  };
}

/** Come lo rende l'archivio: una copia fatta di sola JSON. */
const stored = (d: ReceiptDraft): unknown => JSON.parse(JSON.stringify(d));

describe("parseReceiptDraft", () => {
  it("andata e ritorno: righe, layout, scelte, negozio e data", () => {
    const d = draftAt(NOW);
    d.lines[0] = { ...d.lines[0], name: "Latte intero", touched: true, expiry: { date: "2026-11-25", via: "label" } };
    const back = parseReceiptDraft(stored(d), NOW);
    expect(back).toEqual(JSON.parse(JSON.stringify(d)));
    expect(back?.lines[0].expiry).toEqual({ date: "2026-11-25", via: "label" });
    expect(back?.layout).toEqual(d.layout);
    expect(back?.open).toEqual({ "line-0": true });
    expect(back?.storeName).toBe("Conad");
    expect(back?.date).toBe("2026-11-19");
  });

  it("forme rotte o versione diversa non sono una bozza", () => {
    const good = stored(draftAt(NOW)) as Record<string, unknown>;
    const broken = [
      undefined,
      null,
      3,
      "x",
      [],
      {},
      { ...good, v: 2 },
      { ...good, savedAt: "ieri" },
      { ...good, readingId: "" },
      { ...good, lines: "no" },
      { ...good, lines: [{ key: "a" }] },
      { ...good, layout: { order: [1], excluded: [] } },
      { ...good, open: { a: "sì" } },
      { ...good, result: { reading: {} } },
      { ...good, storeName: 4 },
      { ...good, savedLineIds: [1] },
    ];
    for (const raw of broken) expect(parseReceiptDraft(raw, NOW)).toBeUndefined();
  });

  it("scade dopo 7 giorni", () => {
    const at = (days: number) => stored(draftAt(new Date(NOW.getTime() - days * DAY)));
    expect(RECEIPT_DRAFT_DAYS).toBe(7);
    expect(parseReceiptDraft(at(6.9), NOW)).toBeDefined();
    expect(parseReceiptDraft(at(7), NOW)).toBeUndefined();
    expect(parseReceiptDraft(at(8), NOW)).toBeUndefined();
  });

  it("una data nel futuro lontano non vale", () => {
    expect(parseReceiptDraft(stored(draftAt(new Date(NOW.getTime() + 3 * DAY))), NOW)).toBeUndefined();
  });
});

describe("draftSummary", () => {
  it("con il negozio, letto ieri", () => {
    expect(draftSummary(draftAt(NOW), NOW)).toBe("Conad, 3 righe, letto ieri");
  });
  it("senza negozio, letto oggi, una riga sola", () => {
    const d = draftAt(NOW, { storeName: "  ", readAt: NOW.toISOString() });
    d.lines = d.lines.slice(0, 1);
    expect(draftSummary(d, NOW)).toBe("1 riga, letto oggi");
  });
  it("giorni fa", () => {
    expect(draftSummary(draftAt(NOW, { readAt: new Date(NOW.getTime() - 3 * DAY).toISOString() }), NOW)).toBe("Conad, 3 righe, letto 3 giorni fa");
  });
});

describe("id che non si ripetono", () => {
  const lines: ReviewLine[] = toReviewLines(reading);
  const ctx = (generator: ReturnType<typeof receiptIdGenerator>) => ({ now: NOW.toISOString(), deviceId: "dev", idGenerator: generator });

  it("buildReceiptEvents dà a ogni riga gli id della riga: stessa lettura, stessi id", () => {
    const chosen = lines.filter((l) => l.include);
    const built = buildReceiptEvents(lines, { store: "Conad", date: "" }, ctx(receiptIdGenerator("r1", chosen.map((l) => l.key))));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.receiptId).toBe("r1");
    expect(built.events.map((e) => e.id)).toEqual(chosen.map((l) => lineIds("r1", l.key).eventId));
    expect(built.events.map((e) => e.lotId)).toEqual(chosen.map((l) => lineIds("r1", l.key).lotId));
  });

  it("scrivere due volte la stessa riga, anche con un'altra scelta di righe, non cambia i suoi id", () => {
    const all = lines.filter((l) => l.include);
    const first = buildReceiptEvents(lines, { store: "", date: "" }, ctx(receiptIdGenerator("r1", all.map((l) => l.key))));
    const onlySecond = lines.map((l) => (l.key === all[0].key ? { ...l, include: false } : l));
    const second = buildReceiptEvents(onlySecond, { store: "", date: "" }, ctx(receiptIdGenerator("r1", all.slice(1).map((l) => l.key))));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.events[0].id).toBe(first.events[1].id);
    expect(second.events[0].lotId).toBe(first.events[1].lotId);
  });

  it("le righe restano nell'ordine dello scontrino anche oltre la nona", () => {
    const ids = ["line-2", "line-10", "line-11"].map((k) => lineIds("r1", k).eventId);
    expect([...ids].sort()).toEqual(ids);
  });
});

const ledgerOf = (written: string[], voided: string[] = []): LedgerView => ({ written: new Set(written), voided: new Set(voided) });
const eventOf = (key: string) => lineIds("r1", key).eventId;

describe("pendingLines: il ripristino non riscrive ciò che c'è già", () => {
  it("toglie le righe dichiarate salvate e quelle i cui eventi sono nel registro", () => {
    const d = draftAt(NOW, { savedLineIds: ["line-0"] });
    const out = pendingLines(d, ledgerOf([eventOf("line-1")]));
    expect(out.lines.map((l) => l.key)).toEqual(["line-2"]);
    expect(out.saved.sort()).toEqual(["line-0", "line-1"]);
    expect(out.removed).toEqual([]);
    expect(out.inPantry).toBe(2);
    expect(out.layout.order).not.toContain("line-0");
    expect(out.layout.order).not.toContain("line-1");
    expect(out.open).toEqual({});
  });

  it("senza nulla di scritto restano tutte", () => {
    expect(pendingLines(draftAt(NOW)).lines).toHaveLength(3);
  });

  it("le righe scritte e poi annullate non tornano da salvare e si contano a parte", () => {
    const d = draftAt(NOW);
    const out = pendingLines(d, ledgerOf([eventOf("line-0"), eventOf("line-1")], [eventOf("line-0")]));
    expect(out.lines.map((l) => l.key)).toEqual(["line-2"]);
    expect(out.removed).toEqual(["line-0"]);
    expect(out.inPantry).toBe(1);
  });
});

describe("nothingLeftText: dice il vero", () => {
  it("tutto in dispensa, tutto tolto, in parte tolto", () => {
    expect(nothingLeftText(3, 0)).toBe("Questo scontrino era già in dispensa.");
    expect(nothingLeftText(0, 3)).toMatch(/erano state tolte dopo il salvataggio.*rileggile da una foto nuova/);
    expect(nothingLeftText(2, 1)).toMatch(/alcune righe sono state tolte/);
    expect(nothingLeftText(0, 3)).not.toMatch(/già in dispensa/);
  });
});

describe("splitForSave e settleSave", () => {
  const lines = toReviewLines(reading);
  const included = lines.filter((l) => l.include).map((l) => l.key);

  it("già scritte, tolte e da scrivere; le spente non si scrivono", () => {
    const out = splitForSave(lines, "r1", ledgerOf([eventOf(included[0]), eventOf(included[1])], [eventOf(included[1])]));
    expect(out.already.map((l) => l.key)).toEqual([included[0]]);
    expect(out.removed.map((l) => l.key)).toEqual([included[1]]);
    expect(out.toSave).toEqual([]);
    expect(out.todo.map((l) => l.key)).toEqual(lines.filter((l) => !l.include).map((l) => l.key));
  });

  it("senza nulla nel registro tutte le incluse sono da scrivere", () => {
    expect(splitForSave(lines, "r1", ledgerOf([])).toSave.map((l) => l.key)).toEqual(included);
  });

  it("l'indice respinto è la riga giusta, anche con righe spente in mezzo", () => {
    const withOff = lines.map((l, i) => (i === 0 ? { ...l, include: false } : l));
    const { toSave } = splitForSave(withOff, "r1", ledgerOf([]));
    const out = settleSave(toSave, [0]);
    expect(out.rejected.map((l) => l.key)).toEqual([toSave[0].key]);
    expect(out.saved.map((l) => l.key)).toEqual(toSave.slice(1).map((l) => l.key));
  });

  it("reviewWithout: toglie le entrate, tiene le respinte aperte", () => {
    const state = { lines, layout: reviewLayout(lines), open: { [included[0]]: true } as Record<string, boolean> };
    const out = reviewWithout(state, new Set([included[0]]), [included[1]]);
    expect(out.lines.map((l) => l.key)).not.toContain(included[0]);
    expect(out.layout.order).not.toContain(included[0]);
    expect(out.open).toEqual({ [included[1]]: true });
  });
});

describe("salvataggio parziale e lettura nuova: nessuna riga scritta due volte, nessuna riga vera spenta", () => {
  const first = toReviewLines(reading);
  const keys = first.filter((l) => l.include).map((l) => l.key);
  const id = { date: "2026-11-19", totalCents: 338 };

  it("una lettura nuova dello stesso scontrino riproporrebbe le righe già scritte, con id nuovi: la guardia le spegne", () => {
    const written = writtenReceipt(id, first, [keys[0]]);
    // la lettura nuova ha un altro readingId: i suoi id non coincidono con quelli già scritti
    expect(lineIds("r2", keys[0]).eventId).not.toBe(lineIds("r1", keys[0]).eventId);
    const out = excludeWritten(toReviewLines(reading), written, id);
    expect(out.same).toBe(true);
    expect(out.excluded).toBe(1);
    expect(out.lines.find((l) => l.key === keys[0])).toMatchObject({ include: false, touched: true });
    expect(out.lines.find((l) => l.key === keys[1])?.include).toBe(true);
    expect(leftOutText(1)).toBe("1 riga era già in dispensa: l'ho lasciata fuori.");
    expect(leftOutText(3)).toBe("3 righe erano già in dispensa: le ho lasciate fuori.");
  });

  it("due righe identiche nella stessa lettura: se ne scrivi una sola, si spegne una sola", () => {
    const twin = (key: string): ReviewLine => ({ ...first[0], key });
    const lines = [twin("line-0"), twin("line-1"), { ...first[1], key: "line-9" }];
    const written = writtenReceipt(id, lines, ["line-0"]);
    const out = excludeWritten(lines, written, id);
    expect(out.excluded).toBe(1);
    expect(out.lines.map((l) => l.include)).toEqual([false, true, true]);
    // scritte tutte e due: si spengono tutte e due
    const both = excludeWritten(lines, writtenReceipt(id, lines, ["line-0", "line-1"]), id);
    expect(both.lines.map((l) => l.include)).toEqual([false, false, true]);
  });

  it("due salvataggi parziali dello stesso scontrino si sommano", () => {
    const twin = (key: string): ReviewLine => ({ ...first[0], key });
    const lines = [twin("line-0"), twin("line-1")];
    const merged = mergeWritten(writtenReceipt(id, lines, ["line-0"]), writtenReceipt(id, lines, ["line-1"]));
    expect([...merged.signatures.values()]).toEqual([2]);
  });

  it("uno scontrino senza data non si riconosce: niente si spegne", () => {
    const noDate = { totalCents: 338 };
    const written = writtenReceipt(noDate, first, [keys[0]]);
    expect(sameReceipt(written, noDate)).toBe(false);
    const out = excludeWritten(first, written, noDate);
    expect(out).toMatchObject({ same: false, excluded: 0 });
    expect(out.lines.map((l) => l.include)).toEqual(first.map((l) => l.include));
  });

  it("uno scontrino diverso con la stessa data (totale diverso) non perde righe", () => {
    const written = writtenReceipt(id, first, keys);
    const other = excludeWritten(first, written, { date: id.date, totalCents: 1250 });
    expect(other).toMatchObject({ same: false, excluded: 0 });
    expect(other.lines.map((l) => l.include)).toEqual(first.map((l) => l.include));
  });

  it("senza totale da una parte, data uguale basta; con totali uguali è lo stesso", () => {
    const written = writtenReceipt({ date: id.date }, first, [keys[0]]);
    expect(sameReceipt(written, id)).toBe(true);
    expect(sameReceipt(writtenReceipt(id, first, []), { date: id.date, totalCents: 338 })).toBe(true);
    expect(sameReceipt(writtenReceipt(id, first, []), { date: "2026-11-20", totalCents: 338 })).toBe(false);
  });

  it("le firme guardano testo stampato e prezzo, non maiuscole né spazi", () => {
    const l = first[0];
    expect(lineSignature(l)).toBe(lineSignature({ ...l, raw: `  ${l.raw.toUpperCase()}  ` }));
    expect(lineSignature(l)).not.toBe(lineSignature({ ...l, priceCents: 1 }));
    expect(excludeWritten(first, null, id)).toMatchObject({ same: false, excluded: 0 });
  });
});

describe("createDraftWriter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function fakeStore() {
    const log: string[] = [];
    let value: ReceiptDraft | undefined;
    const store: DraftStore = {
      async get() {
        return value;
      },
      async set(d) {
        log.push(`set:${d.storeName}`);
        await Promise.resolve();
        value = d;
      },
      async remove() {
        log.push("remove");
        value = undefined;
      },
    };
    return { store, log, value: () => value };
  }

  it("scrive dopo 500 ms senza altri cambi, e una volta sola", async () => {
    const f = fakeStore();
    const w = createDraftWriter(f.store);
    w.schedule(draftAt(NOW, { storeName: "A" }));
    await vi.advanceTimersByTimeAsync(300);
    w.schedule(draftAt(NOW, { storeName: "B" }));
    await vi.advanceTimersByTimeAsync(300);
    expect(f.log).toEqual([]);
    await vi.advanceTimersByTimeAsync(300);
    expect(f.log).toEqual(["set:B"]);
  });

  it("clear toglie la bozza e ciò che era in attesa non la rimette", async () => {
    const f = fakeStore();
    const w = createDraftWriter(f.store);
    await w.writeNow(draftAt(NOW, { storeName: "A" }));
    w.schedule(draftAt(NOW, { storeName: "B" }));
    await w.clear();
    await vi.advanceTimersByTimeAsync(2000);
    expect(f.log).toEqual(["set:A", "remove"]);
    expect(f.value()).toBeUndefined();
  });

  it("una scrittura per volta, nell'ordine; clear aspetta quella in corso", async () => {
    const f = fakeStore();
    const w = createDraftWriter(f.store);
    const a = w.writeNow(draftAt(NOW, { storeName: "A" }));
    const b = w.clear();
    await Promise.all([a, b]);
    expect(f.log).toEqual(["set:A", "remove"]);
    expect(f.value()).toBeUndefined();
  });

  it("flush scrive subito ciò che è in attesa (uscendo dalla pagina)", async () => {
    const f = fakeStore();
    const w = createDraftWriter(f.store);
    w.schedule(draftAt(NOW, { storeName: "A" }));
    await w.flush();
    expect(f.log).toEqual(["set:A"]);
  });

  it("un errore dell'archivio non ferma le scritture dopo", async () => {
    const log: string[] = [];
    let fail = true;
    const store: DraftStore = {
      get: async () => undefined,
      set: async (d) => {
        if (fail) {
          fail = false;
          throw new Error("quota");
        }
        log.push(d.storeName);
      },
      remove: async () => undefined,
    };
    const w = createDraftWriter(store);
    await w.writeNow(draftAt(NOW, { storeName: "A" }));
    await w.writeNow(draftAt(NOW, { storeName: "B" }));
    expect(log).toEqual(["B"]);
  });
});
