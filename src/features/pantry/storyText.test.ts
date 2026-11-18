import { describe, expect, it } from "vitest";
import { deriveDiary, type DiaryState } from "@/core/diary";
import { meal } from "@/core/diary/test-helpers";
import { buildLotStory, derivePantry, type LotStoryRow } from "@/core/ledger";
import { consume, declare, discard, move, open, purchase, q, updateLot } from "@/core/ledger/test-helpers";
import { formatPrice } from "../format";
import { storyLines, storySummary, type StoryContext } from "./storyText";

const TZ = "Europe/Rome";
// 20:10 a Roma, il 14 novembre
const DINNER = "2026-11-14T19:10:00.000Z";
const NOW = "2026-11-17T10:00:00.000Z";

const ctx = (diary: DiaryState | undefined = undefined, unit: "g" | "ml" | "pz" = "g"): StoryContext => ({ unit, diary, timeZone: TZ, now: NOW });
const row = (kind: LotStoryRow["kind"], over: Partial<LotStoryRow> = {}): LotStoryRow => ({
  eventId: `e-${kind}`,
  kind,
  at: "2026-11-12T08:00:00.000Z",
  certainty: "measured",
  ...over,
});
const one = (r: LotStoryRow, c = ctx()) => storyLines([r], c)[0];

describe("le righe della storia", () => {
  it("comprato: la quantità, il prezzo e il negozio se ci sono", () => {
    expect(one(row("bought", { quantityDelta: 400 }))).toMatchObject({ when: "12 nov", text: "Comprato: 400 g", estimated: false });
    expect(one(row("bought", { quantityDelta: 400, priceCents: 350 })).text).toBe(`Comprato: 400 g · ${formatPrice(350)}`);
  });

  it("alimento entrato da scontrino con prezzo e negozio", () => {
    const r = row("bought", { quantityDelta: 1000, priceCents: 189, store: "Conad", source: "receipt" });
    expect(one(r, ctx(undefined, "ml")).text).toBe(`Comprato: 1 l · ${formatPrice(189)} · Conad`);
  });

  it("dichiarato «già in casa»", () => {
    expect(one(row("declared", { quantityDelta: 6 }), ctx(undefined, "pz"))).toMatchObject({ when: "12 nov", text: "Già in casa: 6 pz" });
  });

  const dinner = deriveDiary([meal("m1", DINNER, { mealId: "meal-1", kind: "dinner" })], { timeZone: TZ });

  it("mangiato in un pasto: il momento viene dal pasto, e la riga porta alla voce di Oggi", () => {
    const r = row("eaten", { eventId: "c1", at: "2026-11-14T19:11:00.000Z", quantityDelta: -150, mealId: "meal-1" });
    expect(one(r, ctx(dinner))).toEqual({
      key: "c1",
      when: "14 nov, 20:10",
      text: "Mangiato a cena: 150 g",
      href: "/app?voce=c1",
      estimated: false,
    });
  });

  it("mangiato in un pasto con un titolo", () => {
    const titled = deriveDiary([meal("m1", DINNER, { mealId: "meal-1", kind: "dinner", title: "pasta al forno" })], { timeZone: TZ });
    const r = row("eaten", { at: DINNER, quantityDelta: -150, mealId: "meal-1" });
    expect(one(r, ctx(titled)).text).toBe("Mangiato a cena (pasta al forno): 150 g");
  });

  it("uno spuntino e una colazione hanno la loro frase", () => {
    const moments = deriveDiary(
      [
        meal("m1", "2026-11-14T15:00:00.000Z", { mealId: "s", kind: "snack" }),
        meal("m2", "2026-11-14T07:00:00.000Z", { mealId: "b", kind: "breakfast" }),
      ],
      { timeZone: TZ },
    );
    expect(one(row("eaten", { quantityDelta: -30, mealId: "s" }), ctx(moments)).text).toBe("Mangiato come spuntino: 30 g");
    expect(one(row("eaten", { quantityDelta: -30, mealId: "b" }), ctx(moments)).text).toBe("Mangiato a colazione: 30 g");
  });

  it("mangiato senza pasto: l'ora è quella del consumo", () => {
    const r = row("eaten", { eventId: "c2", at: DINNER, quantityDelta: -150 });
    expect(one(r)).toMatchObject({ when: "14 nov, 20:10", text: "Mangiato: 150 g", href: "/app?voce=c2" });
  });

  it("mangiato in un pasto spostato: vale il momento di adesso del pasto", () => {
    // il pasto è stato portato a ieri; il consumo, sostituito, porta lo stesso momento: qui conta quello del pasto
    const yesterday = deriveDiary([meal("m1", "2026-11-13T19:10:00.000Z", { mealId: "meal-1", kind: "dinner" })], { timeZone: TZ });
    const r = row("eaten", { at: DINNER, quantityDelta: -150, mealId: "meal-1" });
    expect(one(r, ctx(yesterday))).toMatchObject({ when: "13 nov, 20:10", text: "Mangiato a cena: 150 g" });
  });

  it("mangiato in un pasto che non c'è più nel diario: senza momento", () => {
    const empty = deriveDiary([], { timeZone: TZ });
    const r = row("eaten", { at: DINNER, quantityDelta: -150, mealId: "meal-gone" });
    expect(one(r, ctx(empty))).toMatchObject({ when: "14 nov, 20:10", text: "Mangiato: 150 g" });
    expect(one(r, ctx(undefined)).text).toBe("Mangiato: 150 g");
  });

  it("buttato, con il motivo; regalato; aperto", () => {
    expect(one(row("discarded", { quantityDelta: -100, reason: "expired", at: "2026-11-15T09:00:00.000Z" }))).toMatchObject({
      when: "15 nov",
      text: "Buttato: 100 g (scaduto)",
    });
    expect(one(row("discarded", { quantityDelta: -100, reason: "disliked" })).text).toBe("Buttato: 100 g (non mi è piaciuto)");
    expect(one(row("discarded", { quantityDelta: -100 })).text).toBe("Buttato: 100 g");
    expect(one(row("gifted", { quantityDelta: -100 })).text).toBe("Regalato: 100 g");
    expect(one(row("opened", { at: "2026-11-14T09:00:00.000Z" }))).toMatchObject({ when: "14 nov", text: "Aperto" });
  });

  it("spostato: dove", () => {
    expect(one(row("moved", { to: "freezer", at: "2026-11-13T09:00:00.000Z" }))).toMatchObject({ when: "13 nov", text: "Spostato in freezer" });
    expect(one(row("moved", { to: "dispensa" })).text).toBe("Spostato in credenza");
    expect(one(row("moved")).text).toBe("Spostato");
  });

  it("quantità corretta: ne restano", () => {
    const r = row("adjusted", { quantityDelta: -50, remainingAfter: 250, at: "2026-11-16T09:00:00.000Z" });
    expect(one(r)).toMatchObject({ when: "16 nov", text: "Corretto: ne restano 250 g" });
    expect(one(row("adjusted", { quantityDelta: -250, remainingAfter: 0 })).text).toBe("Corretto: non ne resta niente");
  });

  it("dati corretti: i nomi dei campi in italiano", () => {
    expect(one(row("corrected", { fields: ["productRef", "expiry"] })).text).toBe("Corretto: nome, scadenza");
    expect(one(row("corrected", { fields: ["category", "barcode", "priceCents", "store"] })).text).toBe(
      "Corretto: categoria, codice a barre, prezzo, negozio",
    );
    expect(one(row("corrected")).text).toBe("Corretto");
  });

  it("una quantità stimata porta la tilde", () => {
    const r = row("eaten", { at: DINNER, quantityDelta: -150, certainty: "estimated" });
    expect(one(r)).toMatchObject({ text: "Mangiato: ~150 g", estimated: true });
    expect(one(row("adjusted", { remainingAfter: 250, certainty: "estimated" })).text).toBe("Corretto: ne restano ~250 g");
  });

  it("l'anno si scrive solo se non è quello in corso", () => {
    expect(one(row("bought", { quantityDelta: 400, at: "2025-12-30T08:00:00.000Z" })).when).toBe("30 dic 2025");
    expect(one(row("bought", { quantityDelta: 400 }), { unit: "g", diary: undefined, timeZone: TZ }).when).toBe("12 nov");
  });

  it("un'etichetta di una riga per voce, nell'ordine ricevuto", () => {
    const lines = storyLines([row("opened", { eventId: "b" }), row("bought", { eventId: "a", quantityDelta: 400 })], ctx());
    expect(lines.map((l) => l.key)).toEqual(["b", "a"]);
  });
});

describe("il riepilogo della riga richiusa", () => {
  const bought = row("bought", { quantityDelta: 400, at: "2026-11-12T08:00:00.000Z" });
  const opened = row("opened", { at: "2026-11-14T08:00:00.000Z" });
  const eaten = (id: string) => row("eaten", { eventId: id, at: "2026-11-15T12:00:00.000Z", quantityDelta: -100 });
  const summary = (rows: LotStoryRow[]) => storySummary(rows, { timeZone: TZ, now: NOW });

  it("una parte: appena comprato", () => {
    expect(summary([row("bought", { quantityDelta: 400, at: "2026-11-17T08:00:00.000Z" })])).toBe("Comprato il 17 nov");
  });

  it("alimento dichiarato: «in casa dal»", () => {
    expect(summary([row("declared", { quantityDelta: 6 })])).toBe("In casa dal 12 nov");
  });

  it("due parti", () => {
    expect(summary([opened, bought])).toBe("Comprato il 12 nov · aperto il 14");
  });

  it("mangiato una volta e più volte", () => {
    expect(summary([eaten("c1"), bought])).toBe("Comprato il 12 nov · mangiato una volta");
    expect(summary([eaten("c2"), eaten("c1"), opened, bought])).toBe("Comprato il 12 nov · aperto il 14 · mangiato 2 volte");
  });

  it("aperto in un altro mese: la data intera", () => {
    expect(summary([row("opened", { at: "2026-12-02T08:00:00.000Z" }), bought])).toBe("Comprato il 12 nov · aperto il 2 dic");
  });

  it("tutte le parti, nell'ordine", () => {
    const rows = [
      row("adjusted", { remainingAfter: 100, at: "2026-11-16T08:00:00.000Z" }),
      row("moved", { to: "freezer", at: "2026-11-15T20:00:00.000Z" }),
      row("discarded", { eventId: "d", quantityDelta: -100, reason: "expired" }),
      eaten("c2"),
      eaten("c1"),
      opened,
      bought,
    ];
    expect(summary(rows)).toBe("Comprato il 12 nov · aperto il 14 · mangiato 2 volte · buttato in parte · spostato in freezer · corretto");
  });

  it("buttato tutto: «buttato»", () => {
    expect(summary([row("discarded", { quantityDelta: -400 }), bought])).toBe("Comprato il 12 nov · buttato");
  });

  it("una correzione dei dati conta come «corretto»; regalato e annullati non si contano", () => {
    expect(summary([row("corrected", { fields: ["expiry"] }), bought])).toBe("Comprato il 12 nov · corretto");
    expect(summary([row("gifted", { quantityDelta: -50 }), bought])).toBe("Comprato il 12 nov");
  });

  it("senza righe, niente", () => {
    expect(summary([])).toBe("");
  });
});

describe("dal registro alla riga, di punta in bianco", () => {
  it("comprato, aperto, mangiato in un pasto e al volo, spostato, corretto", () => {
    const events = [
      purchase("p1", "2026-11-12T08:00:00.000Z", { lotId: "lot-1", productRef: "Petto di pollo", quantity: q(400), location: "frigo", priceCents: 350, store: "Conad" }),
      open("o1", "2026-11-14T08:00:00.000Z", { lotId: "lot-1" }),
      consume("c1", DINNER, { lotId: "lot-1", quantity: q(150), mealId: "meal-1" }),
      consume("c2", "2026-11-15T11:00:00.000Z", { lotId: "lot-1", quantity: q(100) }),
      move("m1", "2026-11-15T12:00:00.000Z", { lotId: "lot-1", to: "freezer" }),
      updateLot("u1", "2026-11-16T09:00:00.000Z", { lotId: "lot-1", patch: { expiry: { date: "2027-02-01", kind: "best_before" } } }),
    ];
    const diary = deriveDiary([...events, meal("md", DINNER, { mealId: "meal-1", kind: "dinner", title: "petto alla piastra" })], { timeZone: TZ });
    const rows = buildLotStory(derivePantry(events).lots[0], events);
    expect(storyLines(rows, { unit: "g", diary, timeZone: TZ, now: NOW }).map((l) => `${l.when} | ${l.text}`)).toEqual([
      "16 nov | Corretto: scadenza",
      "15 nov | Spostato in freezer",
      "15 nov, 12:00 | Mangiato: 100 g",
      "14 nov, 20:10 | Mangiato a cena (petto alla piastra): 150 g",
      "14 nov | Aperto",
      `12 nov | Comprato: 400 g · ${formatPrice(350)} · Conad`,
    ]);
    expect(storySummary(rows, { timeZone: TZ, now: NOW })).toBe("Comprato il 12 nov · aperto il 14 · mangiato 2 volte · spostato in freezer · corretto");
  });

  it("dichiarato, con una parte buttata", () => {
    const events = [
      declare("d1", "2026-11-12T08:00:00.000Z", { lotId: "lot-1", productRef: "Uova", quantity: q(6, "pz"), location: "frigo" }),
      discard("x1", "2026-11-15T09:00:00.000Z", { lotId: "lot-1", quantity: q(2, "pz"), reason: "expired" }),
    ];
    const rows = buildLotStory(derivePantry(events).lots[0], events);
    expect(storyLines(rows, ctx(undefined, "pz")).map((l) => l.text)).toEqual(["Buttato: 2 pz (scaduto)", "Già in casa: 6 pz"]);
    expect(storySummary(rows, { timeZone: TZ, now: NOW })).toBe("In casa dal 12 nov · buttato in parte");
  });
});
