import { describe, expect, it } from "vitest";
import { parseReceiptResponse } from "@/core/ai";
import { MAX_STORES, memoryRowKey, normalizeLineKey } from "@/core/ai/receiptMemory";
import { SECRET_PREFIX } from "@/data/settings";
import { buildReceiptEvents, toReviewLines, type ReviewLine } from "./receiptEvents";
import { applyMemory, reapplyMemory, rememberedCount, adoptRemembered } from "./receiptLearning";
import { forgetIgnore, forgetMemory, loadMemory, rememberReceipt, restoreMemory, type MemoryStore } from "./receiptMemoryStore";

const NOW = "2026-11-17T09:30:00.000Z";
const LATTE = normalizeLineKey("LATTE PS 1L");

function fakeStore(): MemoryStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get(k) {
      return data.get(k);
    },
    async set(k, v) {
      data.set(k, JSON.parse(JSON.stringify(v)));
    },
    async remove(k) {
      data.delete(k);
    },
    async keys(prefix) {
      return [...data.keys()].filter((k) => k.startsWith(prefix));
    },
  };
}

function receipt(store: string, price = 129): ReviewLine[] {
  const shown = (price / 100).toFixed(2).replace(".", ",");
  return toReviewLines(
    parseReceiptResponse(
      JSON.stringify({
        store,
        lines: [
          { raw: "LATTE PS 1L " + shown, name: "Latte PS", priceCents: price, isFood: true, category: "milk_fresh" },
          { raw: "MOZZ BUF 125", name: "Mozz buf", quantity: 1, unit: "pz", priceCents: 199, isFood: true, category: "cheese_fresh" },
          { raw: "SACCHETTO BIO", name: "Sacchetto", priceCents: 10, isFood: false },
        ],
        totalCents: 338,
      }),
    ),
  );
}

const edit = (lines: ReviewLine[], index: number, patch: Partial<ReviewLine>): ReviewLine[] =>
  lines.map((l, i) => (i === index ? { ...l, ...patch, touched: true } : l));

const corrected = (lines: ReviewLine[]): ReviewLine[] =>
  edit(
    edit(lines, 0, { name: "Latte parzialmente scremato", quantityText: "1 l", location: "dispensa", category: "milk_uht" }),
    1,
    { name: "Mozzarella di bufala", quantityText: "125 g" },
  );

const nextReceipt = async (store: MemoryStore, name: string, price?: number) => {
  const memory = await loadMemory(name, store);
  return receipt(name, price).map((l) => applyMemory(l, memory));
};

describe("la memoria per negozio", () => {
  it("la riga corretta arriva già compilata allo scontrino successivo dello stesso negozio, anche con un prezzo diverso", async () => {
    const store = fakeStore();
    await rememberReceipt("Esselunga", corrected(receipt("Esselunga")), NOW, store);

    const next = await nextReceipt(store, "ESSELUNGA ", 139);
    expect(next[0]).toMatchObject({ name: "Latte parzialmente scremato", quantityText: "1 l", location: "dispensa", category: "milk_uht", include: true });
    expect(next[0].remembered).toMatchObject({ source: "store", applied: true });
    expect(next[1]).toMatchObject({ name: "Mozzarella di bufala", quantityText: "125 g" });
    expect(rememberedCount(next)).toBe(2);
    // la riga non alimentare non era stata corretta: nulla di ricordato
    expect(next[2].remembered).toBeUndefined();
    expect(next[2].include).toBe(false);
  });

  it("una riga accettata com'era non si ricorda", async () => {
    const store = fakeStore();
    await rememberReceipt("Esselunga", receipt("Esselunga"), NOW, store);
    expect(store.data.size).toBe(0);
  });

  it("un altro negozio non la riceve", async () => {
    const store = fakeStore();
    await rememberReceipt("Esselunga", corrected(receipt("Esselunga")), NOW, store);
    const next = await nextReceipt(store, "Conad");
    expect(next[0].name).toBe("Latte PS");
    expect(next[0].remembered).toBeUndefined();
  });

  it("senza negozio vale la memoria generale, solo come proposta", async () => {
    const store = fakeStore();
    await rememberReceipt("", corrected(receipt("")), NOW, store);
    expect(store.data.has(memoryRowKey(""))).toBe(true);

    const next = await nextReceipt(store, "");
    expect(next[0].name).toBe("Latte PS");
    expect(next[0].remembered).toMatchObject({ source: "general", applied: false });
    expect(rememberedCount(next)).toBe(0);

    // un tocco su «Usa» e la riga diventa quella ricordata
    const used = adoptRemembered(next[0]);
    expect(used).toMatchObject({ name: "Latte parzialmente scremato", quantityText: "1 l", touched: true });
    // la memoria di un negozio non è stata toccata
    expect(store.data.has(memoryRowKey("esselunga"))).toBe(false);
  });

  it("una correzione nuova sostituisce la vecchia", async () => {
    const store = fakeStore();
    await rememberReceipt("Esselunga", corrected(receipt("Esselunga")), NOW, store);
    const second = await nextReceipt(store, "Esselunga");
    await rememberReceipt("Esselunga", edit(second, 0, { name: "Latte PS Granarolo" }), NOW, store);

    const row = (await loadMemory("Esselunga", store)).row;
    expect(row.entries[LATTE].name).toBe("Latte PS Granarolo");
    expect(Object.keys(row.entries)).toHaveLength(2);
  });

  it("una riga cambiata due volte di fila in modo diverso non si applica più da sola, ma si propone", async () => {
    const store = fakeStore();
    await rememberReceipt("Esselunga", corrected(receipt("Esselunga")), NOW, store);
    for (const name of ["Latte A", "Latte B"]) {
      const lines = await nextReceipt(store, "Esselunga");
      expect(lines[0].remembered?.applied).toBe(true);
      await rememberReceipt("Esselunga", edit(lines, 0, { name }), NOW, store);
    }
    const lines = await nextReceipt(store, "Esselunga");
    expect(lines[0].name).toBe("Latte PS");
    expect(lines[0].remembered).toMatchObject({ source: "store", applied: false });
    expect(lines[0].remembered?.entry.name).toBe("Latte B");

    // confermarla la rende di nuovo stabile
    await rememberReceipt("Esselunga", [adoptRemembered(lines[0])], NOW, store);
    const stable = await nextReceipt(store, "Esselunga");
    expect(stable[0].remembered?.applied).toBe(true);
    expect(stable[0].name).toBe("Latte B");
  });

  it("«ignora sempre» salta la riga da sola, e si può cambiare idea", async () => {
    const store = fakeStore();
    await rememberReceipt("Esselunga", edit(receipt("Esselunga"), 2, { include: false, ignoreAlways: true }), NOW, store);

    const next = await nextReceipt(store, "Esselunga");
    expect(next[2]).toMatchObject({ include: false, ignoreAlways: true });
    expect(next[2].remembered).toMatchObject({ applied: true });

    await rememberReceipt("Esselunga", edit(next, 2, { include: true, ignoreAlways: false, category: "bread_packaged", quantityText: "1 pz" }), NOW, store);
    const after = await nextReceipt(store, "Esselunga");
    expect(after[2].include).toBe(true);
    expect(after[2].ignoreAlways).toBe(false);
  });

  it("il collegamento a un prodotto si ricorda e porta il codice nell'acquisto", async () => {
    const store = fakeStore();
    const linked = edit(receipt("Esselunga"), 1, { name: "Mozzarella di bufala", quantityText: "125 g", barcode: "8076800195057", productLabel: "Mozzarella di bufala" });
    await rememberReceipt("Esselunga", linked, NOW, store);

    const next = await nextReceipt(store, "Esselunga");
    expect(next[1]).toMatchObject({ barcode: "8076800195057", name: "Mozzarella di bufala" });
    const built = buildReceiptEvents(next, { store: "Esselunga", date: "" }, { now: NOW, deviceId: "dev" });
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.events.find((e) => e.productRef === "Mozzarella di bufala")?.barcode).toBe("8076800195057");
  });

  it("cambiando negozio si rileggono solo le righe non toccate", async () => {
    const store = fakeStore();
    await rememberReceipt("Esselunga", corrected(receipt("Esselunga")), NOW, store);
    const base = receipt("");
    const touched = edit(base, 1, { name: "Scelta a mano" });
    const next = reapplyMemory(touched, base, await loadMemory("Esselunga", store));
    expect(next[0].name).toBe("Latte parzialmente scremato");
    expect(next[1].name).toBe("Scelta a mano");
  });

  it("«Dimentica» toglie la memoria del negozio e si può rimettere", async () => {
    const store = fakeStore();
    await rememberReceipt("Esselunga", corrected(receipt("Esselunga")), NOW, store);
    const old = await forgetMemory("Esselunga", store);
    expect(store.data.size).toBe(0);
    expect(Object.keys(old.entries)).toHaveLength(2);
    expect((await loadMemory("Esselunga", store)).row.entries).toEqual({});

    await restoreMemory("Esselunga", old, store);
    expect(Object.keys((await loadMemory("Esselunga", store)).row.entries)).toHaveLength(2);
  });

  it("la chiave sta fuori dal prefisso segreto, quindi entra nella copia delle impostazioni", () => {
    expect(memoryRowKey("esselunga").startsWith(SECRET_PREFIX)).toBe(false);
    expect(memoryRowKey("").startsWith(SECRET_PREFIX)).toBe(false);
  });

  it("ciò che è rotto nell'archivio non rompe lo scontrino", async () => {
    const store = fakeStore();
    store.data.set(memoryRowKey("esselunga"), { entries: { [LATTE]: 42 } });
    expect((await nextReceipt(store, "Esselunga"))[0].name).toBe("Latte PS");

    const failing: MemoryStore = { get: () => Promise.reject(new Error("no")), set: () => Promise.reject(new Error("no")), remove: () => Promise.reject(new Error("no")), keys: () => Promise.reject(new Error("no")) };
    expect((await loadMemory("Esselunga", failing)).row.entries).toEqual({});
    await expect(rememberReceipt("Esselunga", corrected(receipt("Esselunga")), NOW, failing)).resolves.toBeDefined();
  });

  it("l'«Annulla» dello scontrino rimette la memoria com'era prima di quello scontrino", async () => {
    const store = fakeStore();
    // memoria precedente: una riga già ricordata
    await rememberReceipt("Esselunga", corrected(receipt("Esselunga")), NOW, store);
    const snapshot = JSON.parse(JSON.stringify(store.data.get(memoryRowKey("esselunga"))));

    const lines = await nextReceipt(store, "Esselunga");
    const done = await rememberReceipt("Esselunga", edit(lines, 0, { name: "Latte nuovo" }), "2026-11-18T09:00:00.000Z", store);
    expect((await loadMemory("Esselunga", store)).row.entries[LATTE].name).toBe("Latte nuovo");

    await restoreMemory("Esselunga", done.before.row, store);
    expect(store.data.get(memoryRowKey("esselunga"))).toEqual(snapshot);
  });

  it("se prima non c'era nulla, annullare lo scontrino toglie la riga d'archivio", async () => {
    const store = fakeStore();
    const done = await rememberReceipt("Esselunga", corrected(receipt("Esselunga")), NOW, store);
    expect(store.data.size).toBe(1);
    await restoreMemory("Esselunga", done.before.row, store);
    expect(store.data.size).toBe(0);
  });

  it("«Non ignorarla più» cancella subito il ricordo, anche senza riaccendere la riga", async () => {
    const store = fakeStore();
    await rememberReceipt("Esselunga", edit(receipt("Esselunga"), 2, { include: false, ignoreAlways: true }), NOW, store);
    const first = await nextReceipt(store, "Esselunga");
    expect(first[2].ignoreAlways).toBe(true);

    const memory = await forgetIgnore("esselunga", first[2].memoryKey ?? "", store);
    expect(Object.keys(memory.row.entries)).toEqual([]);
    // la riga resta saltata in questo scontrino, ma allo scontrino dopo non è più ignorata
    const next = await nextReceipt(store, "Esselunga");
    expect(next[2].ignoreAlways).toBeUndefined();
    expect(next[2].remembered).toBeUndefined();
  });

  it("«Non ignorarla più» non tocca i ricordi che non sono «ignora sempre»", async () => {
    const store = fakeStore();
    await rememberReceipt("Esselunga", corrected(receipt("Esselunga")), NOW, store);
    const before = JSON.stringify(store.data.get(memoryRowKey("esselunga")));
    await forgetIgnore("esselunga", LATTE, store);
    expect(JSON.stringify(store.data.get(memoryRowKey("esselunga")))).toBe(before);
  });

  it("un codice interno ricordato non si applica senza negozio, e si propone", async () => {
    const store = fakeStore();
    const lines = receipt("Esselunga");
    await rememberReceipt("Esselunga", edit(lines, 0, { name: "Prosciutto", quantityText: "100 g", barcode: "2012345000000" }), NOW, store);
    const same = await nextReceipt(store, "Esselunga");
    expect(same[0].remembered).toMatchObject({ applied: true });
    const memory = await loadMemory("Esselunga", store);
    const general = { ...memory, storeKey: "" };
    const none = applyMemory(receipt("")[0], general);
    expect(none.barcode).toBeUndefined();
    if (none.remembered) expect(none.remembered.applied).toBe(false);
  });

  it("a codice collegato, se la foto legge un altro formato, la riga si propone e non si applica da sola", async () => {
    const store = fakeStore();
    const sized = (q: number, unit: string) =>
      toReviewLines(
        parseReceiptResponse(JSON.stringify({ store: "Esselunga", lines: [{ raw: "LATTE PS", name: "Latte PS", quantity: q, unit, priceCents: 129, isFood: true, category: "milk_fresh" }], totalCents: 129 })),
      );
    await rememberReceipt("Esselunga", edit(sized(1, "l"), 0, { name: "Latte Granarolo", quantityText: "1 l", barcode: "8001120974504" }), NOW, store);

    const memory = await loadMemory("Esselunga", store);
    expect(applyMemory(sized(1, "l")[0], memory).remembered).toMatchObject({ applied: true });
    const other = applyMemory(sized(500, "ml")[0], memory);
    expect(other.remembered).toMatchObject({ applied: false });
    expect(other.barcode).toBeUndefined();
    expect(other.name).toBe("Latte PS");
  });

  it("le righe «constructor» e «__proto__» non rompono né trovano ciò che non c'è", async () => {
    const store = fakeStore();
    const odd = (raw: string) =>
      toReviewLines(parseReceiptResponse(JSON.stringify({ store: "Esselunga", lines: [{ raw, name: raw, priceCents: 100, isFood: true, category: "milk_fresh" }], totalCents: 100 })));
    const memory = await loadMemory("Esselunga", store);
    for (const raw of ["constructor", "__proto__", "toString"]) {
      const line = applyMemory(odd(raw)[0], memory);
      expect(line.remembered).toBeUndefined();
      expect(line.name).toBe(raw);
    }
    await rememberReceipt("Esselunga", edit(odd("constructor"), 0, { name: "Costruttore" }), NOW, store);
    const again = applyMemory(odd("constructor")[0], await loadMemory("Esselunga", store));
    expect(again).toMatchObject({ name: "Costruttore" });
  });

  it("oltre il limite si dimentica il negozio usato meno di recente", async () => {
    const store = fakeStore();
    const nameOf = (i: number) => "Negozio " + "abcdefghijklmnopqrstuvwxyz"[i % 26] + "abc"[Math.floor(i / 26)];
    for (let i = 0; i < MAX_STORES + 3; i++) {
      const name = nameOf(i);
      await rememberReceipt(name, corrected(receipt(name)), "2026-02-" + String(i + 1).padStart(2, "0") + "T00:00:00.000Z", store);
    }
    expect(store.data.size).toBe(MAX_STORES);
    // i tre usati per primi sono stati dimenticati, gli altri e l'ultimo no
    for (const i of [0, 1, 2]) expect(store.data.has(memoryRowKey(nameOf(i).toLowerCase().replace(" ", "-")))).toBe(false);
    for (const i of [3, MAX_STORES + 2]) expect(store.data.has(memoryRowKey(nameOf(i).toLowerCase().replace(" ", "-")))).toBe(true);
  });
});
