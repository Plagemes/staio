import { describe, expect, it } from "vitest";
import { parseReceiptResponse } from "@/core/ai";
import { buildReceiptEvents, toReviewLines, type ReviewLine } from "./receiptEvents";
import { applyMemory } from "./receiptLearning";
import { doubtText, doubtsOf, expiryNote, lineDetails, reviewLayout, reviewStatus } from "./receiptReview";
import { FOOD_CATEGORY_LABELS } from "../labels";
import { emptyRow, learnLine } from "@/core/ai/receiptMemory";

const read = toReviewLines(
  parseReceiptResponse(
    JSON.stringify({
      lines: [
        { raw: "LATTE INTERO 1L", name: "Latte intero", quantity: 1, unit: "l", priceCents: 129, isFood: true, category: "milk_fresh" },
        { raw: "PROSC.COTTO AQ", name: "Prosciutto cotto", priceCents: 249, isFood: true, category: "cold_cuts_sliced" },
        { raw: "PASTA 500G", name: "Pasta", quantity: 500, unit: "g", priceCents: 99, isFood: true, category: "pasta_dry" },
        { raw: "SACCHETTO BIO", name: "Sacchetto", priceCents: 10, isFood: false },
        { raw: "ROBA STRANA", name: "Roba strana", quantity: 2, unit: "pz", priceCents: 99, isFood: true },
      ],
    }),
  ),
);
// righe la cui categoria è già stata guardata: qui interessano gli altri dubbi
const lines: ReviewLine[] = read.map((l) => ({ ...l, categoryChecked: true as const }));
const byKey = (key: string): ReviewLine => {
  const line = lines.find((l) => l.key === key);
  if (!line) throw new Error(key);
  return line;
};
const latte = byKey("line-0");
const prosciutto = byKey("line-1");
const pasta = byKey("line-2");
const sacchetto = byKey("line-3");
const strana = byKey("line-4");

const memoryEntry = { name: "Latte fresco", category: "milk_fresh", quantity: "500 ml", location: "frigo" as const, ignore: false, strikes: 0, at: "2026-11-01T10:00:00.000Z" };

describe("doubtsOf", () => {
  it("una riga a posto non ha dubbi", () => {
    expect(doubtsOf(latte)).toEqual([]);
    expect(doubtsOf(pasta)).toEqual([]);
  });

  it("quantità proposta", () => {
    expect(doubtsOf(prosciutto)).toEqual(["quantity_guessed"]);
    // scritta la quantità vera, il dubbio sparisce
    expect(doubtsOf({ ...prosciutto, quantityText: "120 g", quantityGuessed: false, touched: true })).toEqual([]);
  });

  it("categoria da scegliere", () => {
    expect(doubtsOf(strana)).toEqual(["no_category"]);
    expect(doubtsOf({ ...strana, category: "snacks_dry" })).toEqual([]);
  });

  it("la memoria propone e non ha applicato da sola", () => {
    const proposed: ReviewLine = { ...latte, remembered: { source: "store", applied: false, entry: memoryEntry } };
    expect(doubtsOf(proposed)).toEqual(["remembered_differs"]);
    // applicata da sola («come l'ultima volta»): a posto
    expect(doubtsOf({ ...latte, remembered: { source: "store", applied: true, entry: memoryEntry } })).toEqual([]);
    // toccata dall'utente: la scelta è sua
    expect(doubtsOf({ ...proposed, touched: true })).toEqual([]);
  });

  it("non alimentare incluso a mano", () => {
    expect(doubtsOf({ ...sacchetto, include: true, category: "snacks_dry", quantityGuessed: false })).toEqual(["not_food_included"]);
  });

  it("errore dopo un tentativo di salvataggio, in cima agli altri", () => {
    expect(doubtsOf(prosciutto, "Non capisco la quantità.")).toEqual(["error", "quantity_guessed"]);
    expect(doubtsOf(latte, "")).toEqual([]);
  });

  it("una riga esclusa non ha dubbi", () => {
    expect(doubtsOf(sacchetto)).toEqual([]);
    expect(doubtsOf({ ...strana, include: false }, "errore")).toEqual([]);
  });
});

describe("doubtText", () => {
  it("dice il dubbio in una riga", () => {
    expect(doubtText("quantity_guessed")).toBe("Quantità non letta: ho messo 1.");
    expect(doubtText("no_category")).toBe("Categoria da scegliere.");
    expect(doubtText("remembered_differs")).toBe("L'ultima volta era diverso.");
    expect(doubtText("not_food_included")).toBe("Sembra non alimentare.");
    expect(doubtText("error", "Scrivi come si chiama l'alimento.")).toBe("Scrivi come si chiama l'alimento.");
  });
});

describe("reviewLayout", () => {
  it("le dubbie in cima, poi le altre nell'ordine dello scontrino; le escluse a parte", () => {
    expect(reviewLayout(lines)).toEqual({ order: ["line-1", "line-4", "line-0", "line-2"], excluded: ["line-3"] });
  });

  it("una riga con un errore è dubbia", () => {
    expect(reviewLayout(lines, { "line-2": "boh" }).order).toEqual(["line-1", "line-2", "line-4", "line-0"]);
  });

  it("senza dubbi resta l'ordine dello scontrino", () => {
    const fine = lines.filter((l) => doubtsOf(l).length === 0);
    expect(reviewLayout(fine)).toEqual({ order: ["line-0", "line-2"], excluded: ["line-3"] });
  });
});

describe("reviewStatus", () => {
  it("conta le righe incluse da controllare e quelle a posto", () => {
    expect(reviewStatus(lines)).toBe("2 righe da controllare, 2 a posto.");
    expect(reviewStatus([prosciutto, latte])).toBe("1 riga da controllare, 1 a posto.");
  });

  it("con zero dubbi", () => {
    expect(reviewStatus([latte, pasta, sacchetto])).toBe("2 righe, tutte a posto.");
    expect(reviewStatus([latte])).toBe("1 riga, a posto.");
  });

  it("nessuna riga scelta", () => {
    expect(reviewStatus([sacchetto])).toMatch(/Nessuna riga scelta/);
  });
});

describe("riga chiusa", () => {
  it("quantità, luogo e prezzo", () => {
    expect(lineDetails(latte)).toBe("Latte fresco · 1 l · Frigo · 1,29 €");
    expect(lineDetails(pasta)).toBe("Pasta secca · 500 g · Credenza · 0,99 €");
    expect(lineDetails(strana)).toBe("senza categoria · 2 pz · Frigo · 0,99 €");
    expect(lineDetails(sacchetto)).toBe("1 pz · non alimentare · 0,10 €");
  });

  it("la scadenza per i freschi, stimata o scelta", () => {
    const at = "2026-11-18T12:00:00.000Z";
    expect(expiryNote(prosciutto, at)).toMatch(/^entro il \d+ nov, stima$/);
    expect(expiryNote({ ...prosciutto, expiry: { date: "2026-11-21", via: "shortcut" } }, at)).toBe("entro il 21 nov, stima");
    expect(expiryNote({ ...prosciutto, expiry: { date: "2026-11-21", via: "label" } }, at)).toBe("entro il 21 nov");
    // anche ciò che non è un fresco dice la scadenza che avrà, con l'anno se non è quello dell'acquisto
    expect(expiryNote(pasta, at)).toMatch(/^entro il \d+ \w+ 20\d\d, stima$/);
    expect(expiryNote({ ...prosciutto, location: "freezer" }, at)).toMatch(/, stima$/);
    expect(expiryNote({ ...pasta, expiry: { date: "2027-03-01", via: "label" } }, at)).toBe("entro il 1 mar 2027");
    expect(expiryNote({ ...prosciutto, include: false }, at)).toBeUndefined();
    expect(expiryNote(strana, at)).toBeUndefined();
  });
});

describe("categoria dedotta: nessuna riga si salva con una categoria che non si è potuta leggere", () => {
  const mozzarella = toReviewLines(
    parseReceiptResponse(
      JSON.stringify({
        store: "Conad",
        lines: [
          { raw: "MOZZ. FIOR DI LATTE", name: "Mozzarella", quantity: 125, unit: "g", priceCents: 89, isFood: true, category: "cheese_aged" },
          { raw: "PASTA 500G", name: "Pasta", quantity: 500, unit: "g", priceCents: 99, isFood: true, category: "pasta_dry" },
        ],
      }),
    ),
  );
  const [mozz, dry] = mozzarella;

  it("una categoria dalla lettura per ciò che va in frigo è un dubbio, e la riga parte aperta in cima", () => {
    expect(mozz.location).toBe("frigo");
    expect(doubtsOf(mozz)).toEqual(["category_guessed"]);
    expect(doubtText("category_guessed", "Formaggi stagionati")).toBe("Categoria da controllare: Formaggi stagionati.");
    expect(reviewLayout(mozzarella).order[0]).toBe(mozz.key);
    // ciò che sta in credenza e dura a lungo no
    expect(doubtsOf(dry)).toEqual([]);
  });

  it("il dubbio sparisce con «Va bene», con una correzione, con la memoria del negozio o con un prodotto collegato", () => {
    expect(doubtsOf({ ...mozz, categoryChecked: true })).toEqual([]);
    expect(doubtsOf({ ...mozz, category: "cheese_fresh", touched: true })).toEqual([]);
    expect(doubtsOf({ ...mozz, barcode: "8001234567890" })).toEqual([]);
    const entry = { name: "Mozzarella", category: "cheese_fresh", quantity: "125 g", location: "frigo" as const, ignore: false, strikes: 0, at: "2026-11-01T10:00:00.000Z" };
    expect(doubtsOf({ ...mozz, remembered: { source: "store", applied: true, entry } })).toEqual([]);
    // la memoria generale (senza negozio) non basta
    expect(doubtsOf({ ...mozz, remembered: { source: "general", applied: true, entry } })).toEqual(["category_guessed"]);
  });

  it("ogni riga inclusa dice, chiusa, la categoria con cui verrà salvata", () => {
    const memory = { storeKey: "conad", row: learnLine(emptyRow(), { key: mozz.memoryKey ?? "", final: { name: "Mozzarella", category: "cheese_fresh", quantity: "125 g", location: "frigo", ignore: false }, now: "2026-11-01T10:00:00.000Z" }) };
    for (const variant of [mozzarella, mozzarella.map((l) => applyMemory(l, memory))]) {
      const result = buildReceiptEvents(variant, { store: "Conad", date: "" }, { now: "2026-11-18T10:00:00.000Z", deviceId: "d" });
      if (!result.ok) throw new Error("atteso ok");
      const included = variant.filter((l) => l.include);
      expect(result.events).toHaveLength(included.length);
      included.forEach((line, i) => {
        const category = result.events[i].category as keyof typeof FOOD_CATEGORY_LABELS;
        expect(lineDetails(line).startsWith(FOOD_CATEGORY_LABELS[category]), line.name).toBe(true);
        // ciò che si salva o si è letto chiuso, o è un dubbio a riga aperta
        if (!lineDetails(line).includes(FOOD_CATEGORY_LABELS[category])) expect(doubtsOf(line)).not.toEqual([]);
      });
    }
  });
});
