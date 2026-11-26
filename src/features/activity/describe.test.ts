import { describe, expect, it } from "vitest";
import { appendItems, buildCatchUpEvents, catchUpDays, changeConsumeQuantity, changeItem, deriveDiary, rewriteMeal } from "@/core/diary";
import { declaration, drink, habit, meal, mood, supplement, symptom, water, weight } from "@/core/diary/test-helpers";
import { withOperationId, type AnyEvent } from "@/core/events";
import { stampOperationId } from "@/core/events/operation";
import { correctLot, derivePantry, type ConsumeEvent, type Lot, type PurchaseEvent } from "@/core/ledger";
import { adjust, consume, discard, gift, move, open, purchase, updateLot, voidOf } from "@/core/ledger/test-helpers";
import { buildRemoveMistaken } from "../actions";
import { retimeDrink } from "../drinks";
import { buildChangeMoment, buildEaten } from "../pantry/eaten";
import { describeOperation, doneText, indexLog, type OperationText } from "./describe";
import { groupOperations, undoOperation, type Operation } from "./operations";

const TZ = "Europe/Rome";
const BOUGHT = "2026-11-10T09:00:00.000Z";
const NOW = "2026-11-16T19:00:00.000Z"; // 20:00 a Roma: cena
const LATER = "2026-11-16T20:10:00.000Z";
const q = (value: number, unit: "g" | "ml" | "pz" = "g") => ({ value, unit });

let n = 0;
const nextId = () => `id-${String(++n).padStart(5, "0")}`;
const ctx = (now: string, deviceId = "dev-a") => ({ now, deviceId, idGenerator: nextId });

const stock: AnyEvent[] = [
  purchase("p-pollo", BOUGHT, { lotId: "pollo", productRef: "Petto di pollo", quantity: q(1000), location: "frigo" }),
  purchase("p-spinaci", BOUGHT, { lotId: "spinaci", productRef: "Spinaci", quantity: q(300), location: "frigo" }),
  purchase("p-latte", BOUGHT, { lotId: "latte", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo" }),
];

const lotOf = (lotId: string): Lot => derivePantry(stock).lots.find((l) => l.lotId === lotId) as Lot;

/** Il testo dell'operazione che contiene `event`, nel registro `stock + events`. */
function textOf(events: readonly AnyEvent[], event: Pick<AnyEvent, "id"> = events[events.length - 1], base: readonly AnyEvent[] = stock): OperationText {
  const log = [...base, ...events];
  const op = groupOperations(log, { since: "2000-01-01T00:00:00.000Z" }).find((o) => o.events.some((e) => e.id === event.id)) as Operation;
  return describeOperation(op, { pantry: derivePantry(log), ownDeviceId: "dev-a", timeZone: TZ, log: indexLog(log) });
}

describe("describeOperation: la dispensa", () => {
  it("un alimento aggiunto", () => {
    const milk = purchase("p-new", NOW, { lotId: "latte-2", productRef: "Latte", quantity: q(1000, "ml"), location: "frigo" });
    expect(textOf([milk])).toEqual({ text: "Aggiunto alla dispensa: latte, 1 l", href: "/app/dispensa?lotto=latte-2", fromOtherDevice: false });
  });

  it("più alimenti aggiunti insieme: al massimo tre nomi", () => {
    const add = (name: string, i: number) => purchase(`n-${i}`, NOW, { lotId: `lot-${i}`, productRef: name, quantity: q(1, "pz"), location: "dispensa" });
    expect(textOf(["Latte", "Uova", "Pane"].map(add))).toEqual({ text: "Aggiunti alla dispensa: 3 alimenti (latte, uova, pane)", href: "/app/dispensa", fromOtherDevice: false });
    expect(textOf(["Latte", "Uova", "Pane", "Burro", "Mele"].map(add)).text).toBe("Aggiunti alla dispensa: 5 alimenti (latte, uova, pane e altri 2)");
  });

  it("8. uno scontrino con venti alimenti è una riga sola", () => {
    const receipt = Array.from({ length: 20 }, (_, i) => purchase(`r-${String(i).padStart(2, "0")}`, NOW, { lotId: `r-lot-${i}`, productRef: `Prodotto ${i + 1}`, quantity: q(1, "pz"), location: "dispensa", receiptId: "r1" }));
    expect(textOf(receipt).text).toBe("Aggiunti alla dispensa: 20 alimenti (prodotto 1, prodotto 2, prodotto 3 e altri 17)");
  });

  it("buttato, con il motivo", () => {
    const e = discard("d1", NOW, { lotId: "pollo", quantity: q(150), reason: "expired" });
    expect(textOf([e])).toEqual({ text: "Buttato: 150 g di petto di pollo (scaduto)", href: "/app/dispensa?lotto=pollo", fromOtherDevice: false });
  });

  it("regalato", () => {
    expect(textOf([gift("g1", NOW, { lotId: "pollo", quantity: q(150) })])).toEqual({ text: "Regalato: 150 g di petto di pollo", href: "/app/dispensa?lotto=pollo", fromOtherDevice: false });
  });

  it("aperto", () => {
    expect(textOf([open("o1", NOW, { lotId: "latte" })])).toEqual({ text: "Aperto: latte", href: "/app/dispensa?lotto=latte", fromOtherDevice: false });
  });

  it("spostato", () => {
    expect(textOf([move("m1", NOW, { lotId: "pollo", to: "freezer" })])).toEqual({ text: "Spostato in freezer: petto di pollo", href: "/app/dispensa?lotto=pollo", fromOtherDevice: false });
  });

  it("quanto ne resta, e «finito» quando non ne resta", () => {
    expect(textOf([adjust("a1", NOW, { lotId: "pollo", remaining: q(250) })])).toEqual({ text: "Corretto: petto di pollo, ne restano 250 g", href: "/app/dispensa?lotto=pollo", fromOtherDevice: false });
    expect(textOf([adjust("a2", NOW, { lotId: "pollo", remaining: q(0) })]).text).toBe("Finito: petto di pollo");
  });

  it("una modifica, o l'ingresso riscritto con lo stesso alimento", () => {
    const edited = updateLot("u1", NOW, { lotId: "pollo", patch: { expiry: { date: "2026-11-20", kind: "use_by" } } });
    expect(textOf([edited])).toEqual({ text: "Corretto: petto di pollo", href: "/app/dispensa?lotto=pollo", fromOtherDevice: false });
    const rewritten = correctLot(stock[0] as PurchaseEvent, { quantity: q(1200) }, { now: () => NOW, idGenerator: nextId }) as AnyEvent[];
    expect(rewritten.map((e) => e.type)).toEqual(["void", "purchase"]);
    expect(textOf(rewritten).text).toBe("Corretto: petto di pollo");
  });

  it("più confezioni dello stesso alimento insieme", () => {
    const packs = [1, 2, 3].map((i) => purchase(`mousse-${i}`, BOUGHT, { lotId: `mousse-${i}`, productRef: "Mousse", quantity: q(170), location: "frigo" }));
    const moved = [1, 2, 3].map((i) => move(`mv-${i}`, NOW, { lotId: `mousse-${i}`, to: "freezer" }));
    expect(textOf(moved, moved[0], [...stock, ...packs])).toEqual({ text: "Spostato in freezer: mousse (3 confezioni)", href: "/app/dispensa", fromOtherDevice: false });
  });
});

describe("describeOperation: il diario", () => {
  const dinner = meal("m-cena", NOW, { mealId: "meal-1", kind: "dinner", items: [{ name: "Pane", quantity: q(40), certainty: "estimated" }] });
  const pollo = consume("c-pollo", NOW, { lotId: "pollo", quantity: q(200), mealId: "meal-1" });
  const spinaci = consume("c-spinaci", NOW, { lotId: "spinaci", quantity: q(75), mealId: "meal-1" });

  it("un pasto con le sue voci", () => {
    expect(textOf([dinner, pollo, spinaci])).toEqual({ text: "Registrato: cena (petto di pollo, spinaci, pane)", href: "/app?voce=m-cena", fromOtherDevice: false });
  });

  it("«Mangiato» dalla scheda: con il momento, e porta alla voce", () => {
    const eaten = buildEaten([lotOf("spinaci")], { kind: "value", value: 75 }, ctx(NOW), deriveDiary(stock));
    if (!eaten.ok) throw new Error(eaten.error);
    expect(eaten.events.map((e) => e.type)).toEqual(["meal", "consume"]);
    expect(textOf(eaten.events)).toEqual({ text: "Mangiato: 75 g di spinaci, a cena", href: `/app?voce=${eaten.marked.consumes[0].id}`, fromOtherDevice: false });
  });

  it("un consumo senza pasto nel gruppo: il momento si legge dal registro, se c'è", () => {
    const added = consume("c-late", LATER, { lotId: "spinaci", quantity: q(75), mealId: "meal-1", note: "quick" });
    expect(textOf([dinner, pollo, added])).toEqual({ text: "Mangiato: 75 g di spinaci, a cena", href: "/app?voce=c-late", fromOtherDevice: false });
    const loose = consume("c-loose", LATER, { lotId: "spinaci", quantity: q(75) });
    expect(textOf([loose]).text).toBe("Mangiato: 75 g di spinaci");
    const log = [...stock, dinner, pollo, added];
    const op = groupOperations(log, { since: BOUGHT }).find((o) => o.id === "c-late") as Operation;
    expect(describeOperation(op, { pantry: derivePantry(log), ownDeviceId: "dev-a", timeZone: TZ }).text).toBe("Mangiato: 75 g di spinaci");
  });

  it("un consumo corretto", () => {
    const edit = changeConsumeQuantity(spinaci, { value: 80, estimated: false }, 300, ctx(LATER));
    if (!edit.ok) throw new Error(edit.error);
    const replacement = edit.events[1] as ConsumeEvent;
    expect(textOf([dinner, pollo, spinaci, ...edit.events])).toEqual({ text: "Corretto: spinaci, 80 g", href: `/app?voce=${replacement.id}`, fromOtherDevice: false });
  });

  it("un consumo spostato in un altro momento", () => {
    const eaten = buildEaten([lotOf("pollo")], { kind: "value", value: 275 }, ctx("2026-11-16T12:11:00.000Z"), deriveDiary(stock));
    if (!eaten.ok) throw new Error(eaten.error);
    const log = [...stock, ...eaten.events];
    const moved = buildChangeMoment(eaten.marked, { kind: "dinner" }, ctx(LATER), deriveDiary(log));
    if (!moved.ok) throw new Error(moved.error);
    expect(textOf([...eaten.events, ...moved.events])).toEqual({ text: "Spostato a cena: 275 g di petto di pollo", href: `/app?voce=${moved.marked.consumes[0].id}`, fromOtherDevice: false });
  });

  it("un pasto corretto, e una voce aggiunta", () => {
    const log = [...stock, dinner, pollo];
    const retimed = rewriteMeal("meal-1", { kind: "lunch" }, log, ctx(LATER));
    if (!retimed.ok) throw new Error(retimed.error);
    expect(textOf([dinner, pollo, ...retimed.events])).toEqual({ text: "Pasto corretto: pranzo", href: `/app?voce=${retimed.events[1].id}`, fromOtherDevice: false });
    const more = appendItems("meal-1", [{ name: "Mela", quantity: q(1, "pz"), certainty: "estimated" }], log, ctx(LATER));
    if (!more.ok) throw new Error(more.error);
    expect(textOf([dinner, pollo, ...more.events]).text).toBe("Aggiunto a cena: mela");
  });

  it("acqua: un bicchiere, e due tocchi veloci", () => {
    expect(textOf([water("w1", NOW, { ml: 200 })])).toEqual({ text: "Acqua: 200 ml", href: "/app?voce=w1", fromOtherDevice: false });
    const pair = withOperationId([water("w1", NOW, { ml: 200 }), water("w2", "2026-11-16T19:00:00.400Z", { ml: 200 })], "op-1");
    expect(textOf(pair).text).toBe("Acqua: 400 ml");
  });

  it("una bevanda, e la sua ora corretta", () => {
    const tea = drink("d-te", NOW, { name: "Tè", ml: 200 });
    expect(textOf([tea])).toEqual({ text: "Bevanda: tè, 200 ml", href: "/app?voce=d-te", fromOtherDevice: false });
    const log = [...stock, tea];
    const retimed = retimeDrink(deriveDiary(log).days[0].drinks[0], "2026-11-16", "08:15", { ...ctx(LATER), timeZone: TZ });
    if (!retimed.ok) throw new Error(retimed.error);
    expect(textOf([tea, ...retimed.events]).text).toBe("Bevanda spostata: tè, alle 08:15");
  });

  it("un pasto dichiarato", () => {
    const skipped = declaration("x1", NOW, { date: "2026-11-16", kind: "lunch", status: "skipped" });
    expect(textOf([skipped])).toEqual({ text: "Pranzo saltato", href: "/app?voce=x1", fromOtherDevice: false });
    expect(textOf([declaration("x2", NOW, { date: "2026-11-16", kind: "lunch", status: "untracked" })]).text).toBe("Pranzo · mangiato, senza dettagli");
    expect(textOf([declaration("x3", NOW, { date: "2026-11-16", kind: "breakfast", status: "skipped" })]).text).toBe("Colazione saltata");
  });

  it("peso, umore, sintomi, integratori", () => {
    expect(textOf([weight("k1", NOW, { kg: 72.4 })])).toEqual({ text: "Peso: 72,4 kg", href: "/app?voce=k1", fromOtherDevice: false });
    expect(textOf([mood("o1", NOW, { score: 4 })]).text).toBe("Umore: 4 su 5");
    expect(textOf([symptom("s1", NOW, { kind: "energy", score: 3 })]).text).toBe("Energia: 3 su 5");
    expect(textOf([supplement("i1", NOW, { name: "Vitamina D" })]).text).toBe("Integratore: vitamina D");
    expect(textOf([mood("o2", NOW, { score: 4 }), symptom("s2", NOW, { kind: "energy", score: 3 })]).text).toBe("Umore: 4 su 5 · Energia: 3 su 5");
    const first = weight("k2", NOW, { kg: 72.4 });
    const fixed = [voidOf("v-k2", LATER, "k2"), weight("k3", NOW, { kg: 71.9, recordedAt: LATER })];
    expect(textOf([first, ...fixed]).text).toBe("Peso corretto: 71,9 kg");
  });

  it("un pasto abituale salvato o ritirato", () => {
    const items = [{ name: "Caffè", quantity: q(30, "ml"), certainty: "estimated" as const }];
    const saved = habit("h1", NOW, { habitId: "h", title: "Solita colazione", kind: "breakfast", items });
    expect(textOf([saved])).toEqual({ text: "Pasto abituale salvato: Solita colazione", href: "/app/pasti-abituali", fromOtherDevice: false });
    const retired = habit("h2", LATER, { habitId: "h", title: "Solita colazione", kind: "breakfast", items, archived: true });
    expect(textOf([saved, retired]).text).toBe("Pasto abituale ritirato: Solita colazione");
  });
});

describe("describeOperation: il resto", () => {
  const envelope = (id: string, type: string, extra: Record<string, unknown>) =>
    ({ id, type, at: NOW, recordedAt: NOW, deviceId: "dev-a", schemaVersion: 1, certainty: "measured", source: "manual", ...extra }) as unknown as AnyEvent;

  it("le altre famiglie: una frase per tipo dove è semplice, altrimenti il nome della famiglia", () => {
    expect(textOf([envelope("pw", "planWeek", { weekStart: "2026-11-16", entries: [] })])).toEqual({ text: "Piano: settimana cambiata", href: "/app/piano/settimana", fromOtherDevice: false });
    const recipe = envelope("rc", "recipe", { recipeId: "r1", title: "Pasta al forno", servings: 4, ingredients: [{ name: "Pasta", quantity: q(320) }], steps: [{ text: "Cuoci." }] });
    expect(textOf([recipe])).toEqual({ text: "Ricetta salvata: pasta al forno", href: "/app/ricette/vedi?id=r1", fromOtherDevice: false });
    expect(textOf([envelope("ex", "experiment", { experimentId: "e1", closedOn: "2026-11-20" })])).toEqual({ text: "Modifica: esperimenti", href: "/app/salute/esperimenti", fromOtherDevice: false });
  });

  it("l'alimento che non c'è più prende il nome dal suo ingresso nel registro", () => {
    const eaten = consume("c-old", NOW, { lotId: "spinaci", quantity: q(75) });
    const base = [...stock, eaten];
    const removed = buildRemoveMistaken({ lotId: "spinaci", productRef: "Spinaci" }, base, [], ctx(LATER));
    if (!removed.ok) throw new Error(removed.error);
    const log = [...base, ...removed.events];
    expect(derivePantry(log).lots.map((l) => l.lotId)).not.toContain("spinaci");
    const op = groupOperations(log, { since: BOUGHT }).find((o) => o.id === "c-old") as Operation;
    expect(op.state).toBe("undone");
    expect(describeOperation(op, { pantry: derivePantry(log), ownDeviceId: "dev-a", timeZone: TZ, log: indexLog(log) }).text).toBe("Mangiato: 75 g di spinaci");
    expect(describeOperation(op, { pantry: derivePantry(log), ownDeviceId: "dev-a", timeZone: TZ }).text).toBe("Mangiato: 75 g di alimento");
  });

  it("la riparazione di una preparazione non è un «mangiato»", () => {
    const repair = consume("prep-repair:c1:abc", NOW, { lotId: "pollo", quantity: q(120), source: "system" });
    expect(textOf([repair])).toEqual({ text: "Preparazione riparata: 120 g di petto di pollo", href: "/app/preparazioni", fromOtherDevice: false });
  });

  it("un'azione arrivata dall'altro telefono", () => {
    const theirs = water("w-b", NOW, { ml: 200, deviceId: "dev-b" });
    expect(textOf([theirs])).toEqual({ text: "Acqua: 200 ml", href: "/app?voce=w-b", fromOtherDevice: true });
  });

  it("11. un tipo che questa versione non conosce: la frase generica, senza collegamento, e l'elenco non cade", () => {
    const op: Operation = { id: "x", at: NOW, deviceId: "dev-b", events: [envelope("x", "holograph", { shape: {} })], state: "active" };
    expect(describeOperation(op, { pantry: derivePantry(stock), ownDeviceId: "dev-a", timeZone: TZ })).toEqual({ text: "Modifica fatta con una versione più nuova dell'app", fromOtherDevice: true });
    const broken: Operation = { id: "y", at: NOW, deviceId: "dev-a", events: [envelope("y", "meal", { mealId: "m", kind: "dinner", items: 7 })], state: "active" };
    expect(describeOperation(broken, { pantry: derivePantry(stock), ownDeviceId: "dev-a", timeZone: TZ }).text).not.toBe("");
  });
});

describe("describeOperation: i testi corretti dopo la verifica dell'ondata 2", () => {
  const away = (name: string, energyKcal: number) => ({ name, quantity: q(1, "pz"), certainty: "estimated" as const, energyKcal });
  const breakfast = meal("m-fuori", NOW, { mealId: "meal-f", kind: "breakfast", certainty: "estimated", items: [away("Fuori casa · normale", 400)] });

  it("un pasto fuori casa registrato: il momento e la taglia, senza parentesi e senza «Spostato»", () => {
    expect(textOf([breakfast])).toEqual({ text: "Registrato: colazione fuori casa, normale", href: "/app?voce=m-fuori", fromOtherDevice: false });
    // con altro nel pasto resta l'elenco
    const mixed = meal("m-misto", NOW, { mealId: "meal-x", kind: "lunch", items: [away("Fuori casa · leggero", 300), { name: "Mela", quantity: q(1, "pz"), certainty: "estimated" }] });
    expect(textOf([mixed]).text).toBe("Registrato: pranzo (fuori casa · leggero, mela)");
  });

  it("cambiata solo la taglia della stima: «Corretto», con la taglia nuova; cambiata anche l'ora: «Pasto corretto»", () => {
    const log = [...stock, breakfast];
    const resized = changeItem("meal-f", 0, { name: "Fuori casa · abbondante", energyKcal: 600 }, log, ctx(LATER));
    if (!resized.ok) throw new Error(resized.error);
    expect(resized.events.map((e) => e.type)).toEqual(["void", "meal"]);
    expect(textOf([breakfast, ...resized.events])).toEqual({ text: "Corretto: colazione fuori casa, abbondante", href: `/app?voce=${resized.events[1].id}`, fromOtherDevice: false });
    // la riga di prima resta quella della registrazione
    expect(textOf([breakfast, ...resized.events], breakfast).text).toBe("Registrato: colazione fuori casa, normale");
    const retimed = rewriteMeal("meal-f", { minutes: 9 * 60 }, log, { ...ctx(LATER), timeZone: TZ });
    if (!retimed.ok) throw new Error(retimed.error);
    expect(textOf([breakfast, ...retimed.events]).text).toBe("Pasto corretto: colazione");
    // senza il registro non si sa che cosa c'era prima: resta la frase generica della correzione
    const all = [...log, ...resized.events];
    const op = groupOperations(all, { since: BOUGHT }).find((o) => o.events.some((e) => e.id === resized.events[1].id)) as Operation;
    expect(describeOperation(op, { pantry: derivePantry(all), ownDeviceId: "dev-a", timeZone: TZ }).text).toBe("Pasto corretto: colazione");
  });

  it("una correzione con l'opId ereditato è una riga sua, anche a meno di due secondi dall'originale; mai «Spostato»", () => {
    const soon = "2026-11-16T19:00:01.200Z";
    const [first] = stampOperationId([breakfast], "op-A");
    const second = { ...first, id: "m-fuori-2", recordedAt: soon, replaces: "m-fuori", items: [away("Fuori casa · abbondante", 600)] } as AnyEvent;
    const [cancel] = stampOperationId([voidOf("v-fuori", soon, "m-fuori") as AnyEvent], "op-B");
    const events = [first, cancel, second];
    const log = [...stock, ...events];
    const op = groupOperations(log, { since: BOUGHT }).find((o) => o.events.some((e) => e.id === "m-fuori-2")) as Operation;
    expect(op.events.map((e) => e.id).sort()).toEqual(["m-fuori-2", "v-fuori"]);
    expect(textOf(events, second)).toEqual({ text: "Corretto: colazione fuori casa, abbondante", href: "/app?voce=m-fuori-2", fromOtherDevice: false });
    expect(textOf(events, first).text).toBe("Registrato: colazione fuori casa, normale");
  });

  it("due versioni dello stesso pasto nella stessa operazione (l'annullamento che le separa non è ancora arrivato): vale l'ultima, mai «Spostato»", () => {
    const soon = "2026-11-16T19:00:01.200Z";
    const [first] = stampOperationId([breakfast], "op-A");
    const second = { ...first, id: "m-fuori-2", recordedAt: soon, replaces: "m-fuori", items: [away("Fuori casa · abbondante", 600)] } as AnyEvent;
    const events = [first, second];
    const log = [...stock, ...events];
    const op = groupOperations(log, { since: BOUGHT }).find((o) => o.events.some((e) => e.id === "m-fuori-2")) as Operation;
    expect(op.events.map((e) => e.id).sort()).toEqual(["m-fuori", "m-fuori-2"]);
    expect(textOf(events, second)).toEqual({ text: "Corretto: colazione fuori casa, abbondante", href: "/app?voce=m-fuori-2", fromOtherDevice: false });

    const dinner = stampOperationId([meal("m-c1", NOW, { mealId: "meal-c", kind: "dinner", items: [{ name: "Pane", quantity: q(40), certainty: "estimated" }] })], "op-C")[0];
    const moved = { ...dinner, id: "m-c2", recordedAt: soon, at: "2026-11-16T19:30:00.000Z", replaces: "m-c1" } as AnyEvent;
    expect(textOf([dinner, moved], moved)).toEqual({ text: "Pasto corretto: cena", href: "/app?voce=m-c2", fromOtherDevice: false });
  });

  it("più confezioni uguali aggiunte insieme: quante, e di che cosa", () => {
    const packs = [1, 2, 3].map((i) => purchase(`mo-${i}`, NOW, { lotId: `mo-lot-${i}`, productRef: "Mousse cacao protein", quantity: q(170), location: "frigo" }));
    expect(textOf(packs)).toEqual({ text: "Aggiunte alla dispensa: 3 confezioni di mousse cacao protein", href: "/app/dispensa", fromOtherDevice: false });
    // un nome diverso tra gli altri: resta l'elenco
    const other = purchase("mo-4", NOW, { lotId: "mo-lot-4", productRef: "Uova", quantity: q(6, "pz"), location: "frigo" });
    expect(textOf([...packs, other]).text).toBe("Aggiunti alla dispensa: 4 alimenti (mousse cacao protein, uova)");
  });

  it("ciò che si scala dalla dispensa per una bevanda dice per quale; se la bevanda non si trova, no", () => {
    const leaves = purchase("p-te", BOUGHT, { lotId: "te", productRef: "Tè", quantity: q(40), location: "dispensa" });
    const tea = drink("d-te", "2026-11-16T12:11:00.000Z", { name: "Tè", ml: 200 });
    const scaled = consume("c-te", NOW, { lotId: "te", quantity: q(2), certainty: "estimated", note: "drink:d-te" });
    expect(textOf([tea, scaled], scaled, [...stock, leaves])).toEqual({ text: "Scalato dalla dispensa: 2 g di tè (per il tè delle 13:11)", href: "/app/dispensa?lotto=te", fromOtherDevice: false });
    expect(textOf([scaled], scaled, [...stock, leaves]).text).toBe("Scalato dalla dispensa: 2 g di tè");
    const log = [...stock, leaves, tea, scaled];
    const op = groupOperations(log, { since: BOUGHT }).find((o) => o.id === "c-te") as Operation;
    expect(describeOperation(op, { pantry: derivePantry(log), ownDeviceId: "dev-a", timeZone: TZ }).text).toBe("Scalato dalla dispensa: 2 g di tè");

    const said = (name: string) => {
      const d = drink("d-x", "2026-11-16T07:05:00.000Z", { name, ml: 200 });
      return textOf([d, consume("c-x", NOW, { lotId: "te", quantity: q(2), note: "drink:d-x" })], { id: "c-x" }, [...stock, leaves]).text;
    };
    expect(said("Caffè espresso")).toBe("Scalato dalla dispensa: 2 g di tè (per il caffè espresso delle 08:05)");
    expect(said("Tisana")).toBe("Scalato dalla dispensa: 2 g di tè (per la tisana delle 08:05)");
    expect(said("Infuso")).toBe("Scalato dalla dispensa: 2 g di tè (per l'infuso delle 08:05)");
  });

  it("5. un tè spostato di ora con il suo consumo della dispensa è una riga sola, «Bevanda spostata»", () => {
    const leaves = purchase("p-te", BOUGHT, { lotId: "te", productRef: "Tè", quantity: q(40), location: "dispensa" });
    const base = stampOperationId([...stock, leaves], "op-spesa");
    const tea = stampOperationId([drink("d-te", "2026-11-16T12:11:00.000Z", { name: "Tè", ml: 200 })], "op-te");
    const scaled = stampOperationId([consume("c-te", "2026-11-16T12:12:00.000Z", { lotId: "te", quantity: q(2), certainty: "estimated", note: "drink:d-te" })], "op-scalato");
    const log0 = [...base, ...tea, ...scaled];
    const retimed = retimeDrink(deriveDiary(log0).days[0].drinks[0], "2026-11-16", "08:15", { ...ctx(LATER), timeZone: TZ }, scaled as ConsumeEvent[]);
    if (!retimed.ok) throw new Error(retimed.error);
    expect(retimed.events.map((e) => e.type)).toEqual(["void", "drink", "void", "consume"]);
    for (const write of [(events: readonly AnyEvent[]) => stampOperationId(events, "op-nuova"), (events: readonly AnyEvent[]) => withOperationId(events, "op-nuova")]) {
      const log = [...log0, ...write(retimed.events)];
      const ops = groupOperations(log, { since: LATER });
      expect(ops).toHaveLength(1);
      expect(ops[0].events).toHaveLength(4);
      expect(describeOperation(ops[0], { pantry: derivePantry(log), ownDeviceId: "dev-a", timeZone: TZ, log: indexLog(log) }).text).toBe("Bevanda spostata: tè, alle 08:15");
    }
  });
});

describe("doneText: l'avviso dopo «Annulla» e «Rifai»", () => {
  it("riprende il testo della riga, in minuscolo e senza i due punti", () => {
    expect(doneText("undo", "Mangiato: 75 g di spinaci, a cena")).toBe("Annullato: mangiato 75 g di spinaci, a cena.");
    expect(doneText("redo", "Buttato: 150 g di petto di pollo (scaduto)")).toBe("Rifatto: buttato 150 g di petto di pollo (scaduto).");
    expect(doneText("undo", "Pranzo saltato")).toBe("Annullato: pranzo saltato.");
    expect(doneText("undo", "Acqua: 400 ml")).toBe("Annullato: acqua 400 ml.");
  });
});

describe("describeOperation: «Mettiamoci in pari»", () => {
  const AFTER = "2026-11-17T09:00:00.000Z";
  const minutesOf = { breakfast: 480, lunch: 780, dinner: 1200, snack: 990 };
  const pasta = { name: "Pasta", quantity: q(100), certainty: "estimated" as const };
  const days = ["2026-11-14", "2026-11-15", "2026-11-16"];
  const catchUp = (deviceId = "dev-a"): AnyEvent[] =>
    buildCatchUpEvents(
      days.flatMap((date) => [
        { date, kind: "breakfast" as const, choice: { kind: "meal" as const, items: [pasta], source: "manual" as const } },
        { date, kind: "lunch" as const, choice: { kind: "unknown" as const } },
        { date, kind: "dinner" as const, choice: { kind: "skipped" as const } },
      ]),
      { deviceId, now: AFTER, timeZone: TZ, minutesOf, idGenerator: nextId },
    );

  it("tre giorni con pasti e dichiarazioni: una riga, al primo giorno", () => {
    const events = catchUp();
    expect(textOf(events)).toEqual({ text: "Messo in pari: 14-16 nov", href: "/app?giorno=2026-11-14", fromOtherDevice: false });
  });

  it("un giorno solo", () => {
    const [one] = buildCatchUpEvents([{ date: "2026-11-16", kind: "lunch", choice: { kind: "skipped" } }], { deviceId: "dev-a", now: AFTER, timeZone: TZ, minutesOf, idGenerator: nextId });
    expect(textOf([one]).text).toBe("Messo in pari: lunedì 16");
  });

  it("un pasto normale, senza la nota, resta com'era", () => {
    const plain = meal("m-plain", NOW, { mealId: "meal-plain", kind: "dinner", items: [{ name: "Pasta", quantity: q(100), certainty: "estimated" }] });
    expect(textOf([plain]).text).toBe("Registrato: cena (pasta)");
    const skipped = declaration("x-plain", NOW, { date: "2026-11-16", kind: "lunch", status: "skipped" });
    expect(textOf([skipped]).text).toBe("Pranzo saltato");
  });

  it("una correzione successiva di un pasto recuperato non è «Messo in pari»", () => {
    const events = catchUp();
    const recovered = events.find((e) => e.type === "meal" && e.at.startsWith("2026-11-15")) as Extract<AnyEvent, { type: "meal" }>;
    const base = [...stock, ...events];
    const fixed = changeItem(recovered.mealId, 0, { quantity: q(150) }, base, ctx("2026-11-17T10:00:00.000Z"));
    if (!fixed.ok) throw new Error(fixed.error);
    expect(fixed.events.some((e) => e.note === "catchup")).toBe(true);
    const text = textOf(fixed.events, fixed.events[fixed.events.length - 1], base).text;
    expect(text).not.toMatch(/^Messo in pari/);
    const moved = rewriteMeal(recovered.mealId, { kind: "lunch" }, base, { ...ctx("2026-11-17T10:05:00.000Z"), timeZone: TZ });
    if (!moved.ok) throw new Error(moved.error);
    expect(textOf(moved.events, moved.events[moved.events.length - 1], base).text).not.toMatch(/^Messo in pari/);
    // la riga del recupero resta la sua
    expect(textOf(events, events[0], [...stock, ...fixed.events]).text).toBe("Messo in pari: 14-16 nov");
  });

  it("timbrati come fa appendEvents, sono un'operazione sola; «Annulla» li toglie tutti e i giorni tornano vuoti", () => {
    const base = stampOperationId([...stock, meal("m-10", "2026-11-10T12:00:00.000Z", { mealId: "meal-10", kind: "lunch", items: [pasta] })], "op-prima");
    for (const stamp of [(e: readonly AnyEvent[]) => withOperationId(e, "op-pari"), (e: readonly AnyEvent[]) => stampOperationId(e, "op-pari")]) {
      const written = stamp(catchUp());
      const log = [...base, ...written];
      const ops = groupOperations(log, { since: AFTER });
      expect(ops).toHaveLength(1);
      expect(ops[0].events).toHaveLength(9);
      expect(describeOperation(ops[0], { pantry: derivePantry(log), ownDeviceId: "dev-a", timeZone: TZ, log: indexLog(log) }).text).toBe("Messo in pari: 14-16 nov");
      // restano vuoti solo i giorni che il recupero non ha toccato
      expect(catchUpDays(deriveDiary(log, { timeZone: TZ }), "2026-11-17")).toEqual(["2026-11-11", "2026-11-12", "2026-11-13"]);

      const undo = undoOperation(ops[0], log, derivePantry(log), { deviceId: "dev-a", now: "2026-11-17T09:05:00.000Z", timeZone: TZ, idGenerator: nextId });
      if (!undo.ok) throw new Error(undo.reason);
      expect(undo.events.map((v) => v.targetEventId).sort()).toEqual(written.map((e) => e.id).sort());
      const after = [...log, ...stampOperationId(undo.events, "op-annulla")];
      expect(catchUpDays(deriveDiary(after, { timeZone: TZ }), "2026-11-17")).toEqual(["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15", "2026-11-16"]);
      // la dispensa non si muove, né scrivendo né annullando
      expect(derivePantry(log).lots).toEqual(derivePantry(base).lots);
      expect(derivePantry(after).lots).toEqual(derivePantry(base).lots);
    }
  });
});
