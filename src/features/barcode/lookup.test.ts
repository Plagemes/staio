import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/catalog";

const store = new Map<string, { barcode: string; fetchedAt: string; data: unknown }>();
let unreadable = false;
vi.mock("@/data", () => ({
  getProductRecord: async (code: string) => {
    if (unreadable) throw new Error("archivio non leggibile");
    return store.get(code);
  },
  putProductRecord: async (record: { barcode: string; fetchedAt: string; data: unknown }) => void store.set(record.barcode, record),
}));

const { lookupProduct } = await import("./lookup");
const { fetchProduct } = await import("./offClient");
const { localCodeForName } = await import("../capture/localProduct");

const CODE = "8076800195057";
const OLD: Product = { barcode: CODE, name: "Vecchia scheda", fetchedAt: "2026-01-01T00:00:00.000Z", source: "openfoodfacts" };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const online = (body: unknown) => (async () => json(body)) as unknown as typeof fetch;
const offline = (async () => {
  throw new TypeError("Failed to fetch");
}) as unknown as typeof fetch;
const BODY = { code: CODE, status: 1, product: { code: CODE, product_name: "Nuova", ingredients_text_it: "Farina, latte", traces_tags: ["en:soybeans"] } };

beforeEach(() => {
  store.clear();
  unreadable = false;
});

describe("lookupProduct con l'archivio illeggibile", () => {
  it("un codice con la forma dei locali non va in rete", async () => {
    unreadable = true;
    const never = (async () => {
      throw new Error("non doveva andare in rete");
    }) as unknown as typeof fetch;
    expect(await lookupProduct("2990000012345", { fetchImpl: never })).toEqual({ status: "not_found" });
  });
  it("un codice normale va comunque in rete", async () => {
    unreadable = true;
    expect(await lookupProduct(CODE, { fetchImpl: online(BODY) })).toMatchObject({ status: "found", from: "service" });
  });
});

describe("lookupProduct e schede salvate prima degli ingredienti", () => {
  it("rilegge una scheda senza ingredienti e tracce, e la salva con il segno", async () => {
    store.set(CODE, { barcode: CODE, fetchedAt: OLD.fetchedAt, data: OLD });
    const r = await lookupProduct(CODE, { fetchImpl: online(BODY) });
    expect(r).toMatchObject({ status: "found", from: "service", product: { name: "Nuova", ingredientsText: "Farina, latte", traces: ["soybeans"], safetyFields: true } });
    expect(store.get(CODE)?.data).toMatchObject({ safetyFields: true });
  });

  it("senza rete usa la scheda salvata", async () => {
    store.set(CODE, { barcode: CODE, fetchedAt: OLD.fetchedAt, data: OLD });
    expect(await lookupProduct(CODE, { fetchImpl: offline })).toMatchObject({ status: "found", from: "memory", product: { name: "Vecchia scheda" } });
  });

  it("una scheda già completa non va in rete", async () => {
    store.set(CODE, { barcode: CODE, fetchedAt: OLD.fetchedAt, data: { ...OLD, safetyFields: true } });
    const never = (async () => {
      throw new Error("rete non attesa");
    }) as unknown as typeof fetch;
    expect(await lookupProduct(CODE, { fetchImpl: never })).toMatchObject({ status: "found", from: "memory" });
  });
});

describe("lookupProduct e valori letti da una foto dell'etichetta", () => {
  const NUTRIENTS = { per: "100g" as const, certainty: "label" as const, energyKcal: 535, fat: 31, carbohydrates: 57, proteins: 6.5 };
  const PHOTO: Product = {
    barcode: CODE,
    name: "Dalla foto",
    fetchedAt: "2026-01-01T00:00:00.000Z",
    source: "label_photo",
    nutrients: NUTRIENTS,
    labelPhoto: { readAt: "2026-11-17T10:00:00.000Z", nutrients: true, name: true },
  };

  it("un prodotto che Open Food Facts non conosce resta quello letto dalla foto, senza rete", async () => {
    store.set(CODE, { barcode: CODE, fetchedAt: PHOTO.fetchedAt, data: PHOTO });
    expect(await lookupProduct(CODE, { fetchImpl: offline })).toMatchObject({ status: "found", from: "memory", product: { source: "label_photo", nutrients: NUTRIENTS } });
    const notFound = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    expect(await lookupProduct(CODE, { fetchImpl: notFound })).toMatchObject({ status: "found", from: "memory", product: { nutrients: NUTRIENTS } });
  });

  it("quando Open Food Facts compare, i valori confermati dall'utente restano", async () => {
    store.set(CODE, { barcode: CODE, fetchedAt: PHOTO.fetchedAt, data: PHOTO });
    const body = { code: CODE, status: 1, product: { code: CODE, product_name: "Nuova", nutriments: { "energy-kcal_100g": 1 } } };
    const r = await lookupProduct(CODE, { fetchImpl: online(body) });
    expect(r).toMatchObject({ status: "found", from: "service", product: { name: "Nuova", source: "openfoodfacts", nutrients: NUTRIENTS, labelPhoto: { nutrients: true } } });
    expect(store.get(CODE)?.data).toMatchObject({ nutrients: NUTRIENTS });
  });
});

/** Una rete che fa fallire il test se viene toccata. */
function forbiddenNetwork() {
  const calls: string[] = [];
  const impl = (async (url: unknown) => {
    calls.push(String(url));
    throw new Error("rete non attesa");
  }) as unknown as typeof fetch;
  return { calls, impl };
}

describe("schede create dal nome: mai in rete", () => {
  const LOCAL = localCodeForName("Pane di casa") as string;
  const savedLocal = (): Product => ({ barcode: LOCAL, name: "Pane di casa", fetchedAt: "2026-11-17T10:00:00.000Z", source: "manual", localFromName: true });

  it("con la scheda salvata: la trova, senza rete, anche senza ingredienti né safetyFields", async () => {
    const net = forbiddenNetwork();
    store.set(LOCAL, { barcode: LOCAL, fetchedAt: savedLocal().fetchedAt, data: savedLocal() });
    expect(await lookupProduct(LOCAL, { fetchImpl: net.impl })).toMatchObject({ status: "found", from: "memory", product: { name: "Pane di casa" } });
    expect(net.calls).toEqual([]);
  });
  it("lo stesso vale con le schede senza segno di completezza e con un codice a barre vero accanto", async () => {
    const net = forbiddenNetwork();
    store.set(LOCAL, { barcode: LOCAL, fetchedAt: savedLocal().fetchedAt, data: { ...savedLocal(), ingredientsText: "farina" } });
    await lookupProduct(LOCAL, { fetchImpl: net.impl });
    expect(net.calls).toEqual([]);
  });
  it("un codice 299 senza una scheda creata dal nome è un codice interno di un negozio: si cerca come gli altri", async () => {
    const net = forbiddenNetwork();
    const r = await lookupProduct(LOCAL, { fetchImpl: net.impl });
    expect(r.status).toBe("failed");
    expect(net.calls).toHaveLength(1);
  });
  it("un 299 salvato come scheda dell'utente (non creata dal nome) non si tratta come locale", async () => {
    const mine: Product = { barcode: LOCAL, name: "Salame del negozio", fetchedAt: "2026-11-17T10:00:00.000Z", source: "manual" };
    store.set(LOCAL, { barcode: LOCAL, fetchedAt: mine.fetchedAt, data: mine });
    const body = { code: LOCAL, status: 1, product: { code: LOCAL, product_name: "Altro" } };
    // è un codice interno con una scheda dell'utente: resta la sua, e sarà la schermata a chiedere conferma
    expect(await lookupProduct(LOCAL, { fetchImpl: online(body) })).toMatchObject({ status: "found", from: "memory", product: { name: "Salame del negozio" } });
  });
  it("un codice normale va in rete come sempre", async () => {
    const net = forbiddenNetwork();
    expect((await fetchProduct("8076800195057", { fetchImpl: net.impl })).status).toBe("failed");
    expect(net.calls).toHaveLength(1);
  });
});

describe("codici interni dei negozi (20-29)", () => {
  const SHOP = "2000000000015";
  const OFF_BODY = { code: SHOP, status: 1, product: { code: SHOP, product_name: "Latte bulgaro", allergens_tags: ["en:milk"] } };

  it("si cerca come gli altri, ma la scheda è di Open Food Facts: sarà la schermata ad avvisare", async () => {
    const r = await lookupProduct(SHOP, { fetchImpl: online(OFF_BODY) });
    expect(r).toMatchObject({ status: "found", from: "service", product: { name: "Latte bulgaro", source: "openfoodfacts" } });
  });
  it("la scheda scritta dall'utente per quel codice non si sostituisce con quella di Open Food Facts", async () => {
    const mine: Product = { barcode: SHOP, name: "Mozzarella del banco", fetchedAt: "2026-11-17T10:00:00.000Z", source: "manual" };
    store.set(SHOP, { barcode: SHOP, fetchedAt: mine.fetchedAt, data: mine });
    const net = forbiddenNetwork();
    expect(await lookupProduct(SHOP, { fetchImpl: net.impl })).toMatchObject({ status: "found", from: "memory", product: { name: "Mozzarella del banco" } });
    expect(net.calls).toEqual([]);
  });
  it("per un codice normale una scheda scritta a mano si rilegge ancora, e i valori confermati restano", async () => {
    const mine: Product = {
      barcode: CODE,
      name: "Mia",
      fetchedAt: "2026-11-17T10:00:00.000Z",
      source: "manual",
      nutrients: { per: "100g", certainty: "label", energyKcal: 350 },
      labelPhoto: { readAt: "2026-11-17T10:00:00.000Z", by: "manual", nutrients: true },
    };
    store.set(CODE, { barcode: CODE, fetchedAt: mine.fetchedAt, data: mine });
    const r = await lookupProduct(CODE, { fetchImpl: online(BODY) });
    expect(r).toMatchObject({ status: "found", from: "service", product: { nutrients: { energyKcal: 350 } } });
  });
});
