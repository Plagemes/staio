import { describe, expect, it } from "vitest";
import { applyLabelValues, isLocalCode, validateBarcode, type Nutrients, type Product } from "@/core/catalog";
import { buildCaptureEvents, type CaptureInput } from "../capture";
import { findLocalProduct, localCodeForName, lotCodeFor, manualLotEvents, nameKey, offeredStoreProduct, replacesSavedText, savedSummary } from "./localProduct";
import { saveCapture, type SaveDeps } from "./saveCapture";

const NOW = "2026-11-17T10:00:00.000Z";
const NUTRIENTS: Nutrients = { per: "100g", certainty: "label", energyKcal: 350, fat: 12.5, carbohydrates: 50, proteins: 9 };
const INPUT: CaptureInput = {
  name: "Pane di casa",
  quantityText: "500 g",
  location: "dispensa",
  category: "pasta_dry",
  expiryKind: "none",
  expiryDate: "",
  priceText: "",
  alreadyHave: true,
  barcode: undefined,
};
const ctx = { now: NOW, deviceId: "dev" };

describe("localCodeForName", () => {
  it("è un EAN-13 valido nel campo riservato all'uso interno", () => {
    const code = localCodeForName("Pane di casa") as string;
    expect(code).toHaveLength(13);
    expect(code.startsWith("299")).toBe(true);
    expect(validateBarcode(code).ok).toBe(true);
    expect(isLocalCode(code)).toBe(true);
    expect(isLocalCode("8076800195057")).toBe(false);
  });
  it("lo stesso nome dà sempre lo stesso codice, anche scritto un po' diverso", () => {
    expect(localCodeForName("Pane di casa")).toBe(localCodeForName("  pane DI casa! "));
    expect(localCodeForName("Caffè")).toBe(localCodeForName("caffe"));
    expect(nameKey("Farina 00!")).toBe("farina 00");
  });
  it("nomi diversi danno codici diversi", () => {
    const names = ["Pane di casa", "Pane di segale", "Farina 00", "Farina 0", "Latte", "Latte intero", "Yogurt greco"];
    expect(new Set(names.map((n) => localCodeForName(n))).size).toBe(names.length);
  });
  it("un nome troppo corto non è un prodotto", () => {
    expect(localCodeForName("")).toBeUndefined();
    expect(localCodeForName("a")).toBeUndefined();
    expect(localCodeForName(" ! ")).toBeUndefined();
  });
});

describe("lotto legato alla scheda locale", () => {
  const code = localCodeForName("Pane di casa") as string;

  it("il lotto porta il codice (è ciò che lo collega ai valori) ma resta «a mano»", () => {
    const built = buildCaptureEvents({ ...INPUT, barcode: code }, ctx);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.events[0]).toMatchObject({ source: "barcode", barcode: code });
    const [event] = manualLotEvents(built.events, code);
    expect(event).toMatchObject({ source: "manual", barcode: code, certainty: "estimated", type: "declare" });
  });
  it("per un acquisto la certezza non cambia", () => {
    const built = buildCaptureEvents({ ...INPUT, alreadyHave: false, barcode: code }, ctx);
    if (!built.ok) throw new Error("atteso ok");
    expect(manualLotEvents(built.events, code)[0]).toMatchObject({ source: "manual", type: "purchase", certainty: "label" });
  });
  it("gli eventi con un altro codice non si toccano", () => {
    const built = buildCaptureEvents({ ...INPUT, barcode: "8076800195057" }, ctx);
    if (!built.ok) throw new Error("atteso ok");
    expect(manualLotEvents(built.events, code)).toEqual(built.events);
  });
  it("saveCapture con il codice locale scrive il lotto a mano e collegato", async () => {
    const written: unknown[] = [];
    const deps: SaveDeps = {
      appendEvents: async (events) => {
        written.push(...events);
        return { added: events.length };
      },
      getDeviceId: async () => "dev",
      now: () => NOW,
    };
    const result = await saveCapture({ ...INPUT, barcode: code }, deps, { localCode: code });
    expect(result.ok).toBe(true);
    expect(written[0]).toMatchObject({ source: "manual", barcode: code });
    if (result.ok) expect(result.events).toEqual(written);
    // senza il codice locale il comportamento è quello di sempre
    written.length = 0;
    await saveCapture({ ...INPUT, barcode: code }, deps);
    expect(written[0]).toMatchObject({ source: "barcode", barcode: code });
  });
});

describe("prodotto senza codice ritrovato per nome", () => {
  const records = new Map<string, { data: unknown }>();
  const read = async (barcode: string) => records.get(barcode);

  it("la prima volta non c'è niente; dopo il salvataggio lo si ritrova, anche con un nome scritto un po' diverso", async () => {
    records.clear();
    expect(await findLocalProduct("Pane di casa", read)).toBeUndefined();

    const code = localCodeForName("Pane di casa") as string;
    const product = applyLabelValues(undefined, code, { nutrients: NUTRIENTS, name: "Pane di casa", localFromName: true }, NOW, "manual");
    records.set(code, { data: product });

    const found = await findLocalProduct("pane di CASA", read);
    expect(found).toMatchObject({ barcode: code, source: "manual", nutrients: NUTRIENTS });
    expect(await findLocalProduct("Pane di segale", read)).toBeUndefined();
  });
  it("una correzione successiva si rilegge al posto dei valori di prima", async () => {
    records.clear();
    const code = localCodeForName("Pane di casa") as string;
    const first: Product = applyLabelValues(undefined, code, { nutrients: NUTRIENTS, name: "Pane di casa", localFromName: true }, NOW, "manual");
    records.set(code, { data: first });
    const corrected = applyLabelValues(first, code, { nutrients: { ...NUTRIENTS, fat: 14 } }, "2026-11-18T08:00:00.000Z", "manual");
    records.set(code, { data: corrected });
    expect((await findLocalProduct("Pane di casa", read))?.nutrients?.fat).toBe(14);
  });
  it("dati illeggibili nell'archivio non rompono niente", async () => {
    records.clear();
    records.set(localCodeForName("Pane di casa") as string, { data: { qualcosa: 1 } });
    expect(await findLocalProduct("Pane di casa", read)).toBeUndefined();
    expect(await findLocalProduct("", read)).toBeUndefined();
  });
});

describe("varianti: due prodotti con lo stesso nome", () => {
  const records = new Map<string, { data: unknown }>();
  const read = async (barcode: string) => records.get(barcode);
  const save = (variant: number, nutrients: Nutrients, extra: { allergens?: string[] } = {}) => {
    const code = localCodeForName("Biscotti", variant) as string;
    records.set(code, { data: applyLabelValues(undefined, code, { nutrients, name: "Biscotti", localFromName: true, ...extra }, NOW, "manual") });
    return code;
  };

  it("la variante 0 è quella di sempre; le altre sono codici diversi e stabili", () => {
    expect(localCodeForName("Biscotti", 0)).toBe(localCodeForName("Biscotti"));
    const codes = [0, 1, 2, 3].map((v) => localCodeForName("Biscotti", v) as string);
    expect(new Set(codes).size).toBe(4);
    expect(localCodeForName("biscotti!", 2)).toBe(codes[2]);
    for (const c of codes) expect(validateBarcode(c).ok).toBe(true);
  });
  it("una scheda nuova per un'altra marca non sovrascrive la prima", async () => {
    records.clear();
    const a = save(0, { per: "100g", certainty: "label", energyKcal: 450, fat: 18 }, { allergens: ["gluten", "milk"] });
    const b = save(1, { per: "100g", certainty: "label", energyKcal: 380, fat: 9 });
    expect(a).not.toBe(b);
    expect((await findLocalProduct("Biscotti", read, 0))?.nutrients?.energyKcal).toBe(450);
    expect((await findLocalProduct("Biscotti", read, 1))?.nutrients?.energyKcal).toBe(380);
    expect(await findLocalProduct("Biscotti", read, 2)).toBeUndefined();
  });
  it("si ritrova solo una scheda creata dal nome: un altro prodotto allo stesso codice no", async () => {
    records.clear();
    const code = localCodeForName("Biscotti") as string;
    const foreign: Product = { barcode: code, name: "Prosciutto", fetchedAt: NOW, source: "label_photo", nutrients: NUTRIENTS };
    records.set(code, { data: foreign });
    expect(await findLocalProduct("Biscotti", read)).toBeUndefined();
  });
});

describe("savedSummary", () => {
  it("due o tre valori e gli allergeni, per riconoscere la scheda prima di usarla", () => {
    const text = savedSummary({ nutrients: { per: "100g", certainty: "label", energyKcal: 450.2, fat: 18, carbohydrates: 60, proteins: 7 }, allergens: ["gluten", "milk"] });
    expect(text).toBe("450 kcal, grassi 18 g, carboidrati 60 g per 100 g. Allergeni dichiarati: glutine, latte.");
  });
  it("con pochi valori dice solo quelli", () => {
    expect(savedSummary({ nutrients: { per: "100ml", certainty: "label", proteins: 3.2 } })).toBe("proteine 3,2 g per 100 ml.");
    expect(savedSummary({})).toBe("");
  });
});

describe("codice interno del negozio con una scheda già salvata", () => {
  const mine = { barcode: "2012345000000", fetchedAt: "2026-11-17T08:00:00.000Z", source: "manual", name: "Prosciutto" } as Product;
  it("la scheda salvata si offre, non si applica", () => {
    expect(offeredStoreProduct("2012345000000", mine)).toBe(mine);
    expect(offeredStoreProduct("8076800195057", { ...mine, barcode: "8076800195057" })).toBeUndefined();
    expect(offeredStoreProduct("2990000012345", { ...mine, barcode: "2990000012345", localFromName: true })).toBeUndefined();
    expect(offeredStoreProduct(undefined, mine)).toBeUndefined();
  });
  it("il lotto non porta il codice finché l'utente non sceglie la scheda", () => {
    const base = { barcode: "2012345000000", localCode: undefined, offered: mine };
    expect(lotCodeFor({ ...base, chosen: undefined })).toBeUndefined();
    expect(lotCodeFor({ ...base, chosen: false })).toBeUndefined();
    expect(lotCodeFor({ ...base, chosen: true })).toBe("2012345000000");
    expect(lotCodeFor({ barcode: "8076800195057", localCode: undefined, offered: undefined, chosen: undefined })).toBe("8076800195057");
  });
  it("avverte che i valori nuovi sostituiscono la scheda", () => {
    expect(replacesSavedText("Prosciutto")).toBe("Sostituisce la scheda di «Prosciutto» per questo codice.");
  });
});
