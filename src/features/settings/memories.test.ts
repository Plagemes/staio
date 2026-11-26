import { describe, expect, it } from "vitest";
import {
  FORGOT_ALL_TEXT,
  MEMORIES,
  NOT_MEMORIES,
  countText,
  entriesIn,
  forgotText,
  isProtectedKey,
  keysOf,
  listMemories,
  memoryKeys,
  mergeForUndo,
  totalEntries,
} from "./memories";

const memory = (id: string) => MEMORIES.find((m) => m.id === id)!;

describe("catalogo", () => {
  it("le dodici memorie dell'elenco, con la loro frase", () => {
    expect(MEMORIES.map((m) => m.id)).toEqual(["items", "portions", "barcodes", "receipts", "zones", "foods", "drinks", "quickAdd", "kept", "briefing", "shopping", "stores"]);
    for (const m of MEMORIES) {
      expect(m.label.length, m.id).toBeGreaterThan(0);
      expect(m.hint.endsWith("."), m.id).toBe(true);
      expect(m.keys.length + m.prefixes.length, m.id).toBeGreaterThan(0);
    }
  });

  it("nessuna chiave sta in due memorie", () => {
    const exact = MEMORIES.flatMap((m) => m.keys);
    expect(new Set(exact).size).toBe(exact.length);
    const prefixes = MEMORIES.flatMap((m) => m.prefixes);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const m of MEMORIES) for (const key of m.keys) for (const other of MEMORIES) if (other !== m) expect(other.prefixes.some((p) => key.startsWith(p)), key).toBe(false);
    for (const p of prefixes) {
      for (const q of prefixes) if (p !== q) expect(p.startsWith(q), `${p} / ${q}`).toBe(false);
      for (const key of exact) expect(key.startsWith(p), `${key} / ${p}`).toBe(false);
    }
  });

  it("nessuna chiave dell'elenco «non sono memorie» entra in una memoria", () => {
    for (const key of NOT_MEMORIES.keys) {
      expect(isProtectedKey(key), key).toBe(true);
      for (const m of MEMORIES) {
        expect(m.keys.includes(key), `${m.id}: ${key}`).toBe(false);
        expect(
          m.prefixes.some((p) => key.startsWith(p)),
          `${m.id}: ${key}`,
        ).toBe(false);
      }
    }
    for (const p of NOT_MEMORIES.prefixes) {
      for (const m of MEMORIES) {
        for (const key of m.keys) expect(key.startsWith(p), `${m.id}: ${key}`).toBe(false);
        for (const prefix of m.prefixes) expect(prefix.startsWith(p) || p.startsWith(prefix), `${m.id}: ${prefix}`).toBe(false);
      }
    }
  });

  it("la cucina in corso e la bozza dello scontrino non sono memorie, né le dichiarazioni, né le chiavi segrete", () => {
    const all = [
      "recipes.cookSession",
      "receipt.draft",
      "recipes.prefs",
      "diet.mergedNoticeSeen",
      "ai.settings",
      "video.service",
      "nutritionProfile",
      "shopping.manual",
      "shopping.stock",
      "shopping.budget",
      "deviceId",
    ];
    expect(memoryKeys(all)).toEqual([]);
    for (const key of all) expect(isProtectedKey(key), key).toBe(true);
  });
});

describe("chiavi di una memoria", () => {
  const all = ["portions.v1", "barcode.choice.800123", "barcode.choice.800456", "barcode.category.en:milk", "receipt.memory.coop", "receipt.memory._", "recipes.prefs", "theme"];

  it("esatte e per prefisso", () => {
    expect(keysOf(memory("portions"), all)).toEqual(["portions.v1"]);
    expect(keysOf(memory("barcodes"), all)).toEqual(["barcode.choice.800123", "barcode.choice.800456", "barcode.category.en:milk"]);
    expect(keysOf(memory("receipts"), all)).toEqual(["receipt.memory.coop", "receipt.memory._"]);
  });

  it("una chiave protetta non esce mai, nemmeno se il catalogo la includesse", () => {
    const risky = { id: "x", label: "x", hint: "x", keys: ["recipes.prefs", "ai.settings"], prefixes: ["video.", "diet."] };
    expect(keysOf(risky, ["recipes.prefs", "ai.settings", "video.service", "diet.mergedNoticeSeen"])).toEqual([]);
  });

  it("tutte le chiavi che sono memorie, e nient'altro", () => {
    expect(memoryKeys(all)).toEqual(["portions.v1", "barcode.choice.800123", "barcode.choice.800456", "barcode.category.en:milk", "receipt.memory.coop", "receipt.memory._"]);
  });
});

describe("conteggi", () => {
  it("voci di un valore", () => {
    expect(entriesIn(undefined)).toBe(0);
    expect(entriesIn(null)).toBe(0);
    expect(entriesIn([])).toBe(0);
    expect(entriesIn({})).toBe(0);
    expect(entriesIn(["a", "b"])).toBe(2);
    expect(entriesIn({ a: 1, b: 2, c: 3 })).toBe(3);
    expect(entriesIn("bought")).toBe(1);
    expect(entriesIn("")).toBe(0);
  });

  it("elenca solo le memorie con almeno una voce, nell'ordine del catalogo", () => {
    const rows = [
      { key: "portions.v1", value: { latte: {}, pane: {}, uova: {} } },
      { key: "itemDefaults.v1", value: { latte: {} } },
      { key: "quickAdd.mode", value: "bought" },
      { key: "briefing.dismissed", value: [] },
      { key: "recipes.prefs", value: { allergens: ["latte"] } },
    ];
    const list = listMemories(rows);
    expect(list.map((m) => [m.id, m.count])).toEqual([
      ["items", 1],
      ["portions", 3],
      ["quickAdd", 1],
    ]);
    expect(list[1].keys).toEqual(["portions.v1"]);
    expect(totalEntries(list)).toBe(5);
  });

  it("un prefisso conta una voce per chiave: 200 codici sono 200 voci", () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({ key: `barcode.choice.${i}`, value: { category: "x" } }));
    const [barcodes] = listMemories(rows);
    expect(barcodes).toMatchObject({ id: "barcodes", count: 200 });
    expect(barcodes.keys).toHaveLength(200);
  });

  it("le scelte della spesa contano tutte le voci dei tre elenchi, più i rifiuti", () => {
    const rows = [
      { key: "shopping.decisions", value: { confirmed: { a: true, b: true }, quantities: { a: 2 }, dismissed: { c: "2026-11-10" } } },
      { key: "shopping.rejections", value: { entries: [{ id: "1" }, { id: "2" }] } },
      { key: "shopping.manual", value: [{ id: "a" }] },
      { key: "shopping.stock", value: { minimums: [{ id: "a" }] } },
    ];
    expect(listMemories(rows).map((m) => [m.id, m.count])).toEqual([["shopping", 6]]);
  });

  it("una chiave con prefisso che non ha niente dentro non conta", () => {
    expect(listMemories([{ key: "drinkProduct.tea", value: "" }])).toEqual([]);
    expect(
      listMemories([
        { key: "drinkProduct.tea", value: "Tè verde" },
        { key: "drinkProduct.coffee", value: "Moka" },
      ])[0].count,
    ).toBe(2);
  });

  it("i dati dell'utente non entrano mai", () => {
    const rows = [
      { key: "shopping.manual", value: [1, 2] },
      { key: "shopping.stock", value: { minimums: [1] } },
      { key: "shopping.budget", value: 5000 },
      { key: "nutritionProfile", value: { sex: "female" } },
      { key: "recipes.prefs", value: { allergens: ["latte"] } },
      { key: "recipes.cookSession", value: { step: 3 } },
      { key: "receipt.draft", value: { lines: [1] } },
    ];
    expect(listMemories(rows)).toEqual([]);
  });
});

describe("testi", () => {
  it("quante voci", () => {
    expect(countText(1)).toBe("1 scelta");
    expect(countText(312)).toBe("312 voci");
    expect(countText(2)).toBe("2 voci");
  });
  it("avvisi", () => {
    expect(forgotText("Porzioni abituali")).toBe("Dimenticato: porzioni abituali.");
    expect(forgotText("Ultima scelta in «Più alimenti»")).toBe("Dimenticato: ultima scelta in «Più alimenti».");
    expect(FORGOT_ALL_TEXT).toBe("Dimenticate tutte le memorie.");
  });
});

describe("Annulla", () => {
  it("la chiave non c'è più: torna com'era", () => {
    expect(mergeForUndo({ a: 1 }, undefined)).toEqual({ a: 1 });
  });
  it("riscritta nel frattempo: si uniscono gli oggetti, vince il nuovo", () => {
    expect(mergeForUndo({ a: 1, b: 2 }, { b: 9, c: 3 })).toEqual({ a: 1, b: 9, c: 3 });
  });
  it("valori non uniscibili: resta il nuovo", () => {
    expect(mergeForUndo(["a"], ["b"])).toEqual(["b"]);
    expect(mergeForUndo("bought", "had")).toBe("had");
  });
});
