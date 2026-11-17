import { describe, expect, it } from "vitest";
import { derivePantry, type LedgerEvent, type Lot } from "@/core/ledger";
import {
  buildConsume,
  buildDiscard,
  buildEdit,
  buildOpen,
  buildUndo,
  findCreationEvent,
  formFromLot,
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
