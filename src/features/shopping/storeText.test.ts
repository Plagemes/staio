import { describe, expect, it } from "vitest";
import { addOffList, buildPriceBook, checkItem, startTrip, type ShoppingLine } from "@/core/shopping";
import { day, ledger } from "@/core/shopping/test-helpers";
import { formatPrice } from "../format";
import {
  addedToListText,
  alreadyReason,
  alreadyTitle,
  blockingText,
  checkText,
  durationText,
  rowDetail,
  cartCount,
  compactRow,
  compareSummary,
  finishLabel,
  missingText,
  putAwayDoneText,
  putAwayLabel,
  putAwayTitle,
  readAddText,
  statusText,
  tripEstimate,
} from "./storeText";
import { tripTotals } from "./trip";

const line = (name: string, quantity: number, unit: ShoppingLine["unit"] = "g"): ShoppingLine => ({ id: `${name.toLowerCase()}|${unit}`, key: name.toLowerCase(), name, unit, quantity });
const started = `${day(10)}T09:00:00.000Z`;

describe("riga di stato", () => {
  const progress = { checked: 3, total: 8 };

  it("negozio, quante spuntate, e la stima: «circa» se tutte hanno un prezzo, «almeno» se no", () => {
    expect(statusText("Conad", progress, { cents: 2400, priced: 8, unpriced: 0 })).toBe(`Conad · 3 di 8 · circa ${formatPrice(2400)}`);
    expect(statusText("Conad", progress, { cents: 2400, priced: 6, unpriced: 2 })).toBe(`Conad · 3 di 8 · almeno ${formatPrice(2400)}`);
  });

  it("senza negozio lo dice; senza nessun prezzo non dice soldi", () => {
    expect(statusText(null, progress, { cents: 0, priced: 0, unpriced: 8 })).toBe("Negozio non indicato · 3 di 8");
  });

  it("la stima conta tutta la lista e le fuori lista con il prezzo scritto", () => {
    const l = ledger();
    l.buy(0, "Pasta", 500, "g", { price: 100, store: "Coop", category: "pasta_dry" });
    const book = buildPriceBook(l.pantry());
    let trip = startTrip([line("Pasta", 1000), line("Mele", 1000)], { store: "Coop", startedAt: started });
    trip = addOffList(trip, { id: "o1", name: "Gelato", priceCents: 300, addedAt: started });
    trip = addOffList(trip, { id: "o2", name: "Pane", addedAt: started });
    expect(tripEstimate(trip, tripTotals(trip, book))).toEqual({ cents: 500, priced: 2, unpriced: 2 });
  });
});

describe("pulsanti", () => {
  it("«Ho finito» porta il numero di ciò che è nel carrello, se c'è", () => {
    expect(finishLabel(3)).toBe("Ho finito (3)");
    expect(finishLabel(0)).toBe("Ho finito");
  });

  it("nel carrello: le spuntate e le fuori lista", () => {
    let trip = startTrip([line("Pasta", 500), line("Mele", 1000)], { startedAt: started });
    expect(cartCount(trip)).toBe(0);
    trip = checkItem(trip, "pasta|g", started);
    trip = addOffList(trip, { id: "o1", name: "Gelato", addedAt: started });
    expect(cartCount(trip)).toBe(2);
  });

  it("«Metti in dispensa» e «Aggiungi alla dispensa» con il numero delle righe", () => {
    expect(putAwayTitle(6)).toBe("Metti in dispensa (6)");
    expect(putAwayLabel(6)).toBe("Aggiungi alla dispensa (6)");
  });
});

describe("Metti in dispensa", () => {
  it("la riga chiusa: nome, quantità, luogo", () => {
    expect(compactRow({ name: "Latte intero", quantityText: "1 l", location: "frigo" })).toBe("Latte intero · 1 l · Frigo");
    expect(compactRow({ name: "Pasta", quantityText: "500 g", location: "dispensa" })).toBe("Pasta · 500 g · Credenza");
    expect(compactRow({ name: "Pane", quantityText: " ", location: "" })).toBe("Pane");
  });

  it("in cima, quanti dati mancano", () => {
    expect(missingText(0)).toBeNull();
    expect(missingText(1)).toBe("Manca 1 dato: te lo chiedo qui sotto.");
    expect(missingText(2)).toBe("Mancano 2 dati: te li chiedo qui sotto.");
  });

  it("sotto il pulsante, che cosa ferma il salvataggio", () => {
    expect(blockingText([{ name: "latte", missing: [] }])).toBeNull();
    expect(blockingText([{ name: "pane", missing: ["quantity"] }])).toBe("Scrivi quanto per: pane.");
    expect(
      blockingText([
        { name: "pane", missing: ["quantity", "category"] },
        { name: "uova", missing: ["quantity"] },
        { name: "tahina", missing: ["category"] },
      ]),
    ).toBe("Scrivi quanto per: pane, uova. Scegli la categoria per: pane, tahina.");
  });

  it("l'avviso dice quanti alimenti e che le scadenze sono stime; se la memoria non si è scritta, lo dice a parte", () => {
    expect(putAwayDoneText(6)).toBe("Aggiunti alla dispensa: 6 alimenti. Scadenze stimate.");
    expect(putAwayDoneText(1)).toBe("Aggiunto alla dispensa: 1 alimento. Scadenza stimata.");
    expect(putAwayDoneText(2, false)).toBe("Aggiunti alla dispensa: 2 alimenti. Scadenze stimate. Non ho potuto ricordare le categorie.");
  });

  it("sotto la riga chiusa, la categoria e la scadenza stimata che ne viene", () => {
    const today = "2026-11-18";
    expect(rowDetail({ category: "cheese_fresh", location: "frigo" }, today)).toMatch(/^Formaggi freschi · ~\d+ giorn/);
    expect(rowDetail({ category: "pasta_dry", location: "dispensa" }, today)).toMatch(/^Pasta secca · ~\d+ (mesi|anni?)$/);
    expect(rowDetail({ category: "", location: "frigo" }, today)).toBe("Categoria da scegliere");
    expect(durationText(1)).toBe("~1 giorno");
    expect(durationText(5)).toBe("~5 giorni");
    expect(durationText(90)).toBe("~3 mesi");
    expect(durationText(730)).toBe("~2 anni");
  });

  it("le categorie dedotte dal nome si contano in cima", () => {
    expect(checkText(0)).toBeNull();
    expect(checkText(1)).toBe("Una categoria l'ho dedotta dal nome: controllala.");
    expect(checkText(3)).toBe("3 categorie le ho dedotte dal nome: controllale.");
  });

  it("«Già in dispensa»: il titolo e il motivo in poche parole", () => {
    expect(alreadyTitle(2)).toBe("Già in dispensa (2)");
    expect(alreadyReason({ createdAt: "2026-11-18T12:00:00.000Z", quantity: 1000, unit: "ml", store: "Conad · Via Roma" }, "2026-11-18")).toBe("comprato oggi, 1 l, Conad · Via Roma");
    expect(alreadyReason({ createdAt: "2026-11-17T15:00:00.000Z", quantity: 250, unit: "g" }, "2026-11-18")).toBe("comprato ieri, 250 g");
  });
});

describe("confronto con la lista", () => {
  it("riassume in una riga ciò che manca e ciò che è entrato in più", () => {
    expect(compareSummary({ waiting: true, missing: [], extra: [] })).toBe("nessun acquisto registrato");
    expect(compareSummary({ waiting: false, missing: ["a", "b"], extra: [] })).toBe("2 non comprate");
    expect(compareSummary({ waiting: false, missing: ["a"], extra: ["c"] })).toBe("1 non comprata · 1 fuori lista");
    expect(compareSummary({ waiting: false, missing: [], extra: [] })).toBe("tutto come in lista");
  });
});

describe("campo «Aggiungi»", () => {
  it("la virgola separa le voci, ma non i decimali", () => {
    const r = readAddText("2 l latte, pane, mele 1,5 kg");
    expect(r.entries.map((e) => e.product)).toEqual(["Latte", "Pane", "Mele"]);
    expect(r.entries[0].quantity).toEqual({ value: 2000, unit: "ml" });
    expect(r.entries[2].quantity).toEqual({ value: 1500, unit: "g" });
    expect(r.rejected).toEqual([]);
  });

  it("l'avviso è quello del «+»", () => {
    expect(addedToListText(["pane"])).toBe("Aggiunto alla lista della spesa: pane.");
    expect(addedToListText(["latte", "pane"])).toBe("Aggiunti alla lista della spesa: latte, pane.");
  });
});
