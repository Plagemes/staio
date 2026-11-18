import { describe, expect, it } from "vitest";
import { appendItems, changeConsumeQuantity, deriveDiary, rewriteMeal } from "@/core/diary";
import { declaration, drink, habit, meal, mood, supplement, symptom, water, weight } from "@/core/diary/test-helpers";
import { withOperationId, type AnyEvent } from "@/core/events";
import { correctLot, derivePantry, type ConsumeEvent, type Lot, type PurchaseEvent } from "@/core/ledger";
import { adjust, consume, discard, gift, move, open, purchase, updateLot, voidOf } from "@/core/ledger/test-helpers";
import { buildRemoveMistaken } from "../actions";
import { retimeDrink } from "../drinks";
import { buildChangeMoment, buildEaten } from "../pantry/eaten";
import { describeOperation, doneText, indexLog, type OperationText } from "./describe";
import { groupOperations, type Operation } from "./operations";

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
    expect(textOf([declaration("x2", NOW, { date: "2026-11-16", kind: "lunch", status: "untracked" })]).text).toBe("Pranzo mangiato, senza dettagli");
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

describe("doneText: l'avviso dopo «Annulla» e «Rifai»", () => {
  it("riprende il testo della riga, in minuscolo e senza i due punti", () => {
    expect(doneText("undo", "Mangiato: 75 g di spinaci, a cena")).toBe("Annullato: mangiato 75 g di spinaci, a cena.");
    expect(doneText("redo", "Buttato: 150 g di petto di pollo (scaduto)")).toBe("Rifatto: buttato 150 g di petto di pollo (scaduto).");
    expect(doneText("undo", "Pranzo saltato")).toBe("Annullato: pranzo saltato.");
    expect(doneText("undo", "Acqua: 400 ml")).toBe("Annullato: acqua 400 ml.");
  });
});
