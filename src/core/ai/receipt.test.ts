import { describe, expect, it } from "vitest";
import { SHELF_LIFE } from "@/core/expiry";
import {
  CATEGORY_HINTS,
  RECEIPT_CATEGORY_KEYS,
  buildReceiptRequest,
  checkReceiptTotals,
  parseReceiptResponse,
  readReceiptDate,
} from "./index";

/** Risposta realistica per uno scontrino di supermercato: abbreviazioni, peso variabile, sconto di riga, totale. */
const SUPERMARKET = {
  store: "ESSELUNGA VIA ROMA 12 MILANO",
  chain: "Esselunga",
  date: "2026-11-14",
  lines: [
    { raw: "LATTE UHT PS 1L", name: "Latte UHT parzialmente scremato", kind: "item", quantity: 1, unit: "l", priceCents: 129, isFood: true, category: "milk_uht" },
    { raw: "PROSC.COTTO AQ", name: "Prosciutto cotto alta qualità", kind: "item", quantity: null, unit: null, priceCents: 249, isFood: true, category: "cold_cuts_sliced" },
    { raw: "BANANE 0,532 kg x 1,99", name: "Banane", kind: "item", quantity: 0.532, unit: "kg", priceCents: 106, isFood: true, category: "fruit_fresh" },
    { raw: "MOZZ.BUFALA 125G", name: "Mozzarella di bufala", kind: "item", quantity: 125, unit: "g", priceCents: 189, isFood: true, category: "cheese_fresh" },
    { raw: "SCONTO 25%", name: "Sconto mozzarella", kind: "discount", quantity: null, unit: null, priceCents: -47, isFood: false, category: null },
    { raw: "SACCHETTO BIO", name: "Sacchetto", kind: "item", quantity: null, unit: null, priceCents: 10, isFood: false, category: null },
    { raw: "PASTA PENNE 500G", name: "Penne rigate", kind: "item", quantity: 500, unit: "g", priceCents: 89, isFood: true, category: "pasta_dry" },
  ],
  totalCents: 725,
};

describe("parseReceiptResponse: scontrino di supermercato", () => {
  const reading = parseReceiptResponse(JSON.stringify(SUPERMARKET));

  it("legge negozio, catena, data e totale", () => {
    expect(reading.store).toBe("ESSELUNGA VIA ROMA 12 MILANO");
    expect(reading.chain).toBe("Esselunga");
    expect(reading.date).toBe("2026-11-14");
    expect(reading.totalCents).toBe(725);
  });

  it("tiene le righe di articolo e aggancia lo sconto all'articolo che lo precede", () => {
    expect(reading.lines.map((l) => l.name)).toEqual([
      "Latte UHT parzialmente scremato",
      "Prosciutto cotto alta qualità",
      "Banane",
      "Mozzarella di bufala",
      "Sacchetto",
      "Penne rigate",
    ]);
    const mozzarella = reading.lines[3];
    expect(mozzarella.priceCents).toBe(142);
    expect(mozzarella.discountCents).toBe(47);
  });

  it("porta le quantità in unità di base", () => {
    expect(reading.lines[0].quantity).toEqual({ value: 1000, unit: "ml" });
    expect(reading.lines[1].quantity).toBeUndefined();
    expect(reading.lines[2].quantity).toEqual({ value: 532, unit: "g" });
    expect(reading.lines[3].quantity).toEqual({ value: 125, unit: "g" });
  });

  it("segna i non alimentari e tiene le categorie solo sugli alimenti", () => {
    expect(reading.lines[4].isFood).toBe(false);
    expect(reading.lines[4].category).toBeUndefined();
    expect(reading.lines[0].category).toBe("milk_uht");
  });

  it("il totale torna e non ci sono avvisi", () => {
    expect(checkReceiptTotals(reading)).toMatchObject({ status: "ok", sumCents: 725, differenceCents: 0 });
    expect(reading.problems.filter((p) => p.severity === "warning")).toEqual([]);
  });

  it("segnala un totale che non torna", () => {
    const wrong = parseReceiptResponse(JSON.stringify({ ...SUPERMARKET, totalCents: 800 }));
    expect(checkReceiptTotals(wrong)).toMatchObject({ status: "mismatch", differenceCents: -75 });
    expect(wrong.problems.map((p) => p.code)).toContain("total_mismatch");
    expect(wrong.lines).toHaveLength(6);
  });
});

describe("parseReceiptResponse: forme della risposta", () => {
  it("trova il JSON dentro un blocco di codice e dentro altro testo", () => {
    const text = `Ecco lo scontrino letto:\n\`\`\`json\n${JSON.stringify(SUPERMARKET)}\n\`\`\`\nSpero sia utile {grazie}.`;
    const reading = parseReceiptResponse(text);
    expect(reading.lines).toHaveLength(6);
    expect(reading.totalCents).toBe(725);
  });

  it("regge le graffe dentro le stringhe", () => {
    const reading = parseReceiptResponse(
      `Risultato: {"lines":[{"raw":"ARANCE {RETE} 1KG","name":"Arance","priceCents":199,"isFood":true,"category":"citrus"}],"totalCents":199}`,
    );
    expect(reading.lines[0].name).toBe("Arance");
    expect(reading.problems).toEqual([]);
  });

  it("legge numeri scritti con la virgola e booleani scritti a parole", () => {
    const reading = parseReceiptResponse(
      JSON.stringify({
        date: "14/11/2026",
        total: "2,15",
        lines: [{ raw: "UOVA 6", name: "Uova", quantity: "6", unit: "pz", price: "2,15", isFood: "true", category: "eggs" }],
      }),
    );
    expect(reading.date).toBe("2026-11-14");
    expect(reading.totalCents).toBe(215);
    expect(reading.lines[0]).toMatchObject({ priceCents: 215, quantity: { value: 6, unit: "pz" }, isFood: true, category: "eggs" });
    expect(checkReceiptTotals(reading).status).toBe("ok");
  });

  it("converte in euro un 'priceCents' scritto con i decimali", () => {
    const reading = parseReceiptResponse(JSON.stringify({ lines: [{ name: "Burro", priceCents: "1,79", isFood: true, category: "butter" }] }));
    expect(reading.lines[0].priceCents).toBe(179);
  });

  it("accetta un elenco di righe senza intestazione", () => {
    const reading = parseReceiptResponse(JSON.stringify(SUPERMARKET.lines));
    expect(reading.lines).toHaveLength(6);
    expect(reading.totalCents).toBeUndefined();
  });

  it("senza quantità né unità lascia la quantità vuota; con un numero senza unità conta pezzi", () => {
    const reading = parseReceiptResponse(
      JSON.stringify({ lines: [{ name: "Pane", priceCents: 100 }, { name: "Mele", quantity: 3, priceCents: 300 }] }),
    );
    expect(reading.lines[0].quantity).toBeUndefined();
    expect(reading.lines[1].quantity).toEqual({ value: 3, unit: "pz" });
  });

  it("recupera le righe complete da una risposta tagliata a metà", () => {
    const text =
      '{"store":"Coop","date":"2026-11-14","lines":[{"raw":"PANE","name":"Pane","priceCents":150,"isFood":true,"category":"bread_fresh"},{"raw":"LATT","name":"Lat';
    const reading = parseReceiptResponse(text, { truncated: true });
    expect(reading.lines.map((l) => l.name)).toEqual(["Pane"]);
    expect(reading.store).toBe("Coop");
    expect(reading.date).toBe("2026-11-14");
    expect(reading.problems.map((p) => p.code)).toEqual(expect.arrayContaining(["salvaged", "truncated"]));
  });

  it("segnala la risposta tagliata anche quando il JSON è completo", () => {
    const reading = parseReceiptResponse(JSON.stringify(SUPERMARKET), { truncated: true });
    expect(reading.problems.some((p) => p.code === "truncated" && p.severity === "warning")).toBe(true);
  });

  it.each([["", "no_json"], ["Non riesco a leggere la foto, è troppo sfocata.", "no_json"], ["{}", "no_json"], ['{"lines": []}', "no_lines"]])(
    "non lancia con %j",
    (text, code) => {
      const reading = parseReceiptResponse(text);
      expect(reading.lines).toEqual([]);
      expect(reading.problems.map((p) => p.code)).toContain(code);
    },
  );

  it("non lancia con ingressi che non sono testo", () => {
    expect(() => parseReceiptResponse(undefined as unknown as string)).not.toThrow();
    expect(() => parseReceiptResponse(null as unknown as string)).not.toThrow();
  });
});

describe("parseReceiptResponse: campi mancanti e righe strane", () => {
  it("usa il testo stampato se manca il nome, e salta le righe senza nulla", () => {
    const reading = parseReceiptResponse(
      JSON.stringify({ lines: [{ raw: "FUSILLI BAR", priceCents: 120, isFood: true }, { priceCents: 50 }, "stringa", 42, null] }),
    );
    expect(reading.lines.map((l) => l.name)).toEqual(["FUSILLI BAR"]);
    const codes = reading.problems.map((p) => p.code);
    expect(codes).toContain("name_from_raw");
    expect(codes.filter((c) => c === "line_skipped")).toHaveLength(4);
  });

  it("avvisa se manca il prezzo, ma tiene la riga", () => {
    const reading = parseReceiptResponse(JSON.stringify({ lines: [{ name: "Fragole", isFood: true, category: "berries" }], totalCents: 300 }));
    expect(reading.lines).toHaveLength(1);
    expect(reading.lines[0].priceCents).toBeUndefined();
    expect(reading.problems.map((p) => p.code)).toContain("missing_price");
    expect(checkReceiptTotals(reading)).toMatchObject({ status: "mismatch", linesWithoutPrice: 1 });
  });

  it("scarta una categoria che non esiste e un'unità sconosciuta, tenendo la riga", () => {
    const reading = parseReceiptResponse(
      JSON.stringify({ lines: [{ name: "Cosa", quantity: 2, unit: "barili", priceCents: 100, isFood: true, category: "spazzatura" }] }),
    );
    expect(reading.lines[0].category).toBeUndefined();
    expect(reading.lines[0].quantity).toBeUndefined();
    expect(reading.problems.map((p) => p.code)).toEqual(expect.arrayContaining(["unknown_category", "invalid_quantity"]));
  });

  it("ignora una categoria data a un non alimentare", () => {
    const reading = parseReceiptResponse(JSON.stringify({ lines: [{ name: "Detersivo", priceCents: 300, isFood: false, category: "beverages" }] }));
    expect(reading.lines[0].category).toBeUndefined();
  });

  it("senza isFood, un alimento è tale se ha una categoria", () => {
    const reading = parseReceiptResponse(
      JSON.stringify({ lines: [{ name: "Latte", priceCents: 100, category: "milk_fresh" }, { name: "Spugna", priceCents: 100 }] }),
    );
    expect(reading.lines.map((l) => l.isFood)).toEqual([true, false]);
  });

  it("ignora le righe che non sono articoli (totale, resto)", () => {
    const reading = parseReceiptResponse(
      JSON.stringify({ lines: [{ name: "Pane", priceCents: 100, isFood: true }, { name: "RESTO", kind: "other", priceCents: 500 }] }),
    );
    expect(reading.lines).toHaveLength(1);
    expect(reading.problems.some((p) => p.code === "line_skipped" && p.severity === "info")).toBe(true);
  });

  it("scarta una data impossibile e lo dice", () => {
    const reading = parseReceiptResponse(JSON.stringify({ date: "31/02/2026", lines: [{ name: "Pane", priceCents: 100, isFood: true }] }));
    expect(reading.date).toBeUndefined();
    expect(reading.problems.map((p) => p.code)).toContain("invalid_date");
  });
});

describe("sconti", () => {
  const withDiscounts = (lines: unknown[], totalCents: number) => parseReceiptResponse(JSON.stringify({ lines, totalCents }));

  it("riconosce lo sconto dal prezzo negativo anche senza kind", () => {
    const reading = withDiscounts(
      [{ name: "Yogurt", priceCents: 150, isFood: true, category: "yogurt" }, { raw: "PROMO 2X1", name: "Promo", priceCents: -50 }],
      100,
    );
    expect(reading.lines).toHaveLength(1);
    expect(reading.lines[0]).toMatchObject({ priceCents: 100, discountCents: 50 });
    expect(checkReceiptTotals(reading).status).toBe("ok");
  });

  it("riconosce lo sconto scritto 'SCONTO' con importo positivo", () => {
    const reading = withDiscounts(
      [{ name: "Tonno", priceCents: 300, isFood: true, category: "canned_closed" }, { raw: "SCONTO", name: "Sconto", priceCents: 60 }],
      240,
    );
    expect(reading.lines[0].priceCents).toBe(240);
  });

  it("tiene da parte lo sconto sul totale e il controllo lo considera", () => {
    const reading = withDiscounts(
      [
        { name: "Pane", priceCents: 200, isFood: true, category: "bread_fresh" },
        { name: "Latte", priceCents: 150, isFood: true, category: "milk_fresh" },
        { raw: "SCONTO FEDELTA'", name: "Sconto fedeltà", kind: "discount", priceCents: -100 },
      ],
      250,
    );
    expect(reading.unattachedDiscountsCents).toBe(100);
    expect(reading.lines.map((l) => l.priceCents)).toEqual([200, 150]);
    expect(checkReceiptTotals(reading)).toMatchObject({ status: "ok", sumCents: 350, generalDiscountsCents: 100 });
  });

  it("uno sconto all'inizio, senza articolo, non si aggancia a niente", () => {
    const reading = withDiscounts([{ name: "Sconto", kind: "discount", priceCents: -20 }, { name: "Pane", priceCents: 100, isFood: true }], 80);
    expect(reading.unattachedDiscountsCents).toBe(20);
    expect(reading.lines[0].discountCents).toBe(0);
    expect(checkReceiptTotals(reading).status).toBe("ok");
  });

  it("avvisa se lo sconto supera il prezzo dell'articolo", () => {
    const reading = withDiscounts([{ name: "Pane", priceCents: 100, isFood: true }, { name: "Sconto", kind: "discount", priceCents: -250 }], 0);
    expect(reading.lines[0].priceCents).toBe(0);
    expect(reading.problems.map((p) => p.code)).toContain("discount_exceeds");
  });

  it("più sconti sulla stessa riga si sommano", () => {
    const reading = withDiscounts(
      [{ name: "Caffè", priceCents: 500, isFood: true, category: "beverages" }, { name: "Sconto", kind: "discount", priceCents: -100 }, { name: "Sconto", kind: "discount", priceCents: -50 }],
      350,
    );
    expect(reading.lines[0]).toMatchObject({ priceCents: 350, discountCents: 150 });
  });
});

describe("checkReceiptTotals", () => {
  const base = { lines: [], unattachedDiscountsCents: 0 };
  it("senza righe", () => expect(checkReceiptTotals({ ...base, totalCents: 100 }).status).toBe("no_lines"));
  it("senza totale", () => {
    const reading = parseReceiptResponse(JSON.stringify({ lines: [{ name: "Pane", priceCents: 100, isFood: true }] }));
    expect(checkReceiptTotals(reading).status).toBe("no_total");
  });
  it("ammette un arrotondamento di pochi centesimi", () => {
    const reading = parseReceiptResponse(JSON.stringify({ lines: [{ name: "Pane", priceCents: 100, isFood: true }], totalCents: 101 }));
    expect(checkReceiptTotals(reading).status).toBe("ok");
    expect(checkReceiptTotals(reading, 0).status).toBe("mismatch");
  });
});

describe("readReceiptDate", () => {
  it.each([
    ["2026-11-14", "2026-11-14"],
    ["14/11/2026", "2026-11-14"],
    ["14-11-26", "2026-11-14"],
    ["14.11.2026", "2026-11-14"],
    ["2026-11-14T10:30:00", "2026-11-14"],
    ["29/02/2028", "2028-02-29"],
  ])("%s", (input, expected) => expect(readReceiptDate(input)).toBe(expected));
  it.each(["31/02/2026", "ieri", "2026-13-01", ""])("scarta %j", (input) => expect(readReceiptDate(input)).toBeUndefined());
});

describe("buildReceiptRequest", () => {
  const image = { mediaType: "image/jpeg" as const, dataBase64: "AAAA" };

  it("elenca tutte le categorie del motore delle scadenze, e solo quelle", () => {
    expect([...RECEIPT_CATEGORY_KEYS].sort()).toEqual(Object.keys(SHELF_LIFE).sort());
    expect(Object.keys(CATEGORY_HINTS)).toHaveLength(Object.keys(SHELF_LIFE).length);
    const { instructions } = buildReceiptRequest({ images: [image] });
    for (const key of Object.keys(SHELF_LIFE)) expect(instructions).toContain(`- ${key}:`);
  });

  it("chiede solo JSON e descrive i campi richiesti", () => {
    const { instructions } = buildReceiptRequest({ images: [image] });
    expect(instructions).toContain("SOLO con un oggetto JSON");
    for (const field of ["store", "chain", "date", "raw", "name", "quantity", "unit", "priceCents", "isFood", "category", "totalCents"]) {
      expect(instructions).toContain(`"${field}"`);
    }
    expect(instructions).toContain("NEGATIVO");
  });

  it("passa le immagini, la data di oggi e un limite di risposta", () => {
    const request = buildReceiptRequest({ images: [image], today: "2026-11-17" });
    expect(request.images).toEqual([image]);
    expect(request.text).toContain("2026-11-17");
    expect(request.maxOutputTokens).toBeGreaterThan(1000);
    expect(buildReceiptRequest({ images: [image], maxOutputTokens: 123 }).maxOutputTokens).toBe(123);
  });

  /** Impronta del testo: un carattere cambiato la cambia. */
  const fingerprint = (s: string) => {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 33) ^ s.charCodeAt(i)) >>> 0;
    return `${s.length}:${h.toString(16)}`;
  };

  it("con una foto la richiesta è identica a quella di prima delle foto multiple", () => {
    const request = buildReceiptRequest({ images: [image], today: "2026-11-17" });
    expect(request.text).toBe("Ecco la foto dello scontrino. Oggi è 2026-11-17. Rispondi solo con il JSON.");
    expect(fingerprint(request.instructions)).toBe("4509:489f429");
    expect(request.instructions).not.toMatch(/parti dello stesso scontrino/);
    expect(buildReceiptRequest({ images: [image] }).text).toBe("Ecco la foto dello scontrino. Rispondi solo con il JSON.");
  });

  it("con più foto dice che sono parti dello stesso scontrino, in ordine, e che le righe ripetute nella sovrapposizione valgono una volta", () => {
    const images = [image, { ...image, dataBase64: "BBBB" }, { ...image, dataBase64: "CCCC" }];
    const request = buildReceiptRequest({ images, today: "2026-11-17" });
    expect(request.images).toEqual(images);
    for (const text of [request.instructions, request.text]) {
      expect(text).toMatch(/parti dello stesso scontrino/);
      expect(text).toMatch(/una volta sola/);
    }
    expect(request.text).toContain("3 foto");
    expect(request.text).toContain("2026-11-17");
    expect(request.instructions.startsWith(buildReceiptRequest({ images: [image] }).instructions)).toBe(true);
  });
});
