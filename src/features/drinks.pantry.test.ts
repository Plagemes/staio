import { describe, expect, it } from "vitest";
import { deriveDiary, getDay } from "@/core/diary";
import { derivePantry, type Lot } from "@/core/ledger";
import { consume as consumeEv, purchase, q } from "@/core/ledger/test-helpers";
import { buildUndo } from "./actions";
import {
  buildDrink,
  buildDrinkConsume,
  drinkDose,
  drinkKindOf,
  inputOfPreset,
  linkedConsumes,
  lotDrinkKind,
  pantryOptionsForDrink,
  removeDrink,
  retimeDrink,
} from "./drinks";
import { DRINK_PRESETS } from "./health";

const NOW = "2026-11-16T07:12:00.000Z";
const ctx = (now = NOW) => ({ now, deviceId: "d", timeZone: "Europe/Rome" });
const tea = DRINK_PRESETS.find((p) => p.id === "tea")!;
const espresso = DRINK_PRESETS.find((p) => p.id === "espresso")!;

let n = 0;
function lot(name: string, quantity: ReturnType<typeof q>, extra: { expiry?: string; pieces?: { count: number; each: number } } = {}) {
  n += 1;
  return purchase(`p${n}`, "2026-11-01T10:00:00.000Z", {
    lotId: `lot-${n}`,
    productRef: name,
    quantity,
    location: "dispensa",
    ...(extra.expiry ? { expiry: { date: extra.expiry, kind: "best_before" as const } } : {}),
    ...(extra.pieces ? { pieces: extra.pieces } : {}),
  });
}
const lotsOf = (...events: ReturnType<typeof lot>[]): Lot[] => derivePantry(events).lots;
const names = (lots: Lot[], kind: "tea" | "coffee", extra = {}) =>
  pantryOptionsForDrink(kind, lots, NOW, { timeZone: "Europe/Rome", ...extra }).map((o) => o.lot.productRef);

describe("quale bevanda e quale lotto", () => {
  it("riconosce il tè e il caffè dal nome, e non il resto", () => {
    expect(drinkKindOf("Tè")).toBe("tea");
    expect(drinkKindOf("Caffè espresso")).toBe("coffee");
    expect(drinkKindOf("Birra")).toBeUndefined();
    expect(drinkKindOf("Cola")).toBeUndefined();
  });

  it("lotti adatti: tè, tisana, caffè in polvere, capsule, cialde; non biscotti al caffè", () => {
    for (const name of ["Tè verde", "Tisana alla camomilla", "Thé nero Earl Grey"]) expect(lotDrinkKind({ productRef: name })).toBe("tea");
    for (const name of ["Caffè macinato", "Capsule caffè", "Cialde caffè ESE", "Caffè decaffeinato"]) expect(lotDrinkKind({ productRef: name })).toBe("coffee");
    for (const name of ["Biscotti al caffè", "Gelato al tè verde", "Latte", "Pasta"]) expect(lotDrinkKind({ productRef: name })).toBeUndefined();
  });

  it("un tè non propone il caffè e viceversa; i lotti a litri non si propongono", () => {
    const lots = lotsOf(lot("Tè verde", q(40)), lot("Caffè macinato", q(250)), lot("Tè freddo", q(1000, "ml")));
    expect(names(lots, "tea")).toEqual(["Tè verde"]);
    expect(names(lots, "coffee")).toEqual(["Caffè macinato"]);
  });

  it("senza un lotto adatto non c'è niente da proporre", () => {
    expect(names(lotsOf(lot("Pasta", q(500))), "tea")).toEqual([]);
  });

  it("un lotto finito non si propone", () => {
    const purchased = lot("Tè verde", q(40));
    const done = derivePantry([purchased, consumeEv("c0", "2026-11-02T10:00:00.000Z", { lotId: `lot-${n}`, quantity: q(40) })]).lots;
    expect(names(done, "tea")).toEqual([]);
  });

  it("per prodotto propone il lotto che scade prima", () => {
    const lots = lotsOf(lot("Tè verde", q(40), { expiry: "2027-06-01" }), lot("Tè verde", q(20), { expiry: "2026-12-01" }));
    const options = pantryOptionsForDrink("tea", lots, NOW, { timeZone: "Europe/Rome" });
    expect(options).toHaveLength(1);
    expect(options[0].lot.initial).toBe(20);
  });

  it("con più prodotti, quello scelto l'ultima volta viene per primo", () => {
    const lots = lotsOf(lot("Tè verde", q(40), { expiry: "2026-12-01" }), lot("Tè nero", q(40), { expiry: "2027-05-01" }));
    expect(names(lots, "tea")).toEqual(["Tè verde", "Tè nero"]);
    expect(names(lots, "tea", { preferredProduct: "tè nero" })).toEqual(["Tè nero", "Tè verde"]);
    expect(names(lots, "tea", { preferredProduct: "Tè bianco" })).toEqual(["Tè verde", "Tè nero"]);
  });
});

describe("dose prudente, sempre una stima", () => {
  it("lotto a pezzi: una sola bustina, capsula o cialda", () => {
    const [bags, caps, pods] = lotsOf(lot("Tè verde bustine", q(25, "pz")), lot("Capsule caffè", q(10, "pz")), lot("Cialde caffè", q(18, "pz")));
    expect(drinkDose(bags, "tea")).toMatchObject({ quantity: { value: 1, unit: "pz" }, certainty: "estimated", text: "una bustina" });
    expect(drinkDose(caps, "coffee")?.text).toBe("una capsula");
    expect(drinkDose(pods, "coffee")?.text).toBe("una cialda");
  });

  it("un solo «pezzo» senza dire che è monodose potrebbe essere un pacco: niente proposta", () => {
    const [pack] = lotsOf(lot("Caffè macinato", q(1, "pz")));
    expect(drinkDose(pack, "coffee")).toBeUndefined();
  });

  it("lotto a grammi con pezzi dichiarati: un pezzo", () => {
    const [box] = lotsOf(lot("Tè verde", q(40), { pieces: { count: 20, each: 2 } }));
    expect(drinkDose(box, "tea")).toMatchObject({ quantity: { value: 2, unit: "g" }, certainty: "estimated", text: "una bustina" });
  });

  it("lotto a grammi senza pezzi: grammi tipici, 2 di tè e 7 di caffè", () => {
    const [t, c] = lotsOf(lot("Tè nero", q(100)), lot("Caffè macinato", q(250)));
    expect(drinkDose(t, "tea")).toMatchObject({ quantity: { value: 2, unit: "g" }, text: "circa 2 g" });
    expect(drinkDose(c, "coffee")).toMatchObject({ quantity: { value: 7, unit: "g" }, text: "circa 7 g" });
  });

  it("mai più di quanto resta", () => {
    const purchased = lot("Caffè macinato", q(10));
    const [rest] = derivePantry([purchased, consumeEv("c1", "2026-11-02T10:00:00.000Z", { lotId: `lot-${n}`, quantity: q(6) })]).lots;
    expect(rest.remaining).toBe(4);
    expect(drinkDose(rest, "coffee")?.quantity.value).toBe(4);
  });
});

describe("scalare la dose e annullare insieme alla bevanda", () => {
  const events = [lot("Tè verde bustine", q(25, "pz"), { expiry: "2027-01-01" })];
  const [pantryLot] = derivePantry(events).lots;
  const [drink] = buildDrink(inputOfPreset(tea), ctx()).events;
  const diaryOf = (list: unknown[]) => getDay(deriveDiary(list, { timeZone: "Europe/Rome" }), "2026-11-16")?.drinks ?? [];
  const remaining = (list: unknown[]) => derivePantry(list as never).lots[0].remaining;

  const consumeResult = () => {
    const option = pantryOptionsForDrink("tea", [pantryLot], NOW)[0];
    const r = buildDrinkConsume(option, drink.id, ctx("2026-11-16T07:13:00.000Z"));
    if (!r.ok) throw new Error(r.error);
    return r;
  };

  it("scrive un consumo stimato di una bustina, legato alla bevanda, e lo dice", () => {
    const r = consumeResult();
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      type: "consume",
      lotId: pantryLot.lotId,
      quantity: { value: 1, unit: "pz" },
      certainty: "estimated",
      note: `drink:${drink.id}`,
    });
    expect(r.message).toBe("Scalato dalla dispensa: una bustina da Tè verde bustine, è una stima.");
    expect(remaining([...events, ...r.events])).toBe(24);
  });

  it("annullare la bevanda annulla anche il consumo, e la dispensa torna com'era", () => {
    const [consume] = consumeResult().events;
    const all = [...events, drink, consume];
    const linked = linkedConsumes(drink.id, all, derivePantry(all).voidedEventIds);
    expect(linked.map((c) => c.id)).toEqual([consume.id]);

    const removal = removeDrink(diaryOf([drink])[0], linked, ctx("2026-11-16T07:20:00.000Z"));
    expect(removal.events).toHaveLength(2);
    expect(removal.message).toContain("anche ciò che avevi scalato");
    const after = [...all, ...removal.events];
    expect(diaryOf(after)).toHaveLength(0);
    expect(remaining(after)).toBe(25);

    // «Annulla» sull'avviso: i due annullamenti si annullano e tutto torna
    const back = buildUndo(removal.events, { now: "2026-11-16T07:21:00.000Z", deviceId: "d" });
    const restored = [...after, ...back];
    expect(diaryOf(restored)).toHaveLength(1);
    expect(remaining(restored)).toBe(24);
  });

  it("senza consumo collegato annulla solo la bevanda; un consumo già annullato non si annulla due volte", () => {
    const [consume] = consumeResult().events;
    const [voided] = buildUndo([consume], { now: "2026-11-16T07:15:00.000Z", deviceId: "d" });
    const all = [...events, drink, consume, voided];
    expect(linkedConsumes(drink.id, all, derivePantry(all).voidedEventIds)).toEqual([]);
    expect(removeDrink(diaryOf([drink])[0], [], ctx()).events).toHaveLength(1);
    expect(linkedConsumes("altra", all, [])).toEqual([]);
  });

  it("il consumo di una bevanda non si lega a un'altra bevanda", () => {
    const [consume] = consumeResult().events;
    const [coffee] = buildDrink(inputOfPreset(espresso), ctx("2026-11-16T07:30:00.000Z")).events;
    expect(linkedConsumes(coffee.id, [consume], [])).toEqual([]);
  });

  it("cambiare l'ora della bevanda sposta anche il legame: poi annullare toglie ancora il consumo", () => {
    const [consume] = consumeResult().events;
    const base = [...events, drink, consume];
    const linked = linkedConsumes(drink.id, base, []);
    const r = retimeDrink(diaryOf([drink])[0], "2026-11-16", "07:45", ctx("2026-11-16T07:50:00.000Z"), linked);
    if (!r.ok) throw new Error(r.error);
    const afterRetime = [...base, ...r.events];
    expect(remaining(afterRetime)).toBe(24); // una sola bustina scalata, non due
    const [newDrink] = diaryOf(afterRetime);
    const nowLinked = linkedConsumes(newDrink.eventId, afterRetime, derivePantry(afterRetime).voidedEventIds);
    expect(nowLinked).toHaveLength(1);
    const removal = removeDrink(newDrink, nowLinked, ctx("2026-11-16T08:00:00.000Z"));
    expect(remaining([...afterRetime, ...removal.events])).toBe(25);
  });
});
