import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/core/catalog";

const store = new Map<string, { barcode: string; fetchedAt: string; data: unknown }>();
vi.mock("@/data", () => ({
  getProductRecord: async (code: string) => store.get(code),
  putProductRecord: async (record: { barcode: string; fetchedAt: string; data: unknown }) => void store.set(record.barcode, record),
}));

const { lookupProduct } = await import("./lookup");

const CODE = "8076800195057";
const OLD: Product = { barcode: CODE, name: "Vecchia scheda", fetchedAt: "2026-01-01T00:00:00.000Z", source: "openfoodfacts" };
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const online = (body: unknown) => (async () => json(body)) as unknown as typeof fetch;
const offline = (async () => {
  throw new TypeError("Failed to fetch");
}) as unknown as typeof fetch;
const BODY = { code: CODE, status: 1, product: { code: CODE, product_name: "Nuova", ingredients_text_it: "Farina, latte", traces_tags: ["en:soybeans"] } };

beforeEach(() => store.clear());

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
