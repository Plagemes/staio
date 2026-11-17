import { describe, expect, it } from "vitest";
import { formatPrice } from "../format";
import { detailsSummary, type DetailsSummaryInput } from "./summary";

const base: DetailsSummaryInput = {
  categoryLabel: "Latte fresco",
  categoryChosen: false,
  expiryKind: null,
  datesSplit: false,
  priceText: "",
  alreadyHave: false,
  nutrition: false,
};

describe("detailsSummary", () => {
  it("categoria proposta e prezzo mancante", () => {
    expect(detailsSummary(base)).toBe("Latte fresco (proposta) · senza prezzo");
  });

  it("la categoria scelta dall'utente non è una proposta", () => {
    expect(detailsSummary({ ...base, categoryChosen: true })).toBe("Latte fresco · senza prezzo");
  });

  it("dice solo ciò che è stato riempito", () => {
    const text = detailsSummary({
      ...base,
      categoryLabel: "Pane fresco",
      categoryChosen: true,
      pieces: { count: 2, each: 100, unit: "g" },
      priceText: "1,29",
      alreadyHave: true,
    });
    expect(text).toBe(`Pane fresco · 2 pezzi da 100 g · ${formatPrice(129)} · ce l'avevo già`);
  });

  it("senza «ce l'avevo già» il prezzo scritto si legge in euro", () => {
    expect(detailsSummary({ ...base, priceText: "3,5" })).toBe(`Latte fresco (proposta) · ${formatPrice(350)}`);
  });

  it("con «ce l'avevo già» il prezzo non c'è e non si dice che manca", () => {
    expect(detailsSummary({ ...base, alreadyHave: true })).toBe("Latte fresco (proposta) · ce l'avevo già");
  });

  it("il tipo di data compare solo se scelto", () => {
    expect(detailsSummary({ ...base, expiryKind: "best_before" })).toBe("Latte fresco (proposta) · preferibilmente entro · senza prezzo");
  });

  it("i pezzi hanno il loro nome, al plurale", () => {
    expect(detailsSummary({ ...base, pieces: { count: 4, each: 50, unit: "g", name: "piadina" } })).toContain("4 piadine da 50 g");
    expect(detailsSummary({ ...base, pieces: { count: 3, each: 1, unit: "pz", name: "pezzo" } })).toContain("3 pezzi da");
  });

  it("date diverse e valori nutrizionali", () => {
    expect(detailsSummary({ ...base, datesSplit: true, nutrition: true })).toBe("Latte fresco (proposta) · date diverse · senza prezzo · con valori nutrizionali");
  });

  it("senza categoria in vista il riepilogo parte dal resto", () => {
    expect(detailsSummary({ ...base, categoryLabel: undefined })).toBe("senza prezzo");
  });

  it("un prezzo scritto male si mostra com'è: l'errore lo dice il campo", () => {
    expect(detailsSummary({ ...base, priceText: "tre euro" })).toBe("Latte fresco (proposta) · tre euro");
  });
});
