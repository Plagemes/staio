import { describe, expect, it } from "vitest";
import {
  MAX_ENTRIES,
  MAX_STORES,
  RECEIPT_MEMORY_PREFIX,
  dropEntry,
  emptyRow,
  isStable,
  learnLine,
  lookupLine,
  memoryRowKey,
  normalizeLineKey,
  normalizeStoreKey,
  readRow,
  sameState,
  storesToForget,
  type LineState,
  type MemoryRow,
} from "./receiptMemory";

const NOW = "2026-11-17T09:00:00.000Z";

const proposed: LineState = { name: "Latte ps", category: "milk_uht", quantity: "1 pz", location: "frigo", ignore: false };
const milk: LineState = { name: "Latte parzialmente scremato", category: "milk_uht", quantity: "1 l", location: "dispensa", ignore: false };

const KEY = normalizeLineKey("LATTE PS 1L");
const learn = (row: MemoryRow, final: LineState, key = KEY, at = NOW) => learnLine(row, { key, final, proposed, now: at });

describe("normalizeLineKey", () => {
  it("toglie maiuscole, punteggiatura e spazi in più", () => {
    expect(normalizeLineKey("  LATTE   P.S.  1L ")).toBe(KEY);
    expect(normalizeLineKey("MOZZ. BUF. 125")).toBe("mozz buf 125");
    expect(normalizeLineKey("Mozz-Buf *125*")).toBe("mozz buf 125");
  });

  it("il formato della confezione fa parte della chiave, anche con decimale e con o senza spazio", () => {
    expect(normalizeLineKey("LATTE PS 1 L")).toBe(KEY);
    expect(normalizeLineKey("MOZZ BUF 125")).toBe("mozz buf 125");
    expect(normalizeLineKey("LATTE PS 0,5 L")).not.toBe(normalizeLineKey("LATTE PS 1,5 L"));
    expect(normalizeLineKey("LATTE PS 0,5 L")).not.toBe(normalizeLineKey("LATTE PS 1 L"));
    expect(normalizeLineKey("ACQUA NAT 1,5 LT")).not.toBe(normalizeLineKey("ACQUA NAT 0,5 LT"));
    expect(normalizeLineKey("PASTA 0,5 KG")).not.toBe(normalizeLineKey("PASTA 1 KG"));
    expect(normalizeLineKey("PASTA 0,5 KG")).not.toBe(normalizeLineKey("PASTA"));
    expect(normalizeLineKey("LATTE PS 1L")).not.toBe(normalizeLineKey("LATTE PS 500ML"));
  });

  it("lo stesso formato scritto in modi diversi dà la stessa chiave", () => {
    const keys = ["LATTE PS 0,5 L", "latte ps 0.5l", "LATTE PS 500 ML", "latte ps 50cl", "LATTE PS 0,5 LT"].map((r) => normalizeLineKey(r));
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toContain("500ml");
    expect(normalizeLineKey("PASTA 0,5 KG")).toBe(normalizeLineKey("PASTA 500 G"));
    // 1 l e 1000 ml sono davvero la stessa quantità
    expect(normalizeLineKey("LATTE PS 1L")).toBe(normalizeLineKey("LATTE PS 1000ML"));
  });

  it("toglie solo ciò che è davvero variabile: prezzi, peso con prezzo al chilo, quantità moltiplicate", () => {
    expect(normalizeLineKey("BANANE 0,834 KG x 2,49 EUR/KG")).toBe("banane");
    expect(normalizeLineKey("BANANE 0,532 KG x 1,99 €/KG")).toBe("banane");
    expect(normalizeLineKey("BANANE 0,832 KG 2,49 EUR/KG")).toBe("banane");
    expect(normalizeLineKey("2 x 1,29 YOGURT")).toBe("yogurt");
    expect(normalizeLineKey("YOGURT 1,29 €")).toBe("yogurt");
    expect(normalizeLineKey("YOGURT 1.29")).toBe(normalizeLineKey("YOGURT 2,19"));
    expect(normalizeLineKey("LATTE PS 1,5 L 1,29")).toBe(normalizeLineKey("LATTE PS 1,5 L 1,35"));
  });

  it("nel dubbio la chiave resta distinta: un peso senza prezzo al chilo non si toglie", () => {
    expect(normalizeLineKey("BANANE 0,532 kg")).not.toBe(normalizeLineKey("BANANE 0,834 kg"));
  });

  it("ignora gli accenti e usa il nome letto se la riga manca", () => {
    expect(normalizeLineKey("CAFFÈ MISCELA")).toBe(normalizeLineKey("caffe miscela"));
    expect(normalizeLineKey("", "Latte UHT")).toBe("latte uht");
    expect(normalizeLineKey("  ", "")).toBe("");
  });
});

describe("normalizeStoreKey", () => {
  it("è lo stesso per maiuscole, punteggiatura e accenti", () => {
    expect(normalizeStoreKey("Esselunga")).toBe("esselunga");
    expect(normalizeStoreKey("  ESSELUNGA. ")).toBe("esselunga");
    expect(normalizeStoreKey("Coop Alleanza 3.0")).toBe("coop-alleanza");
  });

  it("vale la catena e non il punto vendita, e lascia fuori l'indirizzo", () => {
    expect(normalizeStoreKey("Esselunga · Via Roma 12")).toBe("esselunga");
    expect(normalizeStoreKey("Conad Via Garibaldi 4")).toBe("conad");
  });

  it("è vuoto se il negozio manca", () => {
    expect(normalizeStoreKey("")).toBe("");
    expect(normalizeStoreKey("   ")).toBe("");
  });
});

describe("chiave dell'archivio", () => {
  it("sta fuori da ai.*, così entra nella copia delle impostazioni", () => {
    expect(memoryRowKey("esselunga")).toBe("receipt.memory.esselunga");
    expect(memoryRowKey("").startsWith(RECEIPT_MEMORY_PREFIX)).toBe(true);
    expect(memoryRowKey("").startsWith("ai.")).toBe(false);
    expect(memoryRowKey("")).not.toBe(memoryRowKey("esselunga"));
  });
});

describe("learnLine", () => {
  it("ricorda una correzione", () => {
    const row = learn(emptyRow(), milk);
    expect(row.entries[KEY]).toMatchObject({ name: "Latte parzialmente scremato", quantity: "1 l", location: "dispensa", strikes: 0, ignore: false });
  });

  it("non ricorda una riga accettata com'era stata letta", () => {
    expect(learn(emptyRow(), proposed)).toEqual(emptyRow());
  });

  it("ricorda il collegamento a un prodotto anche senza altre correzioni", () => {
    const row = learn(emptyRow(), { ...proposed, barcode: "8076800195057" });
    expect(row.entries[KEY].barcode).toBe("8076800195057");
  });

  it("una correzione nuova sostituisce la vecchia", () => {
    let row = learn(emptyRow(), milk);
    row = learn(row, { ...milk, name: "Latte PS", quantity: "500 ml" });
    expect(Object.keys(row.entries)).toHaveLength(1);
    expect(row.entries[KEY]).toMatchObject({ name: "Latte PS", quantity: "500 ml", strikes: 1 });
    expect(isStable(row.entries[KEY])).toBe(true);
  });

  it("dopo due cambi di fila in modo diverso la riga non è più stabile", () => {
    let row = learn(emptyRow(), milk);
    row = learn(row, { ...milk, name: "Latte A" });
    row = learn(row, { ...milk, name: "Latte B" });
    expect(row.entries[KEY]).toMatchObject({ name: "Latte B", strikes: 2 });
    expect(isStable(row.entries[KEY])).toBe(false);
    // continua a restare instabile finché l'utente la cambia
    row = learn(row, { ...milk, name: "Latte C" });
    expect(row.entries[KEY].strikes).toBe(2);
  });

  it("riconfermare la riga la rende di nuovo stabile", () => {
    let row = learn(emptyRow(), milk);
    row = learn(row, { ...milk, name: "Latte A" });
    row = learn(row, { ...milk, name: "Latte B" });
    row = learn(row, { ...milk, name: "latte b" });
    expect(row.entries[KEY].strikes).toBe(0);
    expect(isStable(row.entries[KEY])).toBe(true);
  });

  it("segna «ignora sempre» e la riga ignorata si riconosce da sola", () => {
    const row = learnLine(emptyRow(), { key: "sacchetto bio", final: { ...proposed, name: "Sacchetto", ignore: true }, proposed, now: NOW });
    expect(row.entries["sacchetto bio"]).toMatchObject({ ignore: true, category: "", quantity: "", strikes: 0 });
    // l'utente la vuole una volta: è un cambio, non si applica più da sola dopo il secondo
    const wanted = learnLine(row, { key: "sacchetto bio", final: { ...proposed, name: "Sacchetto" }, proposed, now: NOW });
    expect(wanted.entries["sacchetto bio"]).toMatchObject({ ignore: false, strikes: 1 });
  });

  it("una chiave vuota non ricorda nulla", () => {
    expect(learn(emptyRow(), milk, "")).toEqual(emptyRow());
  });

  it("tiene al massimo MAX_ENTRIES righe, perdendo le più vecchie", () => {
    let row = emptyRow();
    for (let i = 0; i < MAX_ENTRIES + 5; i++) {
      row = learn(row, milk, `riga ${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, "0")}.${String(Math.floor(i / 60)).padStart(3, "0")}Z`);
    }
    expect(Object.keys(row.entries)).toHaveLength(MAX_ENTRIES);
  });
});

describe("lookupLine", () => {
  const row = learn(emptyRow(), milk);

  it("con il negozio noto applica da sola una riga stabile", () => {
    expect(lookupLine({ storeKey: "esselunga", row }, KEY)).toMatchObject({ source: "store", auto: true });
  });

  it("con il negozio noto una riga instabile è solo una proposta", () => {
    const shaky = learn(learn(learn(emptyRow(), milk), { ...milk, name: "A" }), { ...milk, name: "B" });
    expect(lookupLine({ storeKey: "esselunga", row: shaky }, KEY)).toMatchObject({ source: "store", auto: false });
  });

  it("senza negozio vale la memoria generale, solo come proposta", () => {
    expect(lookupLine({ storeKey: "", row }, KEY)).toMatchObject({ source: "general", auto: false });
  });

  it("non trova ciò che non c'è", () => {
    expect(lookupLine({ storeKey: "esselunga", row }, "pane")).toBeUndefined();
    expect(lookupLine({ storeKey: "esselunga", row }, "")).toBeUndefined();
  });
});

describe("readRow", () => {
  it("scarta ciò che non è valido (per esempio da un file importato)", () => {
    const row = readRow({
      version: 1,
      entries: {
        buona: { name: "Latte", category: "milk_uht", quantity: "1 l", location: "frigo", ignore: false, strikes: 1, at: NOW },
        ignorata: { name: "Sacchetto", ignore: true },
        senzaCategoria: { name: "Latte", category: "boh", quantity: "1 l", location: "frigo" },
        luogoStrano: { name: "Latte", category: "milk_uht", quantity: "1 l", location: "balcone" },
        rotta: 42,
      },
    });
    expect(Object.keys(row.entries).sort()).toEqual(["buona", "ignorata"]);
    expect(row.entries.buona.strikes).toBe(1);
  });

  it("restituisce una riga vuota per qualunque valore che non sia una riga", () => {
    for (const v of [undefined, null, 3, "x", [], { entries: [] }]) expect(readRow(v)).toEqual(emptyRow());
  });
});

describe("sameState", () => {
  it("ignora maiuscole e spazi nella quantità", () => {
    expect(sameState(milk, { ...milk, name: "latte PARZIALMENTE scremato", quantity: "1l" })).toBe(true);
    expect(sameState(milk, { ...milk, location: "frigo" })).toBe(false);
    expect(sameState(milk, { ...milk, barcode: "8076800195057" })).toBe(false);
  });
});

describe("chiavi che sembrano proprietà ereditate", () => {
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("la riga «%s» non trova nulla se non è stata ricordata", (key) => {
    const row = learn(emptyRow(), milk);
    expect(lookupLine({ storeKey: "esselunga", row }, key)).toBeUndefined();
    expect(learn(emptyRow(), proposed, key)).toEqual(emptyRow());
  });

  it("si possono ricordare e ritrovare come qualunque altra riga, senza toccare il prototipo", () => {
    for (const key of ["constructor", "__proto__"]) {
      const row = learn(emptyRow(), milk, key);
      expect(Object.hasOwn(row.entries, key)).toBe(true);
      expect(lookupLine({ storeKey: "esselunga", row }, key)).toMatchObject({ auto: true });
      expect(Object.getPrototypeOf(row.entries)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).name).toBeUndefined();
    }
  });

  it("una memoria letta dall'archivio con quelle chiavi resta sicura", () => {
    const entry = { name: "Latte", category: "milk_uht", quantity: "1 l", location: "frigo", ignore: false };
    const row = readRow(JSON.parse(`{"entries":{"__proto__":${JSON.stringify(entry)},"constructor":${JSON.stringify(entry)}}}`));
    expect(Object.getPrototypeOf(row.entries)).toBe(Object.prototype);
    expect(Object.keys(row.entries).sort()).toEqual(["__proto__", "constructor"]);
    expect(lookupLine({ storeKey: "x", row }, "toString")).toBeUndefined();
  });
});

describe("un prodotto collegato con un altro formato è solo una proposta", () => {
  const linked: LineState = { ...milk, barcode: "8001120974504" };
  const row = learnLine(emptyRow(), { key: KEY, final: linked, proposed, seen: "1l", now: NOW });

  it("con lo stesso formato letto si applica da solo", () => {
    expect(lookupLine({ storeKey: "esselunga", row }, KEY, "1l")).toMatchObject({ auto: true });
  });

  it("con un formato letto diverso si propone soltanto", () => {
    expect(lookupLine({ storeKey: "esselunga", row }, KEY, "500ml")).toMatchObject({ source: "store", auto: false });
  });

  it("senza quantità letta ora, o senza codice collegato, non cambia nulla", () => {
    expect(lookupLine({ storeKey: "esselunga", row }, KEY)).toMatchObject({ auto: true });
    const plain = learnLine(emptyRow(), { key: KEY, final: milk, proposed, seen: "1l", now: NOW });
    expect(lookupLine({ storeKey: "esselunga", row: plain }, KEY, "500ml")).toMatchObject({ auto: true });
  });
});

describe("«Non ignorarla più» e limite di negozi", () => {
  it("dropEntry toglie solo la voce indicata", () => {
    const row = learn(learn(emptyRow(), milk), milk, "altra riga");
    const next = dropEntry(row, KEY);
    expect(Object.keys(next.entries)).toEqual(["altra riga"]);
    expect(dropEntry(next, "non c'è")).toBe(next);
  });

  it("oltre MAX_STORES si dimentica il negozio usato meno di recente, mai quello appena usato", () => {
    const stores = Array.from({ length: MAX_STORES + 2 }, (_, i) => ({ storeKey: `negozio-${i}`, usedAt: `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z` }));
    expect(storesToForget(stores, "negozio-41")).toEqual(["negozio-0", "negozio-1"]);
    expect(storesToForget(stores, "negozio-0")).toEqual(["negozio-1", "negozio-2"]);
    expect(storesToForget(stores.slice(0, MAX_STORES), "negozio-3")).toEqual([]);
  });

  it("la riga aggiornata porta l'istante dell'ultimo uso", () => {
    expect(learn(emptyRow(), milk).usedAt).toBe(NOW);
  });
});
