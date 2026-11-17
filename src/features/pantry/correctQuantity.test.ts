// «Correggi»: la quantità che resta si corregge con un `adjust` o riscrivendo la creazione, mai con un consumo finto.
import { describe, expect, it } from "vitest";
import { derivePantry, piecesOf, validateEvent, type DeclareEvent, type LedgerEvent, type Lot, type PurchaseEvent } from "@/core/ledger";
import { adjust, consume, declare, discard, purchase, q, seededRandom, shuffled } from "@/core/ledger/test-helpers";
import { buildEdit, buildUndo, findCreationEvent, formFromLot, type ActionContext } from "../actions";
import { buildRealign } from "../realign";
import { buildQuantityCorrection, initialFor, mergeCorrection, overInitialQuestion } from "./correctQuantity";

const D = (day: number, h = 10) => `2026-11-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;
const NOW = D(16, 12);

function ctx(now = NOW): ActionContext {
  let n = 0;
  return { now, deviceId: "dev-a", idGenerator: () => `n${String(++n).padStart(3, "0")}` };
}

const POLLO = purchase("p1", D(10), {
  lotId: "L1",
  productRef: "Petto di pollo",
  category: "poultry",
  quantity: q(400),
  location: "frigo",
  priceCents: 599,
  expiry: { date: "2026-11-20", kind: "use_by" },
});
const UOVA = declare("d1", D(10), { lotId: "U1", productRef: "Uova", quantity: q(6, "pz"), location: "frigo" });
const DUE_UOVA = [consume("c1", D(11), { lotId: "U1", quantity: q(1, "pz") }), consume("c2", D(12), { lotId: "U1", quantity: q(1, "pz") })];

function stateOf(log: readonly LedgerEvent[], lotId: string): { lot: Lot; creation: PurchaseEvent | DeclareEvent } {
  const pantry = derivePantry(log);
  const lot = pantry.lots.find((l) => l.lotId === lotId)!;
  return { lot, creation: findCreationEvent(log, lotId, pantry.voidedEventIds)! };
}

/** Corregge e controlla ciò che vale sempre: eventi validi, nessun consumo o scarto, rimasto derivato uguale a quello voluto. */
function corrected(log: readonly LedgerEvent[], lotId: string, remaining: number, context = ctx()) {
  const { lot, creation } = stateOf(log, lotId);
  const result = buildQuantityCorrection({ lot, creation, remaining, log, ctx: context });
  if (!result.ok) throw new Error(result.error);
  for (const e of result.events) {
    expect(validateEvent(e)).toEqual([]);
    expect(["consume", "discard", "gift"]).not.toContain(e.type);
    expect(e.deviceId).toBe("dev-a");
  }
  const all = [...log, ...result.events];
  const after = derivePantry(all);
  // il risultato non dipende dall'ordine in cui gli eventi arrivano
  const random = seededRandom(7);
  for (let i = 0; i < 10; i++) expect(derivePantry(shuffled(all, random))).toEqual(after);
  expect(after.anomalies).toEqual([]);
  const next = after.lots.find((l) => l.lotId === lotId)!;
  expect(next.remaining).toBeCloseTo(remaining, 6);
  return { events: result.events, lot: next, before: lot, all };
}

describe("buildQuantityCorrection", () => {
  it("13. 400 g, ne restano 250: un adjust, rimasto 250, nessun consumo", () => {
    const { events, lot } = corrected([POLLO], "L1", 250);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "adjust",
      lotId: "L1",
      remaining: { value: 250, unit: "g" },
      certainty: "measured",
      source: "manual",
      at: NOW,
      recordedAt: NOW,
    });
    expect(lot).toMatchObject({ initial: 400, remaining: 250, consumed: 0, discarded: 0, remainingCertainty: "measured" });
  });

  it("13. vale anche verso l'alto, fino alla quantità di partenza", () => {
    const log = [POLLO, consume("c1", D(11), { lotId: "L1", quantity: q(300) })];
    const up = corrected(log, "L1", 250);
    expect(up.events.map((e) => e.type)).toEqual(["adjust"]);
    expect(up.lot).toMatchObject({ initial: 400, remaining: 250, consumed: 300 });
    const full = corrected(log, "L1", 400);
    expect(full.events.map((e) => e.type)).toEqual(["adjust"]);
    expect(full.lot.initial).toBe(400);
  });

  it("14. 6 uova entrate, 2 mangiate, ne restano 10: la creazione passa a 12, i consumi restano", () => {
    const log = [UOVA, ...DUE_UOVA];
    const { events, lot, all } = corrected(log, "U1", 10);
    expect(events.map((e) => e.type)).toEqual(["void", "declare", "adjust"]);
    expect(events[2]).toMatchObject({ lotId: "U1", remaining: { value: 10, unit: "pz" }, certainty: "measured", at: NOW });
    expect(events[0]).toMatchObject({ targetEventId: "d1" });
    expect(events[1]).toMatchObject({ lotId: "U1", replaces: "d1", at: UOVA.at, quantity: { value: 12, unit: "pz" }, productRef: "Uova" });
    expect(lot).toMatchObject({ lotId: "U1", initial: 12, consumed: 2, remaining: 10, unit: "pz" });
    expect(lot.history.filter((h) => h.type === "consume").map((h) => h.eventId)).toEqual(["c1", "c2"]);
    expect(derivePantry(all).lots).toHaveLength(1);
  });

  it("14. un acquisto riscritto tiene prezzo, scadenza e categoria", () => {
    const log = [POLLO, consume("c1", D(11), { lotId: "L1", quantity: q(100) })];
    const { events, lot } = corrected(log, "L1", 500);
    expect(events.map((e) => e.type)).toEqual(["void", "purchase", "adjust"]);
    expect(lot).toMatchObject({
      initial: 600,
      consumed: 100,
      remaining: 500,
      priceCents: 599,
      category: "poultry",
      expiry: { date: "2026-11-20", kind: "use_by" },
      createdAt: POLLO.at,
    });
  });

  it("14. anche ciò che è stato buttato resta dov'è", () => {
    const log = [POLLO, discard("x1", D(11), { lotId: "L1", quantity: q(150), reason: "expired" })];
    const { lot } = corrected(log, "L1", 450);
    expect(lot).toMatchObject({ initial: 600, discarded: 150, consumed: 0, remaining: 450 });
  });

  it("15. dopo un «Controlla le quantità»: verso il basso basta un adjust", () => {
    const log: LedgerEvent[] = [POLLO];
    const realign = buildRealign(stateOf(log, "L1").lot, { kind: "text", text: "300" }, { now: D(14), deviceId: "dev-a", idGenerator: () => "r1" });
    if (!realign.ok) throw new Error(realign.error);
    const { events, lot } = corrected([...log, ...realign.events], "L1", 250);
    expect(events.map((e) => e.type)).toEqual(["adjust"]);
    expect(lot).toMatchObject({ initial: 400, remaining: 250 });
  });

  it("15. dopo un «Controlla le quantità»: oltre la partenza la creazione si riscrive e un adjust fissa il rimasto", () => {
    const log = [POLLO, consume("c1", D(11), { lotId: "L1", quantity: q(50) }), adjust("a1", D(14), { lotId: "L1", remaining: q(300) })];
    const { events, lot } = corrected(log, "L1", 500);
    expect(events.map((e) => e.type)).toEqual(["void", "purchase", "adjust"]);
    // la quantità di partenza cresce di quanto serve: rimasto voluto più ciò che è uscito davvero (50 mangiati),
    // non la differenza tra partenza e rimasto (100), che il controllo di prima ha allargato
    expect(events[1]).toMatchObject({ quantity: { value: 550, unit: "g" } });
    expect(events[2]).toMatchObject({ remaining: { value: 500, unit: "g" }, at: NOW });
    expect(events[2].recordedAt > events[1].recordedAt).toBe(true);
    expect(lot).toMatchObject({ initial: 550, consumed: 50, remaining: 500 });
    expect(lot.remaining).toBeLessThanOrEqual(lot.initial);
  });

  it("15. dopo un «Controlla le quantità» e un altro consumo: il rimasto finale è quello voluto", () => {
    const log = [
      POLLO,
      adjust("a1", D(12), { lotId: "L1", remaining: q(200) }),
      consume("c1", D(13), { lotId: "L1", quantity: q(80) }),
    ];
    expect(stateOf(log, "L1").lot.remaining).toBe(120);
    expect(corrected(log, "L1", 90).events.map((e) => e.type)).toEqual(["adjust"]);
    const more = corrected(log, "L1", 450);
    expect(more.lot).toMatchObject({ remaining: 450, consumed: 80 });
    expect(more.lot.initial).toBeGreaterThanOrEqual(450);
  });

  it("quanto è uscito: mangiato, buttato e regalato, non la differenza tra partenza e rimasto", () => {
    const log = [
      POLLO,
      consume("c1", D(11), { lotId: "L1", quantity: q(60) }),
      discard("x1", D(12), { lotId: "L1", quantity: q(40), reason: "expired" }),
      adjust("a1", D(13), { lotId: "L1", remaining: q(100) }),
    ];
    const { lot } = stateOf(log, "L1");
    expect(lot).toMatchObject({ initial: 400, remaining: 100, consumed: 60, discarded: 40 });
    expect(initialFor(lot, 500)).toBe(600);
    expect(corrected(log, "L1", 500).lot).toMatchObject({ initial: 600, remaining: 500, consumed: 60, discarded: 40 });
  });

  it("unione con un altro telefono: un consumo fatto prima e arrivato dopo non sposta il rimasto, in nessuno dei due casi", () => {
    const log = [POLLO, consume("c1", D(11), { lotId: "L1", quantity: q(100) })];
    // fatto prima della correzione sull'altro telefono, arriva solo con l'unione
    const late = consume("cB", D(12), { lotId: "L1", quantity: q(50), deviceId: "dev-b" });
    for (const wanted of [250, 600]) {
      const { all } = corrected(log, "L1", wanted);
      const merged = [...all, late];
      const expected = derivePantry(merged);
      const random = seededRandom(wanted);
      for (let i = 0; i < 20; i++) expect(derivePantry(shuffled(merged, random))).toEqual(expected);
      expect(expected.anomalies).toEqual([]);
      const lot = expected.lots.find((l) => l.lotId === "L1")!;
      expect(lot.remaining).toBe(wanted);
      expect(lot.consumed).toBe(150);
      expect(lot.remaining).toBeLessThanOrEqual(lot.initial);
    }
  });

  it("valore uguale a quello che risulta (entro un millesimo): nessun evento", () => {
    const log = [POLLO, consume("c1", D(11), { lotId: "L1", quantity: q(150) })];
    const { lot, creation } = stateOf(log, "L1");
    for (const same of [250, 250.0004, 249.9996]) {
      expect(buildQuantityCorrection({ lot, creation, remaining: same, log, ctx: ctx() })).toEqual({ ok: true, events: [] });
    }
    expect(corrected(log, "L1", 250.01).events).toHaveLength(1);
  });

  it("valore non valido: errore e nessun evento", () => {
    const { lot, creation } = stateOf([POLLO], "L1");
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(buildQuantityCorrection({ lot, creation, remaining: bad, log: [POLLO], ctx: ctx() })).toEqual({
        ok: false,
        error: "Scrivi quanto ne resta, per esempio 250.",
      });
    }
  });

  it("se il registro non permette di arrivare al valore voluto lo dice, e non scrive niente", () => {
    // un consumo con l'orologio avanti: viene dopo qualunque correzione fatta adesso
    const log = [POLLO, consume("c9", D(20), { lotId: "L1", quantity: q(100) })];
    const { lot, creation } = stateOf(log, "L1");
    const expected = { ok: false, error: "Non riesco a correggere questa quantità. Usa «Controlla le quantità»." };
    expect(buildQuantityCorrection({ lot, creation, remaining: 250, log, ctx: ctx() })).toEqual(expected);
    // una creazione che non è quella dell'alimento
    expect(buildQuantityCorrection({ lot: stateOf([POLLO], "L1").lot, creation: UOVA, remaining: 900, log: [POLLO], ctx: ctx() })).toEqual(expected);
  });

  it("«Annulla» rimette tutto com'era, anche dopo una creazione riscritta", () => {
    const log = [UOVA, ...DUE_UOVA];
    const before = derivePantry(log).lots;
    const { events, all } = corrected(log, "U1", 10);
    const undo = buildUndo(events, { now: D(16, 13), deviceId: "dev-a", idGenerator: (() => { let n = 0; return () => `u${++n}`; })() });
    expect(derivePantry([...all, ...undo]).lots).toEqual(before);
  });

  it("gli eventi di una correzione stanno nello stesso secondo: sono una sola operazione", () => {
    const log = [POLLO, adjust("a1", D(14), { lotId: "L1", remaining: q(300) })];
    const { events } = corrected(log, "L1", 500);
    const times = events.map((e) => Date.parse(e.recordedAt));
    expect(Math.max(...times) - Math.min(...times)).toBeLessThan(1000);
  });
});

describe("mergeCorrection: quantità e altri campi in una volta sola", () => {
  const log: LedgerEvent[] = [POLLO];
  const { lot, creation } = stateOf(log, "L1");
  const form = formFromLot(lot);
  const quantityOf = (remaining: number) => buildQuantityCorrection({ lot, creation, remaining, log, ctx: ctx() });

  it("16. solo la data cambiata: solo l'updateLot, e l'avviso non parla di quantità", () => {
    const context = ctx();
    const result = mergeCorrection({
      quantity: buildQuantityCorrection({ lot, creation, remaining: lot.remaining, log, ctx: context }),
      edit: buildEdit(creation, lot, { ...form, expiryDate: "2026-11-23" }, context),
      name: lot.productRef,
      remaining: q(lot.remaining),
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.events.map((e) => e.type)).toEqual(["updateLot"]);
    expect(result.events[0]).toMatchObject({ patch: { expiry: { date: "2026-11-23", kind: "use_by" } } });
    expect(result.message).toBe("Corretto: Petto di pollo.");
  });

  it("solo la quantità cambiata: vale la quantità, anche se gli altri campi dicono «Non hai cambiato niente.»", () => {
    const edit = buildEdit(creation, lot, form, ctx());
    expect(edit).toMatchObject({ ok: false, error: "Non hai cambiato niente." });
    const result = mergeCorrection({ quantity: quantityOf(250), edit, name: lot.productRef, remaining: q(250) });
    if (!result.ok) throw new Error(result.error);
    expect(result.events.map((e) => e.type)).toEqual(["adjust"]);
    expect(result.message).toBe("Corretto: Petto di pollo, ne restano 250 g.");
  });

  it("quantità e nome insieme: un solo insieme di eventi, un solo avviso con il nome nuovo", () => {
    const context = ctx();
    const result = mergeCorrection({
      quantity: buildQuantityCorrection({ lot, creation, remaining: 500, log, ctx: context }),
      edit: buildEdit(creation, lot, { ...form, name: "petto di tacchino" }, context),
      name: "Petto di tacchino",
      remaining: q(500),
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.events.map((e) => e.type)).toEqual(["void", "purchase", "adjust", "updateLot"]);
    expect(new Set(result.events.map((e) => e.id)).size).toBe(4);
    expect(result.message).toBe("Corretto: Petto di tacchino, ne restano 500 g.");
    const after = derivePantry([...log, ...result.events]);
    expect(after.anomalies).toEqual([]);
    expect(after.lots).toHaveLength(1);
    expect(after.lots[0]).toMatchObject({ productRef: "Petto di tacchino", initial: 500, remaining: 500, priceCents: 599 });
    // «Annulla» sull'avviso li toglie tutti insieme
    const undo = buildUndo(result.events, { now: D(16, 13), deviceId: "dev-a", idGenerator: (() => { let n = 0; return () => `u${++n}`; })() });
    expect(derivePantry([...log, ...result.events, ...undo]).lots).toEqual(derivePantry(log).lots);
  });

  it("niente cambiato in nessuno dei due: lo dice", () => {
    expect(mergeCorrection({ quantity: quantityOf(400), edit: buildEdit(creation, lot, form, ctx()), name: lot.productRef, remaining: q(400) })).toEqual({
      ok: false,
      error: "Non hai cambiato niente.",
    });
  });

  it("errori: quello della quantità sta sul suo campo, insieme a quelli degli altri campi", () => {
    const bad = mergeCorrection({ quantity: quantityOf(0), edit: buildEdit(creation, lot, form, ctx()), name: lot.productRef });
    expect(bad).toEqual({ ok: false, error: "Controlla i campi indicati.", remaining: "Scrivi quanto ne resta, per esempio 250." });

    const both = mergeCorrection({ quantity: quantityOf(Number.NaN), edit: buildEdit(creation, lot, { ...form, name: " " }, ctx()), name: lot.productRef });
    expect(both).toMatchObject({ ok: false, remaining: "Scrivi quanto ne resta, per esempio 250.", fields: { name: "Scrivi come si chiama l'alimento." } });

    // un campo sbagliato ferma tutto, anche se la quantità era giusta
    const field = mergeCorrection({ quantity: quantityOf(250), edit: buildEdit(creation, lot, { ...form, expiryDate: "" }, ctx()), name: lot.productRef });
    expect(field).toMatchObject({ ok: false, fields: { expiryDate: expect.any(String) } });
    expect("remaining" in field).toBe(false);
  });

  it("più confezioni: la quantità non si tocca e l'avviso le conta", () => {
    const edit = buildEdit(creation, lot, { ...form, expiryDate: "2026-11-23" }, ctx());
    const result = mergeCorrection({ edit, name: lot.productRef, packs: 3 });
    expect(result).toMatchObject({ ok: true, message: "Corrette: 3 confezioni di Petto di pollo." });
    expect(mergeCorrection({ edit: buildEdit(creation, lot, form, ctx()), name: lot.productRef, packs: 3 })).toEqual({ ok: false, error: "Non hai cambiato niente." });
  });

  it("un pezzo solo si dice al singolare", () => {
    const uova = stateOf([UOVA], "U1");
    const result = mergeCorrection({
      quantity: buildQuantityCorrection({ ...uova, remaining: 1, log: [UOVA], ctx: ctx() }),
      edit: buildEdit(uova.creation, uova.lot, formFromLot(uova.lot), ctx()),
      name: "Uova",
      remaining: q(1, "pz"),
    });
    expect(result).toMatchObject({ ok: true, message: "Corretto: Uova, ne resta 1 pz." });
  });
});

describe("overInitialQuestion: oltre la quantità di partenza si chiede conferma", () => {
  const { lot } = stateOf([POLLO], "L1");

  it("fino alla quantità di partenza non chiede niente", () => {
    for (const value of [1, 250, 400, 400.0005, Number.NaN]) expect(overInitialQuestion(lot, value)).toBeNull();
  });

  it("un errore di battitura (2500 per 250) non passa in silenzio", () => {
    expect(overInitialQuestion(lot, 2500)).toBe("È più di quanto era entrato (400 g). Confermi 2,5 kg?");
    expect(overInitialQuestion(lot, 401)).toBe("È più di quanto era entrato (400 g). Confermi 401 g?");
    expect(overInitialQuestion(stateOf([UOVA, ...DUE_UOVA], "U1").lot, 10)).toBe("È più di quanto era entrato (6 pz). Confermi 10 pz?");
  });

  it("alimento a pezzi: dice come verranno ricalcolati, ed è ciò che poi risulta", () => {
    const piadine = purchase("pp", D(10), { lotId: "P1", productRef: "Piadine", quantity: q(200), location: "dispensa", pieces: { count: 2, each: 100, name: "piadina" } });
    const before = stateOf([piadine], "P1").lot;
    expect(overInitialQuestion(before, 300)).toBe("È più di quanto era entrato (200 g). Confermi 300 g? I pezzi verranno ricalcolati: 2 da circa 150 g.");
    expect(overInitialQuestion(before, 150)).toBeNull();
    const after = corrected([piadine], "P1", 300).lot;
    expect(piecesOf(after)).toMatchObject({ count: 2, each: 150, agrees: false });

    // con una piadina già mangiata la quantità di partenza diventa 400: i pezzi sono 2 da 200
    const eaten = [piadine, consume("c1", D(11), { lotId: "P1", quantity: q(100) })];
    expect(overInitialQuestion(stateOf(eaten, "P1").lot, 300)).toBe("È più di quanto era entrato (200 g). Confermi 300 g? I pezzi verranno ricalcolati: 2 da circa 200 g.");
    expect(piecesOf(corrected(eaten, "P1", 300).lot)).toMatchObject({ count: 2, each: 200 });
  });
});
