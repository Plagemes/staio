import { describe, expect, it } from "vitest";
import { formatPrice } from "../format";
import {
  addedText,
  barState,
  confirmedText,
  costsSummary,
  itemDetailLines,
  itemQuantityText,
  itemSubline,
  leftInField,
  notReadText,
  quantityChangedText,
  readEntries,
  removedText,
  splitEntries,
  toInputs,
} from "./listText";
import { mergeManualItems } from "./manual";
import { DISMISS_DAYS } from "./settings";

describe("seconda riga di una voce", () => {
  it("dice un solo motivo, il primo", () => {
    expect(itemSubline({ isManual: false, confirmed: false, reasons: ["finisce tra 2 giorni (stima dai tuoi consumi)", "serve per sabato"] })).toBe("finisce tra 2 giorni (stima dai tuoi consumi)");
  });

  it("una voce confermata lo dice dopo il motivo", () => {
    expect(itemSubline({ isManual: false, confirmed: true, reasons: ["sotto la scorta minima (ne hai 1 pz, il minimo è 6 pz)", "serve per sabato"] })).toBe(
      "sotto la scorta minima (ne hai 1 pz, il minimo è 6 pz) · confermata",
    );
  });

  it("una voce aggiunta da te dice solo questo, anche se è confermata", () => {
    expect(itemSubline({ isManual: true, confirmed: true, reasons: ["aggiunta da te", "finisce domani (stima dai tuoi consumi)"] })).toBe("aggiunta da te");
  });

  it("senza motivi: niente riga, o solo «confermata»", () => {
    expect(itemSubline({ isManual: false, confirmed: false, reasons: [] })).toBeNull();
    expect(itemSubline({ isManual: false, confirmed: true, reasons: [] })).toBe("confermata");
  });

  it("la quantità a destra", () => {
    expect(itemQuantityText({ quantity: 1000, unit: "ml" })).toBe("1 l");
    expect(itemQuantityText({ quantity: 6, unit: "pz" })).toBe("6 pz");
  });
});

describe("testa del foglio «Voce»", () => {
  const base = { changed: false, proposedQuantity: 1000, unit: "ml" as const, stockText: "In casa: 200 ml", costText: "circa 1,89 €", notes: [] as string[] };

  it("scorte e costo stimato, poi le note", () => {
    expect(itemDetailLines({ ...base, priceNote: "L'ultima volta 1,89 €/l.", forecastNote: "Non so quando finirà.", notes: ["Dura circa 6 giorni."] })).toEqual([
      "In casa: 200 ml. Costo stimato: circa 1,89 €.",
      "L'ultima volta 1,89 €/l.",
      "Non so quando finirà.",
      "Dura circa 6 giorni.",
    ]);
  });

  it("dice la proposta quando la quantità l'ha scelta l'utente", () => {
    expect(itemDetailLines({ ...base, changed: true })[0]).toBe("Proposta: 1 l. Hai scelto tu la quantità.");
  });
});

describe("riepilogo di «Costi e prezzi»", () => {
  it("con i prezzi del mese", () => {
    expect(costsSummary({ pricedCount: 4, totalCents: 21200, isMinimum: false })).toBe(`questo mese ${formatPrice(21200)}`);
  });

  it("con voci senza prezzo il totale è «almeno»", () => {
    expect(costsSummary({ pricedCount: 4, totalCents: 21200, isMinimum: true })).toBe(`questo mese almeno ${formatPrice(21200)}`);
  });

  it("senza prezzi", () => {
    expect(costsSummary({ pricedCount: 0, totalCents: 0, isMinimum: true })).toBe("nessun prezzo registrato");
    expect(costsSummary({ pricedCount: 0, totalCents: 0, isMinimum: false })).toBe("nessun prezzo registrato");
  });
});

describe("barra fissa", () => {
  it("con una lista: «Vado a fare la spesa», pieno", () => {
    expect(barState({ listCount: 3, tripOn: false, lastTripOn: true })).toEqual({ label: "Vado a fare la spesa", href: "/app/spesa/negozio", variant: "primary" });
  });

  it("con una spesa in corso: «Riprendi la spesa», anche con la lista vuota", () => {
    expect(barState({ listCount: 3, tripOn: true, lastTripOn: false })?.label).toBe("Riprendi la spesa");
    expect(barState({ listCount: 0, tripOn: true, lastTripOn: true })).toMatchObject({ label: "Riprendi la spesa", variant: "primary" });
  });

  it("lista vuota e un'ultima spesa: «Vedi l'ultima spesa», a contorno", () => {
    expect(barState({ listCount: 0, tripOn: false, lastTripOn: true })).toEqual({ label: "Vedi l'ultima spesa", href: "/app/spesa/negozio", variant: "outline" });
  });

  it("lista vuota e niente altro: nessuna barra", () => {
    expect(barState({ listCount: 0, tripOn: false, lastTripOn: false })).toBeNull();
  });
});

describe("il campo «Aggiungi alla spesa»", () => {
  it("separa con la virgola e con l'a capo", () => {
    expect(splitEntries("2 l latte, pane, 6 uova")).toEqual(["2 l latte", "pane", "6 uova"]);
    expect(splitEntries("2 l latte\npane\r\n6 uova")).toEqual(["2 l latte", "pane", "6 uova"]);
    expect(splitEntries("pane, uova\nlatte;burro")).toEqual(["pane", "uova", "latte", "burro"]);
  });

  it("una virgola tra due cifre è decimale e non separa", () => {
    expect(splitEntries("1,5 l latte, pane")).toEqual(["1,5 l latte", "pane"]);
  });

  it("scarta i pezzi vuoti", () => {
    expect(splitEntries(" , pane,, \n ")).toEqual(["pane"]);
    expect(splitEntries("")).toEqual([]);
  });

  it("tre voci in una riga", () => {
    const r = readEntries("2 l latte, pane, 6 uova");
    expect(r.items.map((i) => i.product)).toEqual(["Latte", "Pane", "Uova"]);
    expect(r.rejected).toEqual([]);
  });

  it("legge la quantità decimale", () => {
    expect(readEntries("1,5 l latte").items[0]).toMatchObject({ product: "Latte", quantity: { value: 1500, unit: "ml" } });
  });

  it("una voce senza quantità resta senza quantità", () => {
    const inputs = toInputs(readEntries("latte, 6 uova"));
    expect(inputs[0]).toEqual({ product: "Latte" });
    expect(inputs[1]).toMatchObject({ product: "Uova", quantity: { value: 6, unit: "pz" } });
    const list = mergeManualItems([], inputs, "2026-11-18T08:00:00.000Z", (() => {
      let n = 0;
      return () => `id${(n += 1)}`;
    })());
    expect(list.find((m) => m.product === "Latte")?.quantity).toBeUndefined();
  });

  it("la stessa voce aggiunta due volte non fa doppioni", () => {
    const ids = (() => {
      let n = 0;
      return () => `id${(n += 1)}`;
    })();
    const once = mergeManualItems([], toInputs(readEntries("6 uova, pane")), "2026-11-18T08:00:00.000Z", ids);
    const twice = mergeManualItems(once, toInputs(readEntries("6 uova, Pane")), "2026-11-18T09:00:00.000Z", ids);
    expect(twice).toHaveLength(2);
    expect(twice.find((m) => m.product === "Uova")?.quantity).toEqual({ value: 12, unit: "pz" });
  });

  it("ciò che non si legge resta nel campo", () => {
    const r = readEntries("pane, 12, 2 l latte");
    expect(r.items.map((i) => i.product)).toEqual(["Pane", "Latte"]);
    expect(r.rejected).toEqual(["12"]);
    expect(leftInField(r.rejected)).toBe("12");
    expect(notReadText(r.rejected)).toBe("Non ho capito: “12”. Scrivi il nome, o la quantità e il nome.");
  });
});

describe("avvisi", () => {
  it("aggiunta", () => {
    expect(addedText(["Latte", "Pane"])).toBe("Aggiunto alla lista della spesa: latte, pane.");
  });

  it("conferma e quantità", () => {
    expect(confirmedText("Latte", "1 l")).toBe("Confermato: latte, 1 l.");
    expect(quantityChangedText("Latte", "2 l")).toBe("Latte: 2 l.");
  });

  it("togli: una voce tua e una proposta", () => {
    expect(removedText("Latte", false)).toBe("Tolto dalla lista: latte.");
    expect(removedText("Latte", true)).toBe(`Tolto dalla lista: latte. Non lo propongo per ${DISMISS_DAYS} giorni.`);
  });
});
