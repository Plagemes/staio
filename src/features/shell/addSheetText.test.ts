import { describe, expect, it } from "vitest";
import { drinkNoticeText, eatenHint, shoppingNoticeText, visitNoticeText } from "./addSheetText";

const at = (hours: number, minutes = 0) => hours * 60 + minutes;

describe("eatenHint", () => {
  it("dice il momento dell'ora", () => {
    expect(eatenHint(at(7, 30))).toBe("Registra colazione");
    expect(eatenHint(at(13))).toBe("Registra pranzo");
    expect(eatenHint(at(20, 15))).toBe("Registra cena");
  });

  it("alle 15:40 è uno spuntino", () => {
    expect(eatenHint(at(15, 40))).toBe("Registra uno spuntino");
  });

  it("di notte è uno spuntino", () => {
    expect(eatenHint(at(23, 30))).toBe("Registra uno spuntino");
    expect(eatenHint(at(2))).toBe("Registra uno spuntino");
  });
});

describe("shoppingNoticeText", () => {
  it("elenca le voci nell'ordine in cui sono state aggiunte", () => {
    expect(shoppingNoticeText(["latte", "pane"])).toBe("Aggiunto alla lista della spesa: latte, pane.");
  });

  it("una voce sola", () => {
    expect(shoppingNoticeText(["latte"])).toBe("Aggiunto alla lista della spesa: latte.");
  });

  it("la stessa voce scritta due volte si dice una volta", () => {
    expect(shoppingNoticeText(["latte", "Latte ", "pane"])).toBe("Aggiunto alla lista della spesa: latte, pane.");
  });
});

describe("visitNoticeText", () => {
  it("solo la spesa: l'avviso di sempre", () => {
    expect(visitNoticeText(["latte", "pane"])).toBe("Aggiunto alla lista della spesa: latte, pane.");
  });

  it("spesa e poi una bevanda nella stessa visita: un avviso solo che dice tutte e due le cose", () => {
    expect(visitNoticeText(["latte"], drinkNoticeText("Tè"))).toBe("Aggiunto alla lista della spesa: latte. Segnato: tè.");
    expect(visitNoticeText(["latte"], "Aggiunta acqua: 200 ml.")).toBe("Aggiunto alla lista della spesa: latte. Aggiunta acqua: 200 ml.");
  });
});

describe("drinkNoticeText", () => {
  it("dice la bevanda con l'iniziale minuscola", () => {
    expect(drinkNoticeText("Caffè espresso")).toBe("Segnato: caffè espresso.");
    expect(drinkNoticeText(" Tè ")).toBe("Segnato: tè.");
  });
});
