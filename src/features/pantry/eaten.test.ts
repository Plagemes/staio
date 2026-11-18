import { describe, expect, it } from "vitest";
import { deriveDiary, getDay, mealMoments, mealsWithPantry } from "@/core/diary";
import { consume, purchase, voidOf } from "@/core/diary/test-helpers";
import type { AnyEvent } from "@/core/events";
import { derivePantry, type ConsumeEvent } from "@/core/ledger";
import { buildUndo, type ActionContext } from "../actions";
import { seededRandom } from "@/core/diary/test-helpers";
import { MOMENT_CHOICES, buildChangeMoment, buildEaten, eatenDayOf, inSentence, looseConsumesOf, undoPlacement, whenText, whereText, type Marked } from "./eaten";

const D = "2026-11-16";
const TZ = "Europe/Rome";
// 13:11 a Roma
const LUNCH = "2026-11-16T12:11:00.000Z";
const ctx = (now: string): ActionContext => ({ now, deviceId: "dev-a" });

const log0: AnyEvent[] = [
  purchase("p1", "2026-11-10T08:00:00.000Z", { lotId: "lot-1", productRef: "Petto di pollo", quantity: { value: 1110, unit: "g" }, location: "freezer" }) as AnyEvent,
];
const lotOf = (log: AnyEvent[]) => derivePantry(log).lots.find((l) => l.lotId === "lot-1")!;
const diaryOf = (log: AnyEvent[]) => deriveDiary(log, { timeZone: TZ });

describe("«Mangiato» dalla scheda di un alimento (anche in freezer)", () => {
  it("dice che cosa è stato segnato e dove: «Segnato a pranzo: 275 g di petto di pollo»", () => {
    const r = buildEaten([lotOf(log0)], { kind: "value", value: 275 }, ctx(LUNCH), diaryOf(log0));
    expect(r.ok && r.message).toBe("Segnato a pranzo: 275 g di petto di pollo");
  });

  it("il consumo finisce nel pranzo di Oggi, con il pasto, e il lotto cala", () => {
    const r = buildEaten([lotOf(log0)], { kind: "value", value: 275 }, ctx(LUNCH), diaryOf(log0));
    if (!r.ok) throw new Error("atteso ok");
    const log = [...log0, ...r.events];
    expect(r.events.map((e) => e.type)).toEqual(["meal", "consume"]);
    const [m] = mealsWithPantry(diaryOf(log), log);
    expect(m.kind).toBe("lunch");
    expect(m.pantryConsumes.map((c) => c.quantity.value)).toEqual([275]);
    expect(lotOf(log).remaining).toBe(1110 - 275);
    expect(mealMoments(getDay(diaryOf(log), D)).find((x) => x.kind === "lunch")?.status).toBe("recorded");
  });

  it("un pezzo e mezzo pezzo di fila: un solo pasto, e il secondo avviso dice lo stesso momento", () => {
    const one = buildEaten([lotOf(log0)], { kind: "value", value: 275 }, ctx(LUNCH), diaryOf(log0));
    if (!one.ok) throw new Error("atteso ok");
    const log1 = [...log0, ...one.events];
    const half = buildEaten([lotOf(log1)], { kind: "value", value: 138, estimated: true }, ctx("2026-11-16T12:12:00.000Z"), diaryOf(log1));
    expect(half.ok && half.events.map((e) => e.type)).toEqual(["consume"]);
    if (!half.ok) return;
    expect(half.marked.joined).toBe(true);
    const all = [...log1, ...half.events];
    expect(getDay(diaryOf(all), D)?.meals).toHaveLength(1);
    expect(lotOf(all).remaining).toBe(1110 - 275 - 138);
  });

  it("tutto il rimasto: quantità esatta, momento dell'ora", () => {
    const r = buildEaten([lotOf(log0)], { kind: "all" }, ctx("2026-11-16T18:30:00.000Z"), diaryOf(log0));
    expect(r.ok && r.message).toBe("Segnato a cena: 1,11 kg di petto di pollo");
  });

  it("più confezioni insieme (Tutte mangiate): un pasto solo", () => {
    const two = [
      ...log0,
      purchase("p2", "2026-11-10T08:00:00.000Z", { lotId: "lot-2", productRef: "Petto di pollo", quantity: { value: 500, unit: "g" }, location: "freezer" }) as AnyEvent,
    ];
    const lots = derivePantry(two).lots;
    const r = buildEaten(lots, { kind: "all" }, ctx(LUNCH), diaryOf(two));
    if (!r.ok) throw new Error("atteso ok");
    expect(r.events.filter((e) => e.type === "meal")).toHaveLength(1);
    expect(r.events.filter((e) => e.type === "consume")).toHaveLength(2);
    expect(r.message).toBe("Segnato a pranzo: 2 confezioni di petto di pollo");
  });

  it("più dell'avanzo, o niente rimasto: errore, nessun pasto", () => {
    expect(buildEaten([lotOf(log0)], { kind: "value", value: 5000 }, ctx(LUNCH), diaryOf(log0)).ok).toBe(false);
    expect(buildEaten([], { kind: "all" }, ctx(LUNCH), diaryOf(log0)).ok).toBe(false);
  });
});

describe("cambiare momento dall'avviso", () => {
  const first = buildEaten([lotOf(log0)], { kind: "value", value: 275 }, ctx(LUNCH), diaryOf(log0));
  if (!first.ok) throw new Error("atteso ok");
  const log1 = [...log0, ...first.events];

  it("passa alla cena senza contare due volte: il lotto cala di 275 g una volta sola", () => {
    const r = buildChangeMoment(first.marked, { kind: "dinner", date: D }, ctx("2026-11-16T12:13:00.000Z"), diaryOf(log1));
    expect(r.ok && r.message).toBe("Ora a cena: 275 g di petto di pollo");
    if (!r.ok) return;
    const all = [...log1, ...r.events];
    expect(getDay(diaryOf(all), D)?.meals.map((m) => m.kind)).toEqual(["dinner"]);
    expect(lotOf(all).remaining).toBe(1110 - 275);
    expect(mealsWithPantry(diaryOf(all), all)[0].pantryConsumes).toHaveLength(1);
  });

  it("«Annulla» sull'avviso del cambio riporta il pranzo; l'annulla del consumo toglie tutto senza pasto fantasma", () => {
    const moved = buildChangeMoment(first.marked, { kind: "dinner", date: D }, ctx("2026-11-16T12:13:00.000Z"), diaryOf(log1));
    if (!moved.ok) throw new Error("atteso ok");
    const afterMove = [...log1, ...moved.events];
    const undoneMove = [...afterMove, ...buildUndo(moved.events, ctx("2026-11-16T12:14:00.000Z"))];
    expect(getDay(diaryOf(undoneMove), D)?.meals.map((m) => m.kind)).toEqual(["lunch"]);
    // «Annulla» della scheda: il consumo (quello nuovo) torna in dispensa
    const undoneEat = [...afterMove, ...buildUndo(moved.marked.consumes, ctx("2026-11-16T12:14:00.000Z"))];
    expect(getDay(diaryOf(undoneEat), D)?.meals ?? []).toEqual([]);
    expect(lotOf(undoneEat).remaining).toBe(1110);
  });
});

describe("a cavallo della mezzanotte (ora di Roma)", () => {
  // 00:20 del 17 a Roma: il giorno dopo, fuori pasto
  const NIGHT = "2026-11-16T23:20:00.000Z";

  it("dopo la mezzanotte è spuntino del giorno nuovo, e si può dire «ieri, a cena»", () => {
    const r = buildEaten([lotOf(log0)], { kind: "value", value: 100 }, ctx(NIGHT), diaryOf(log0));
    if (!r.ok) throw new Error("atteso ok");
    expect(r.marked.date).toBe("2026-11-17");
    expect(r.message).toBe("Segnato come spuntino: 100 g di petto di pollo");
    const log1 = [...log0, ...r.events];
    const moved = buildChangeMoment(r.marked, { kind: "dinner", date: "2026-11-16" }, ctx(NIGHT), diaryOf(log1));
    expect(moved.ok && moved.message).toBe("Ora a cena di ieri: 100 g di petto di pollo");
    if (!moved.ok) return;
    const all = [...log1, ...moved.events];
    expect(getDay(diaryOf(all), "2026-11-16")?.meals.map((m) => m.kind)).toEqual(["dinner"]);
    expect(getDay(diaryOf(all), "2026-11-17")?.meals ?? []).toEqual([]);
  });

  it("whereText dice «di ieri» e, per giorni più lontani, quanti giorni fa", () => {
    expect(whereText("dinner", "2026-11-16", "2026-11-17")).toBe("a cena di ieri");
    expect(whereText("lunch", "2026-11-14", "2026-11-17")).toBe("a pranzo · 3 giorni fa");
    expect(whereText("snack", "2026-11-17", "2026-11-17")).toBe("come spuntino");
    expect(whereText("snack", "2026-11-16", "2026-11-17")).toBe("come spuntino di ieri");
  });
});

describe("i consumi senza pasto del giorno", () => {
  const old = (id: string, at: string, extra: Partial<ConsumeEvent> = {}) => consume(id, at, { lotId: "lot-1", quantity: { value: 138, unit: "g" }, ...extra }) as AnyEvent;
  const events = [
    ...log0,
    old("c1", LUNCH),
    old("c2", "2026-11-16T07:00:00.000Z", { mealId: "meal-x" }),
    old("c3", "2026-11-16T12:12:00.000Z", { note: "drink:abc" }),
    old("c4", "2026-11-16T12:13:00.000Z"),
    old("c5", "2026-11-15T12:13:00.000Z"),
    voidOf("v4", "2026-11-16T12:14:00.000Z", "c4") as AnyEvent,
  ];

  it("li trova nel momento della loro ora, senza quelli annullati, legati a una bevanda o di altri giorni; un consumo il cui pasto non c'è è senza pasto", () => {
    const loose = looseConsumesOf(events, diaryOf(events), D);
    expect(loose.lunch.map((c) => c.id)).toEqual(["c1"]);
    // c2 porta un pasto che non esiste: non resta invisibile
    expect(loose.breakfast.map((c) => c.id)).toEqual(["c2"]);
    expect(Object.values(loose).flat()).toHaveLength(2);
  });

  it("messo in un momento, il consumo vecchio esce dall'elenco e nasce il pasto", () => {
    const loose = looseConsumesOf(events, diaryOf(events), D);
    const c = loose.lunch[0];
    const marked = { consumes: [{ ...c, note: "quick" }], mealId: "", kind: "snack" as const, date: D, joined: false, name: "Petto di pollo", amount: "138 g" };
    const r = buildChangeMoment(marked, { kind: "lunch", date: D }, ctx("2026-11-16T12:20:00.000Z"), diaryOf(events));
    if (!r.ok) throw new Error("atteso ok");
    const all = [...events, ...r.events];
    expect(looseConsumesOf(all, diaryOf(all), D).lunch).toEqual([]);
    expect(getDay(diaryOf(all), D)?.meals.map((m) => m.kind)).toEqual(["lunch"]);
    expect(lotOf(all).remaining).toBe(lotOf(events).remaining);
  });
});

describe("annullare un tocco dopo che un altro si è aggiunto allo stesso pasto", () => {
  const first = buildEaten([lotOf(log0)], { kind: "value", value: 100 }, ctx(LUNCH), diaryOf(log0));
  if (!first.ok) throw new Error("atteso ok");
  const log1 = [...log0, ...first.events];
  const second = buildEaten([lotOf(log1)], { kind: "value", value: 100 }, ctx("2026-11-16T12:20:00.000Z"), diaryOf(log1));
  if (!second.ok) throw new Error("atteso ok");
  const log2 = [...log1, ...second.events];

  it("l'annulla del primo toglie il suo consumo ma lascia il pasto al secondo: nessun consumo orfano", () => {
    const voids = undoPlacement(first.events, log2, diaryOf(log2).voidedEventIds, ctx("2026-11-16T12:25:00.000Z"));
    expect(voids).toHaveLength(1);
    const log3 = [...log2, ...voids];
    const [m] = mealsWithPantry(diaryOf(log3), log3);
    expect(m.pantryConsumes.map((c) => c.id)).toEqual([second.marked.consumes[0].id]);
    expect(lotOf(log3).remaining).toBe(1110 - 100);
  });

  it("annullando poi anche il secondo, il pasto sparisce con lui", () => {
    const log3 = [...log2, ...undoPlacement(first.events, log2, diaryOf(log2).voidedEventIds, ctx("2026-11-16T12:25:00.000Z"))];
    const log4 = [...log3, ...undoPlacement(second.events, log3, diaryOf(log3).voidedEventIds, ctx("2026-11-16T12:26:00.000Z"))];
    expect(getDay(diaryOf(log4), D)?.meals ?? []).toEqual([]);
    expect(lotOf(log4).remaining).toBe(1110);
  });

  it("senza altri consumi l'annulla toglie anche il pasto", () => {
    const voids = undoPlacement(first.events, log1, diaryOf(log1).voidedEventIds, ctx("2026-11-16T12:25:00.000Z"));
    expect(voids).toHaveLength(2);
  });
});

describe("a pannello aperto oltre la mezzanotte il cambio di momento resta nel giorno in cui si è mangiato", () => {
  // 23:58 del 16 a Roma
  const LATE = "2026-11-16T22:58:00.000Z";
  // 00:05 del 17
  const AFTER = "2026-11-16T23:05:00.000Z";

  it("«Cena» dopo la mezzanotte è la cena del 16, non del 17", () => {
    const first = buildEaten([lotOf(log0)], { kind: "value", value: 100 }, ctx(LATE), diaryOf(log0));
    if (!first.ok) throw new Error("atteso ok");
    expect(first.marked.date).toBe("2026-11-16");
    const log1 = [...log0, ...first.events];
    const day = eatenDayOf(first.marked, TZ, "2026-11-17");
    expect(day).toBe("2026-11-16");
    const moved = buildChangeMoment(first.marked, { kind: "dinner", date: day }, ctx(AFTER), diaryOf(log1));
    if (!moved.ok) throw new Error("atteso ok");
    const all = [...log1, ...moved.events];
    expect(moved.marked.date).toBe("2026-11-16");
    expect(getDay(diaryOf(all), "2026-11-16")?.meals.map((m) => m.kind)).toEqual(["dinner"]);
    expect(getDay(diaryOf(all), "2026-11-17")?.meals ?? []).toEqual([]);
  });
});

describe("regola generale: nessun consumo valido resta invisibile in Oggi", () => {
  // sequenze casuali (con seme) di tocchi, cambi di momento, annullamenti del tocco e annullamenti di una riga
  it("dopo ogni passo ogni consumo ancora valido sta in un pasto o tra quelli senza pasto", () => {
    const random = seededRandom(2026);
    for (let run = 0; run < 25; run++) {
      let log: AnyEvent[] = [...log0];
      const placements: AnyEvent[][] = [];
      const markeds: Marked[] = [];
      let clock = Date.parse("2026-11-16T05:00:00.000Z");
      const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(random() * list.length)];
      for (let step = 0; step < 14; step++) {
        clock += Math.floor(random() * 5 * 3_600_000) + 60_000;
        const now = new Date(clock).toISOString();
        const diary = diaryOf(log);
        const active = new Set(diary.voidedEventIds);
        const op = Math.floor(random() * 4);
        if (op === 0 || markeds.length === 0) {
          const r = buildEaten([lotOf(log)], { kind: "value", value: 10 }, ctx(now), diary);
          if (r.ok) {
            log = [...log, ...r.events];
            placements.push(r.events);
            markeds.push(r.marked);
          }
        } else if (op === 1) {
          const m = pick(markeds)!;
          if (m.consumes.every((c) => !active.has(c.id))) {
            const to = pick(["breakfast", "lunch", "dinner", "snack"] as const)!;
            const r = buildChangeMoment(m, { kind: to, date: m.date }, ctx(now), diary);
            if (r.ok) {
              log = [...log, ...r.events];
              placements.push(r.events);
              markeds[markeds.indexOf(m)] = r.marked;
            }
          }
        } else if (op === 2) {
          const events = pick(placements)!;
          log = [...log, ...undoPlacement(events, log, diary.voidedEventIds, ctx(now))];
        } else {
          const c = pick(markeds.flatMap((m) => m.consumes))!;
          if (!active.has(c.id)) log = [...log, ...buildUndo([c], ctx(now))];
        }
        const state = diaryOf(log);
        const voided = new Set(state.voidedEventIds);
        const inMeals = new Set(mealsWithPantry(state, log).flatMap((m) => m.pantryConsumes.map((c) => c.id)));
        for (const e of log) {
          if (e.type !== "consume" || voided.has(e.id)) continue;
          const day = new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(new Date(e.at));
          const loose = Object.values(looseConsumesOf(log, state, day)).flat().map((c) => c.id);
          expect(inMeals.has(e.id) || loose.includes(e.id), `run ${run} step ${step}: ${e.id} invisibile`).toBe(true);
        }
      }
    }
  });
});

describe("due dispositivi spostano lo stesso consumo prima di sincronizzarsi", () => {
  it("conta una volta sola, in dispensa e nei nutrienti, qualunque sia l'ordine", () => {
    const first = buildEaten([lotOf(log0)], { kind: "value", value: 100 }, ctx(LUNCH), diaryOf(log0));
    if (!first.ok) throw new Error("atteso ok");
    const log1 = [...log0, ...first.events];
    const a = buildChangeMoment(first.marked, { kind: "dinner", date: D }, { now: "2026-11-16T12:30:00.000Z", deviceId: "dev-a" }, diaryOf(log1));
    const b = buildChangeMoment(first.marked, { kind: "snack", date: D }, { now: "2026-11-16T12:31:00.000Z", deviceId: "dev-b" }, diaryOf(log1));
    if (!a.ok || !b.ok) throw new Error("atteso ok");
    const forward = [...log1, ...a.events, ...b.events];
    const backward = [...log1, ...b.events, ...a.events];
    for (const log of [forward, backward]) {
      expect(lotOf(log).remaining).toBe(1110 - 100);
      expect(mealsWithPantry(diaryOf(log), log).flatMap((m) => m.pantryConsumes)).toHaveLength(1);
      expect(getDay(diaryOf(log), D)?.meals.map((m) => m.kind)).toEqual(["snack"]);
    }
  });
});

describe("un solo nome per il momento senza pasto", () => {
  it("si chiama «Spuntino» nella scelta e «come spuntino» nelle frasi", () => {
    expect(MOMENT_CHOICES.find((m) => m.kind === "snack")?.label).toBe("Spuntino");
    expect(whenText("snack", "2026-11-17", "2026-11-17")).toBe("Oggi come spuntino");
    expect(whenText("dinner", "2026-11-16", "2026-11-17")).toBe("Ieri a cena");
  });

  it("il nome in mezzo a una frase comincia con la minuscola, una sigla no", () => {
    expect(inSentence("Latte intero")).toBe("latte intero");
    expect(inSentence("IPA chiara")).toBe("IPA chiara");
  });
});
