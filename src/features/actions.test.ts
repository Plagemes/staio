import { describe, expect, it } from "vitest";
import { derivePantry, type LedgerEvent, type Lot } from "@/core/ledger";
import {
  buildConsume,
  buildConsumeMany,
  buildEditMany,
  buildForLots,
  buildMove,
  buildSetExpiry,
  buildDiscard,
  buildEdit,
  buildFinish,
  buildRemoveMany,
  buildRemoveMistaken,
  buildOpen,
  buildUndo,
  findCreationEvent,
  formFromLot,
  needsSameProductAnswer,
  parseAmountForLot,
  type ActionContext,
  type EditForm,
} from "./actions";
import { buildCaptureEvents } from "./capture";
import { buildJournal } from "./journal";

const NOW = "2026-11-16T10:00:00.000Z";
const LATER = "2026-11-16T12:30:00.000Z";
const ctx = (now = LATER): ActionContext => ({ now, deviceId: "d" });

function setup(over: Record<string, unknown> = {}) {
  const r = buildCaptureEvents(
    {
      name: "Latte intero",
      quantityText: "1 l",
      location: "frigo",
      category: "milk_fresh",
      expiryKind: "use_by",
      expiryDate: "2026-11-20",
      priceText: "1,49",
      alreadyHave: false,
      ...over,
    },
    { now: NOW, deviceId: "d" },
  );
  if (!r.ok) throw new Error("setup");
  const events: LedgerEvent[] = r.events;
  const lot = derivePantry(events).lots[0] as Lot;
  return { events, lot, creation: findCreationEvent(events, lot.lotId, [])! };
}

describe("quantità per un lotto", () => {
  const lot = { unit: "g", remaining: 400 } as const;

  it("un numero da solo vale come l'unità del lotto", () => {
    expect(parseAmountForLot("150", lot)).toMatchObject({ ok: true, quantity: { value: 150, unit: "g" } });
  });

  it("converte le unità compatibili", () => {
    expect(parseAmountForLot("0,2 kg", lot)).toMatchObject({ ok: true, quantity: { value: 200, unit: "g" } });
  });

  it("rifiuta vuoto, unità sbagliate, zero e troppo", () => {
    for (const bad of ["", "2 l", "0", "tanto", "500 g", "2 confezioni"]) {
      expect(parseAmountForLot(bad, lot).ok, bad).toBe(false);
    }
    const tooMuch = parseAmountForLot("500 g", lot);
    expect(!tooMuch.ok && tooMuch.error).toContain("400 g");
  });

  it("un valore uguale al rimasto è esattamente il rimasto", () => {
    expect(parseAmountForLot("0,4 kg", lot)).toMatchObject({ ok: true, quantity: { value: 400 } });
  });
});

describe("mangiato", () => {
  it("tutto: il lotto finisce e la quantità è misurata", () => {
    const { events, lot } = setup();
    const r = buildConsume(lot, { kind: "all" }, ctx());
    if (!r.ok) throw new Error(r.error);
    expect(r.events[0]).toMatchObject({ type: "consume", quantity: { value: 1000, unit: "ml" }, certainty: "measured" });
    const after = derivePantry([...events, ...r.events]).lots[0];
    expect(after.status).toBe("finished");
    expect(r.message).toContain("1 l");
  });

  it("metà è una stima e lascia il resto", () => {
    const { events, lot } = setup();
    const r = buildConsume(lot, { kind: "half" }, ctx());
    if (!r.ok) throw new Error(r.error);
    expect(r.events[0].certainty).toBe("estimated");
    const after = derivePantry([...events, ...r.events]).lots[0];
    expect(after.remaining).toBe(500);
    expect(after.remainingCertainty).toBe("estimated");
  });

  it("una quantità scritta a mano non può superare il rimasto", () => {
    const { lot } = setup();
    expect(buildConsume(lot, { kind: "text", text: "2 l" }, ctx()).ok).toBe(false);
    expect(buildConsume(lot, { kind: "text", text: "200 ml" }, ctx()).ok).toBe(true);
  });

  it("su un lotto finito non c'è niente da mangiare", () => {
    const { lot } = setup();
    expect(buildConsume({ ...lot, remaining: 0 }, { kind: "all" }, ctx()).ok).toBe(false);
  });
});

describe("buttato e aperto", () => {
  it("scrive il motivo", () => {
    const { lot } = setup();
    const r = buildDiscard(lot, { kind: "all" }, "expired", ctx());
    expect(r.ok && r.events[0]).toMatchObject({ type: "discard", reason: "expired" });
  });

  it("aprire due volte non si può", () => {
    const { events, lot } = setup();
    const r = buildOpen(lot, ctx());
    if (!r.ok) throw new Error(r.error);
    const opened = derivePantry([...events, ...r.events]).lots[0];
    expect(opened.openedAt).toBe(LATER);
    expect(buildOpen(opened, ctx()).ok).toBe(false);
  });
});

describe("modifica con correctLot", () => {
  const form = (lot: Lot, over: Partial<EditForm>): EditForm => ({ ...formFromLot(lot), ...over });

  it("nessun cambiamento, nessun evento", () => {
    const { lot, creation } = setup();
    const r = buildEdit(creation, lot, formFromLot(lot), ctx());
    expect(r.ok).toBe(false);
  });

  it("cambia nome, scadenza e prezzo con un solo updateLot", () => {
    const { events, lot, creation } = setup();
    const r = buildEdit(creation, lot, form(lot, { name: "latte parzialmente scremato", expiryDate: "2026-11-22", priceText: "1,59" }), ctx());
    if (!r.ok) throw new Error(r.error);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      type: "updateLot",
      patch: { productRef: "Latte parzialmente scremato", expiry: { date: "2026-11-22", kind: "use_by" }, priceCents: 159 },
    });
    const after = derivePantry([...events, ...r.events]).lots[0];
    expect(after.productRef).toBe("Latte parzialmente scremato");
    expect(after.expiry?.date).toBe("2026-11-22");
    expect(after.priceCents).toBe(159);
  });

  it("una seconda modifica sulla stessa cosa usa lo stato attuale e vince l'ultima", () => {
    const { events, lot, creation } = setup();
    const first = buildEdit(creation, lot, form(lot, { expiryDate: "2026-11-22" }), ctx(LATER));
    if (!first.ok) throw new Error(first.error);
    const lot2 = derivePantry([...events, ...first.events]).lots[0];
    // tornare alla data originale è una modifica vera rispetto allo stato attuale
    const second = buildEdit(creation, lot2, form(lot2, { expiryDate: "2026-11-20" }), ctx("2026-11-16T13:00:00.000Z"));
    if (!second.ok) throw new Error(second.error);
    const final = derivePantry([...events, ...first.events, ...second.events]).lots[0];
    expect(final.expiry?.date).toBe("2026-11-20");
  });

  it("«Nessuna data» cancella la scadenza", () => {
    const { events, lot, creation } = setup();
    const r = buildEdit(creation, lot, form(lot, { expiryKind: "none", expiryDate: "" }), ctx());
    if (!r.ok) throw new Error(r.error);
    expect(derivePantry([...events, ...r.events]).lots[0].expiry).toBeUndefined();
  });

  it("errori per campo", () => {
    const { lot, creation } = setup();
    const r = buildEdit(creation, lot, form(lot, { name: " ", expiryDate: "", priceText: "x", category: "boh" }), ctx());
    expect(r.ok).toBe(false);
    if (r.ok || !("fields" in r)) throw new Error("attesi errori per campo");
    expect(Object.keys(r.fields).sort()).toEqual(["category", "expiryDate", "name", "price"]);
  });

  it("per ciò che c'era già in casa il prezzo non si modifica", () => {
    const { lot, creation } = setup({ alreadyHave: true });
    const r = buildEdit(creation, lot, form(lot, { priceText: "3,00" }), ctx());
    expect(r.ok).toBe(false);
  });
});

describe("annulla", () => {
  it("annullare l'inserimento toglie il lotto", () => {
    const { events } = setup();
    const undo = buildUndo(events, ctx());
    expect(derivePantry([...events, ...undo]).lots).toHaveLength(0);
  });

  it("annullare «mangiato» ripristina il rimasto", () => {
    const { events, lot } = setup();
    const r = buildConsume(lot, { kind: "all" }, ctx());
    if (!r.ok) throw new Error(r.error);
    const undo = buildUndo(r.events, ctx("2026-11-16T12:31:00.000Z"));
    const state = derivePantry([...events, ...r.events, ...undo]);
    expect(state.lots[0]).toMatchObject({ remaining: 1000, status: "active" });
  });

  it("annullare una modifica ripristina i valori", () => {
    const { events, lot, creation } = setup();
    const r = buildEdit(creation, lot, formFromLot({ ...lot, productRef: "Altro nome" }), ctx());
    if (!r.ok) throw new Error(r.error);
    const undo = buildUndo(r.events, ctx("2026-11-16T12:31:00.000Z"));
    expect(derivePantry([...events, ...r.events, ...undo]).lots[0].productRef).toBe("Latte intero");
  });
});

describe("percorso completo e registro di oggi", () => {
  it("aggiungo, mangio, vedo nel registro, annullo", () => {
    const { events, lot } = setup();
    const today = "2026-11-16";
    const eat = buildConsume(lot, { kind: "text", text: "250 ml" }, ctx());
    if (!eat.ok) throw new Error(eat.error);
    const all = [...events, ...eat.events];

    const rows = buildJournal(all, derivePantry(all), today);
    expect(rows.map((r) => [r.time, r.description, r.value])).toEqual([
      ["11:00", "Entra · Latte intero", "1 l"],
      ["13:30", "Mangiato · Latte intero", "250 ml"],
    ]);
    expect(rows[0].estimated).toBe(false);

    const undo = buildUndo(eat.events, ctx("2026-11-16T12:31:00.000Z"));
    const after = [...all, ...undo];
    expect(buildJournal(after, derivePantry(after), today).map((r) => r.description)).toEqual(["Entra · Latte intero"]);
    expect(derivePantry(after).lots[0].remaining).toBe(1000);
  });

  it("gli eventi di altri giorni restano fuori", () => {
    const { events } = setup();
    expect(buildJournal(events, derivePantry(events), "2026-11-17")).toEqual([]);
  });

  it("spostamento e apertura compaiono con il luogo", () => {
    const { events, lot } = setup();
    const open = buildOpen(lot, ctx());
    if (!open.ok) throw new Error(open.error);
    const rows = buildJournal([...events, ...open.events], derivePantry([...events, ...open.events]), "2026-11-16");
    expect(rows.at(-1)).toMatchObject({ description: "Aperto · Latte intero" });
  });
});

describe("findCreationEvent", () => {
  it("ignora la creazione annullata", () => {
    const { events, creation, lot } = setup();
    expect(findCreationEvent(events, lot.lotId, [creation.id])).toBeUndefined();
    expect(findCreationEvent(events, "altro", [])).toBeUndefined();
  });
});

describe("annullare una riga del registro", () => {
  it("l'ingresso con altri movimenti non si annulla, gli altri sì", () => {
    const { events, lot } = setup();
    const eat = buildConsume(lot, { kind: "text", text: "250 ml" }, ctx());
    if (!eat.ok) throw new Error(eat.error);
    const all = [...events, ...eat.events];
    const [entry, eaten] = buildJournal(all, derivePantry(all), "2026-11-16");
    expect(entry.canUndo).toBe(false);
    expect(entry.undoBlocked).toMatch(/altri movimenti/);
    expect(eaten.canUndo).toBe(true);

    // tolto il consumo, l'ingresso torna annullabile
    const after = [...all, ...buildUndo(eat.events, ctx("2026-11-16T12:40:00.000Z"))];
    const rows = buildJournal(after, derivePantry(after), "2026-11-16");
    expect(rows).toHaveLength(1);
    expect(rows[0].canUndo).toBe(true);
  });

  it("annullare l'annullamento riporta l'evento nel registro", () => {
    const { events, lot } = setup();
    const eat = buildConsume(lot, { kind: "all" }, ctx());
    if (!eat.ok) throw new Error(eat.error);
    const voids = buildUndo(eat.events, ctx("2026-11-16T12:40:00.000Z"));
    const redo = buildUndo(voids, ctx("2026-11-16T12:41:00.000Z"));
    const all = [...events, ...eat.events, ...voids, ...redo];
    expect(buildJournal(all, derivePantry(all), "2026-11-16").map((r) => r.description)).toContain("Mangiato · Latte intero");
  });
});

describe("modifica del nome di un lotto con codice a barre", () => {
  const withCode = () => setup({ barcode: "8001234567890" });
  const form = (lot: Lot, over: Partial<EditForm>): EditForm => ({ ...formFromLot(lot), ...over });

  it("il nome uguale non fa domande", () => {
    const { lot } = withCode();
    expect(lot.barcode).toBe("8001234567890");
    expect(needsSameProductAnswer(lot, form(lot, {}))).toBe(false);
    expect(needsSameProductAnswer(lot, form(lot, { name: "  latte   intero " }))).toBe(false);
  });

  it("un altro nome senza risposta è un errore accanto alla domanda", () => {
    const { lot, creation } = withCode();
    const r = buildEdit(creation, lot, form(lot, { name: "Latte di soia" }), ctx());
    expect(r.ok).toBe(false);
    if (r.ok || !("fields" in r)) throw new Error("attesi errori per campo");
    expect(r.fields.sameProduct).toMatch(/stesso prodotto/);
  });

  it("«sì, è lo stesso» cambia il nome e tiene il codice", () => {
    const { events, lot, creation } = withCode();
    const r = buildEdit(creation, lot, form(lot, { name: "Latte intero fresco", sameProduct: "yes" }), ctx());
    if (!r.ok) throw new Error(r.error);
    const after = derivePantry([...events, ...r.events]).lots[0];
    expect(after.productRef).toBe("Latte intero fresco");
    expect(after.barcode).toBe("8001234567890");
  });

  it("«no, è un altro» toglie il codice con correctLot", () => {
    const { events, lot, creation } = withCode();
    const r = buildEdit(creation, lot, form(lot, { name: "Latte di soia", sameProduct: "no" }), ctx());
    if (!r.ok) throw new Error(r.error);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ type: "updateLot", patch: { productRef: "Latte di soia", barcode: null } });
    const after = derivePantry([...events, ...r.events]).lots[0];
    expect(after.productRef).toBe("Latte di soia");
    expect(after.barcode).toBeUndefined();
  });

  it("senza codice il cambio di nome non fa domande", () => {
    const { lot, creation } = setup();
    expect(needsSameProductAnswer(lot, form(lot, { name: "Altro" }))).toBe(false);
    expect(buildEdit(creation, lot, form(lot, { name: "Altro" }), ctx()).ok).toBe(true);
  });
});

describe("elimina dalla dispensa", () => {
  it("inserito per sbaglio: il lotto sparisce, anche con eventi successivi, e Annulla lo ripristina", () => {
    const { events, lot } = setup();
    const ev = (r: ReturnType<typeof buildConsume>) => (r.ok ? r.events : []);
    const more = [
      ...events,
      ...ev(buildConsume(lot, { kind: "half" }, ctx("2026-11-16T11:00:00.000Z"))),
      ...ev(buildOpen(lot, ctx("2026-11-16T11:10:00.000Z"))),
    ];
    for (const log of [events, more]) {
      const r = buildRemoveMistaken(lot, log, derivePantry(log).voidedEventIds, ctx());
      if (!r.ok) throw new Error(r.error);
      const after = derivePantry([...log, ...r.events]);
      expect(after.lots).toEqual([]);
      expect(after.anomalies).toEqual([]);
      const restored = derivePantry([...log, ...r.events, ...buildUndo(r.events, ctx("2026-11-16T13:00:00.000Z"))]);
      expect(restored.lots).toHaveLength(1);
      expect(restored.anomalies).toEqual([]);
    }
  });

  it("finito: azzera senza contare consumo né spreco", () => {
    const { events, lot } = setup();
    const r = buildFinish(lot, ctx());
    if (!r.ok) throw new Error(r.error);
    const l = derivePantry([...events, ...r.events]).lots[0];
    expect(l.remaining).toBe(0);
    expect(l.status).toBe("finished");
    expect(l.consumed).toBe(0);
    expect(l.discarded).toBe(0);
  });
});

describe("elimina più alimenti insieme", () => {
  function two() {
    const a = setup();
    const b = setup({ name: "Yogurt", quantityText: "500 g", category: "yogurt" });
    const events = [...a.events, ...b.events];
    const lots = derivePantry(events).lots;
    return { events, lots };
  }

  it("inseriti per sbaglio: tutti spariscono con una sola scrittura e Annulla li ripristina insieme", () => {
    const { events, lots } = two();
    let n = 0;
    const c: ActionContext = { now: LATER, deviceId: "d", idGenerator: () => `x${++n}` };
    const r = buildRemoveMany(lots, "mistaken", events, derivePantry(events).voidedEventIds, c);
    if (!r.ok) throw new Error(r.error);
    expect(r.message).toBe("Eliminati: 2 alimenti.");
    expect(new Set(r.events.map((e) => e.id)).size).toBe(r.events.length);
    const after = derivePantry([...events, ...r.events]);
    expect(after.lots).toEqual([]);
    expect(after.anomalies).toEqual([]);
    const back = derivePantry([...events, ...r.events, ...buildUndo(r.events, ctx("2026-11-16T13:00:00.000Z"))]);
    expect(back.lots).toHaveLength(2);
    expect(back.anomalies).toEqual([]);
  });

  it("finiti: tutti a zero, senza consumo né spreco, e Annulla li ripristina", () => {
    const { events, lots } = two();
    const r = buildRemoveMany(lots, "finished", events, [], ctx());
    if (!r.ok) throw new Error(r.error);
    expect(r.events).toHaveLength(2);
    const after = derivePantry([...events, ...r.events]).lots;
    expect(after.every((l) => l.remaining === 0 && l.consumed === 0 && l.discarded === 0)).toBe(true);
    const back = derivePantry([...events, ...r.events, ...buildUndo(r.events, ctx("2026-11-16T13:00:00.000Z"))]).lots;
    expect(back.every((l) => l.remaining > 0)).toBe(true);
  });

  it("un solo alimento: messaggio al singolare; nessuno: errore; uno non eliminabile: non si scrive niente", () => {
    const { events, lots } = two();
    const one = buildRemoveMany([lots[0]], "mistaken", events, [], ctx());
    expect(one.ok && one.message).toBe(`Eliminato: ${lots[0].productRef}.`);
    expect(buildRemoveMany([], "finished", events, [], ctx()).ok).toBe(false);
    const bad = buildRemoveMany(lots, "mistaken", [], [], ctx());
    expect(bad.ok).toBe(false);
  });
});

describe("confezioni uguali: consumo e cambio data", () => {
  it("tutte mangiate: un consumo per confezione; Annulla le ripristina", () => {
    const a = setup();
    const b = setup();
    const events = [...a.events, ...b.events];
    const lots = derivePantry(events).lots;
    const r = buildConsumeMany(lots, ctx());
    if (!r.ok) throw new Error(r.error);
    expect(r.events).toHaveLength(2);
    expect(derivePantry([...events, ...r.events]).lots.every((l) => l.remaining === 0)).toBe(true);
    const back = derivePantry([...events, ...r.events, ...buildUndo(r.events, ctx("2026-11-16T13:00:00.000Z"))]).lots;
    expect(back.every((l) => l.remaining > 0)).toBe(true);
  });

  it("cambia la data di una sola confezione senza toccare le altre", () => {
    const a = setup();
    const b = setup();
    const events = [...a.events, ...b.events];
    const lots = derivePantry(events).lots;
    const r = buildSetExpiry([lots[0]], { date: "2026-12-01", kind: "use_by" }, events, [], ctx());
    if (!r.ok) throw new Error(r.error);
    const after = derivePantry([...events, ...r.events]).lots;
    expect(after.filter((l) => l.expiry?.date === "2026-12-01")).toHaveLength(1);
    expect(after.filter((l) => l.expiry?.date === "2026-11-20")).toHaveLength(1);
    expect(buildSetExpiry([lots[0]], { date: "2026-02-31", kind: "use_by" }, events, [], ctx()).ok).toBe(false);
  });
});

describe("azioni su più confezioni uguali", () => {
  const pair = () => {
    const a = setup({ expiryDate: "2026-11-20" });
    const b = setup({ expiryDate: "2026-11-28" });
    const events = [...a.events, ...b.events];
    return { events, lots: derivePantry(events).lots };
  };

  it("sposta tutte, o nessuna se una fallisce", () => {
    const { lots } = pair();
    const ok = buildForLots(lots, (l) => buildMove(l, "freezer", ctx()), (n) => `Spostate ${n}`);
    if (!ok.ok) throw new Error(ok.error);
    expect(ok.events).toHaveLength(2);
    const bad = buildForLots(lots, (l) => buildMove(l, "frigo", ctx()), () => "x");
    expect(bad.ok).toBe(false);
  });

  it("modifica il nome di tutte senza toccare le date diverse", () => {
    const { events, lots } = pair();
    const targets = lots.map((lot) => ({ lot, creation: findCreationEvent(events, lot.lotId, [])! }));
    const r = buildEditMany(targets, lots[0], { ...formFromLot(lots[0]), name: "Latte magro" }, ctx());
    if (!r.ok) throw new Error(r.error);
    const after = derivePantry([...events, ...r.events]).lots;
    expect(after.every((l) => l.productRef === "Latte magro")).toBe(true);
    expect(after.map((l) => l.expiry?.date).sort()).toEqual(["2026-11-20", "2026-11-28"]);
    expect(buildEditMany(targets, lots[0], formFromLot(lots[0]), ctx()).ok).toBe(false);
  });
});
