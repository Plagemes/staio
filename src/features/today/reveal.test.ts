import { describe, expect, it } from "vitest";
import { changeConsumeQuantity, deriveDiary, familyConsumes } from "@/core/diary";
import { consume, declaration, drink, meal, purchase, voidOf, water } from "@/core/diary/test-helpers";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type LedgerEvent } from "@/core/ledger";
import { ENTRY_GONE_MS, ENTRY_WAIT_MS, daysBefore, entryVerdict, locateEntry } from "./reveal";

const TZ = "Europe/Rome";
const TODAY = "2026-11-16";

function locate(log: readonly AnyEvent[], id: string) {
  const voided = new Set([...deriveDiary(log, { timeZone: TZ }).voidedEventIds, ...derivePantry(log as LedgerEvent[]).voidedEventIds]);
  return locateEntry(log, id, { timeZone: TZ, today: TODAY, voided });
}

const lot = purchase("buy", "2026-11-10T09:00:00.000Z", { lotId: "lot-1", productRef: "Petto di pollo", quantity: { value: 400, unit: "g" }, location: "frigo" });
// la cena di ieri, alle 20 di Roma
const dinner = meal("m1", "2026-11-15T19:00:00.000Z", { mealId: "meal-1", kind: "dinner", certainty: "estimated" });

describe("locateEntry: dove sta nel diario la voce di `?voce=`", () => {
  it("un pasto: il suo giorno e la sua riga", () => {
    expect(locate([lot, dinner], "m1")).toEqual({ found: true, date: "2026-11-15", elementId: "voce-m1" });
  });

  it("un consumo dentro un pasto si legge nel giorno del pasto, anche se è scritto dopo", () => {
    // scritto stamattina, ma fa parte della cena di ieri
    const late = consume("c1", "2026-11-16T07:00:00.000Z", { lotId: "lot-1", quantity: { value: 150, unit: "g" }, mealId: "meal-1" });
    expect(locate([lot, dinner, late], "c1")).toEqual({ found: true, date: "2026-11-15", elementId: "voce-c1" });
  });

  it("un consumo senza pasto sta nel giorno della sua ora", () => {
    const loose = consume("c2", "2026-11-16T10:00:00.000Z", { lotId: "lot-1", quantity: { value: 50, unit: "g" } });
    expect(locate([lot, loose], "c2")).toEqual({ found: true, date: TODAY, elementId: "voce-c2" });
  });

  it("una bevanda, l'acqua: il giorno nel fuso del diario", () => {
    // 00:20 del 16 a Roma
    const tea = drink("d1", "2026-11-15T23:20:00.000Z", { name: "Tè", ml: 200, caffeineMg: 40 });
    expect(locate([tea], "d1")).toEqual({ found: true, date: TODAY, elementId: "voce-d1" });
    expect(locate([water("w1", "2026-11-14T08:00:00.000Z", { ml: 200 })], "w1")).toEqual({ found: true, date: "2026-11-14", elementId: "voce-w1" });
  });

  it("una dichiarazione vale per il giorno che dichiara, non per quando è stata scritta", () => {
    const skipped = declaration("x1", "2026-11-16T08:00:00.000Z", { date: "2026-11-15", kind: "dinner", status: "skipped" });
    expect(locate([skipped], "x1")).toEqual({ found: true, date: "2026-11-15", elementId: "voce-x1" });
  });

  it("un evento annullato non c'è più; né c'è un annullamento", () => {
    const tea = drink("d1", "2026-11-16T09:00:00.000Z", { name: "Tè", ml: 200 });
    const undo = voidOf("v1", "2026-11-16T09:01:00.000Z", "d1");
    expect(locate([tea, undo], "d1")).toEqual({ found: false });
    expect(locate([tea, undo], "v1")).toEqual({ found: false });
  });

  describe("un consumo corretto porta alla voce viva della stessa famiglia", () => {
    const c1 = consume("c1", "2026-11-15T19:00:00.000Z", { lotId: "lot-1", quantity: { value: 150, unit: "g" }, mealId: "meal-1" });
    let n = 0;
    const fix = (value: number, now: string, deviceId: string) => {
      const r = changeConsumeQuantity(c1, { value, estimated: false }, 400, { deviceId, now, idGenerator: () => `${deviceId}-${++n}`, timeZone: TZ });
      if (!r.ok) throw new Error(r.error);
      return r.events;
    };
    const newConsume = (events: readonly AnyEvent[]) => events.find((e) => e.type === "consume")!.id;

    it("corretto una volta: la voce che lo sostituisce, nel giorno del pasto", () => {
      const fromA = fix(120, "2026-11-16T08:00:00.000Z", "dev-a");
      expect(locate([lot, dinner, c1, ...fromA], "c1")).toEqual({ found: true, date: "2026-11-15", elementId: `voce-${newConsume(fromA)}` });
    });

    it("corretto da due telefoni: la correzione che vale, da qualunque anello si parta", () => {
      const fromA = fix(120, "2026-11-16T08:00:00.000Z", "dev-a");
      const fromB = fix(100, "2026-11-16T08:05:00.000Z", "dev-b");
      const log = [lot, dinner, c1, ...fromA, ...fromB];
      const live = { found: true, date: "2026-11-15", elementId: `voce-${newConsume(fromB)}` };
      expect(locate(log, "c1")).toEqual(live);
      expect(locate(log, newConsume(fromA))).toEqual(live);
      expect(locate(log, newConsume(fromB))).toEqual(live);
    });

    it("tolta tutta la famiglia, la voce non c'è più", () => {
      const fromA = fix(120, "2026-11-16T08:00:00.000Z", "dev-a");
      const log = [lot, dinner, c1, ...fromA];
      const removed = familyConsumes(log, [c1]).map((c, i) => voidOf(`rm-${i}`, "2026-11-16T09:00:00.000Z", c.id));
      expect(locate([...log, ...removed], "c1")).toEqual({ found: false });
    });
  });

  it("un id sconosciuto o vuoto non c'è", () => {
    expect(locate([lot, dinner], "xxx")).toEqual({ found: false });
    expect(locate([lot, dinner], "  ")).toEqual({ found: false });
  });

  it("più vecchio di 60 giorni non c'è; 60 giorni fa sì; nel futuro no", () => {
    const old = water("w1", "2026-09-16T10:00:00.000Z", { ml: 200 });
    const edge = water("w2", "2026-09-17T10:00:00.000Z", { ml: 200 });
    const future = water("w3", "2026-11-18T10:00:00.000Z", { ml: 200 });
    const log = [old, edge, future];
    expect(locate(log, "w1")).toEqual({ found: false });
    expect(locate(log, "w2")).toEqual({ found: true, date: "2026-09-17", elementId: "voce-w2" });
    expect(locate(log, "w3")).toEqual({ found: false });
  });

  it("daysBefore: la distanza tra due giorni di calendario", () => {
    expect(daysBefore(TODAY, TODAY)).toBe(0);
    expect(daysBefore(TODAY, "2026-11-15")).toBe(1);
    expect(daysBefore(TODAY, "2026-09-17")).toBe(60);
  });
});

describe("entryVerdict: che cosa fare di `?voce=` quando la voce non c'è, o non c'è ancora", () => {
  /** Il verdetto per `id` con il registro che c'è, `waitedMs` dopo l'arrivo sulla pagina. */
  const verdict = (log: readonly AnyEvent[], id: string, waitedMs: number) => entryVerdict({ found: locate(log, id).found, waitedMs });

  it("9. una voce scritta un attimo prima: con il registro di prima si aspetta senza dire niente; appena arriva quello nuovo si mostra", () => {
    // «Aggiungi qui»: il pasto riscritto ha un id nuovo, e Oggi ha ancora in mano il registro di prima della scrittura
    const before = [lot, dinner];
    const rewritten = meal("m2", "2026-11-15T19:00:00.000Z", { mealId: "meal-1", kind: "dinner", certainty: "estimated", replaces: "m1", recordedAt: "2026-11-16T10:00:00.000Z" });
    const after = [...before, voidOf("v-m1", "2026-11-16T10:00:00.000Z", "m1"), rewritten];
    expect(verdict(before, "m2", 0)).toBe("wait");
    expect(verdict(before, "m2", 1200)).toBe("wait");
    expect(verdict(after, "m2", 1200)).toBe("show");
    expect(locate(after, "m2")).toEqual({ found: true, date: "2026-11-15", elementId: "voce-m2" });
    // trovata subito, o anche dopo l'attesa: si mostra comunque
    expect(verdict(after, "m2", 0)).toBe("show");
    expect(verdict(after, "m2", 5000)).toBe("show");
  });

  it("10. un id che non esiste: dopo 2 secondi lo dice; dopo altri 8 il messaggio se ne va", () => {
    const log = [lot, dinner];
    expect(verdict(log, "xxx", 0)).toBe("wait");
    expect(verdict(log, "xxx", ENTRY_WAIT_MS - 1)).toBe("wait");
    expect(verdict(log, "xxx", ENTRY_WAIT_MS)).toBe("gone");
    const said = (forMs: number, logChanged = false, dayChanged = false) => entryVerdict({ found: false, waitedMs: ENTRY_WAIT_MS, said: { forMs, logChanged, dayChanged } });
    expect(said(0)).toBe("gone");
    expect(said(ENTRY_GONE_MS - 1)).toBe("gone");
    expect(said(ENTRY_GONE_MS)).toBe("over");
    // e se ne va prima alla prima scrittura o al primo cambio di giorno
    expect(said(100, true)).toBe("over");
    expect(said(100, false, true)).toBe("over");
    expect([ENTRY_WAIT_MS, ENTRY_GONE_MS]).toEqual([2000, 8000]);
  });

  it("11. una voce annullata: come un id che non esiste", () => {
    const tea = drink("d1", "2026-11-16T09:00:00.000Z", { name: "Tè", ml: 200 });
    const log = [tea, voidOf("v1", "2026-11-16T09:01:00.000Z", "d1")];
    expect(verdict(log, "d1", 0)).toBe("wait");
    expect(verdict(log, "d1", ENTRY_WAIT_MS)).toBe("gone");
    expect(entryVerdict({ found: false, waitedMs: 4000, said: { forMs: ENTRY_GONE_MS, logChanged: false, dayChanged: false } })).toBe("over");
  });

  it("una volta detto, il messaggio non torna «mostra» da solo: lo chiude il registro che cambia", () => {
    expect(entryVerdict({ found: true, waitedMs: 3000, said: { forMs: 500, logChanged: true, dayChanged: false } })).toBe("over");
    expect(entryVerdict({ found: true, waitedMs: 3000, said: { forMs: 500, logChanged: false, dayChanged: false } })).toBe("gone");
  });
});
