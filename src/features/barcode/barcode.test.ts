import { describe, expect, it } from "vitest";
import type { Product } from "@/core/catalog";
import { classifyCameraError } from "./camera";
import { captureHref, captureHrefForCode } from "./links";
import { fetchProduct, productUrl } from "./offClient";

const NOW = () => "2026-11-17T08:00:00.000Z";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const fakeFetch = (impl: (url: string, init?: RequestInit) => Promise<Response>) => impl as unknown as typeof fetch;

const FOUND = {
  code: "8076800195057",
  status: 1,
  product: { code: "8076800195057", product_name: "Spaghetti n. 5", brands: "Barilla", quantity: "500 g", categories_tags: ["en:dried-pastas"] },
};

describe("productUrl", () => {
  it("chiede solo i campi necessari e usa la forma a 13 cifre", () => {
    const url = new URL(productUrl("036000291452"));
    expect(url.origin).toBe("https://world.openfoodfacts.org");
    expect(url.pathname).toBe("/api/v2/product/0036000291452.json");
    expect(url.searchParams.get("fields")).toContain("product_name");
    expect(url.searchParams.get("fields")).not.toContain("ingredients");
  });
});

describe("fetchProduct", () => {
  it("trova un prodotto", async () => {
    const result = await fetchProduct("8076800195057", { fetchImpl: fakeFetch(async () => json(FOUND)), now: NOW });
    expect(result).toMatchObject({ status: "found", product: { barcode: "8076800195057", name: "Spaghetti n. 5", fetchedAt: NOW() } });
  });

  it("prodotto non trovato: risposta 404 con corpo, o stato 0", async () => {
    const body = { code: "8076800195057", status: 0, status_verbose: "product not found" };
    expect(await fetchProduct("8076800195057", { fetchImpl: fakeFetch(async () => json(body, 404)) })).toEqual({ status: "not_found" });
    expect(await fetchProduct("8076800195057", { fetchImpl: fakeFetch(async () => json(body, 200)) })).toEqual({ status: "not_found" });
    expect(await fetchProduct("8076800195057", { fetchImpl: fakeFetch(async () => new Response("", { status: 404 })) })).toEqual({
      status: "not_found",
    });
  });

  it("errore del servizio e risposta illeggibile", async () => {
    expect(await fetchProduct("8076800195057", { fetchImpl: fakeFetch(async () => json({}, 503)) })).toEqual({ status: "failed", reason: "service" });
    expect(await fetchProduct("8076800195057", { fetchImpl: fakeFetch(async () => new Response("<html>", { status: 200 })) })).toEqual({
      status: "failed",
      reason: "service",
    });
  });

  it("rete assente", async () => {
    const result = await fetchProduct("8076800195057", {
      fetchImpl: fakeFetch(async () => {
        throw new TypeError("Failed to fetch");
      }),
    });
    expect(result).toEqual({ status: "failed", reason: "network" });
  });

  it("tempo massimo", async () => {
    const hang = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    expect(await fetchProduct("8076800195057", { fetchImpl: hang, timeoutMs: 20 })).toEqual({ status: "failed", reason: "timeout" });
  });

  it("annullata da chi l'ha avviata", async () => {
    const controller = new AbortController();
    const hang = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const pending = fetchProduct("8076800195057", { fetchImpl: hang, signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    expect(await pending).toEqual({ status: "failed", reason: "aborted" });
  });

  it("non chiama la rete per un codice non valido", async () => {
    let calls = 0;
    const result = await fetchProduct("8076800195050", {
      fetchImpl: fakeFetch(async () => {
        calls += 1;
        return json(FOUND);
      }),
    });
    expect(result).toEqual({ status: "failed", reason: "invalid_code" });
    expect(calls).toBe(0);
  });
});

describe("captureHref", () => {
  const base: Product = { barcode: "8076800195057", fetchedAt: "2026-11-17T08:00:00.000Z", source: "openfoodfacts" };

  it("passa nome, quantità, categoria, codice e marca", () => {
    const href = captureHref({
      ...base,
      name: "Spaghetti n. 5",
      brand: "Barilla",
      quantity: { text: "500 g", value: 500, unit: "g" },
      categories: ["dried-pastas"],
    });
    const url = new URL(href, "https://esempio.test");
    expect(url.pathname).toBe("/app/cattura");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      nome: "Spaghetti n. 5",
      quantita: "500 g",
      categoria: "pasta_dry",
      barcode: "8076800195057",
      marca: "Barilla",
    });
  });

  it("omette ciò che manca, compresa la categoria non riconosciuta", () => {
    const url = new URL(captureHref({ ...base, name: "Mistero", quantity: { text: "una busta" } }), "https://esempio.test");
    expect(Object.fromEntries(url.searchParams)).toEqual({ nome: "Mistero", barcode: "8076800195057" });
  });

  it("per il prodotto non trovato passa solo il codice", () => {
    expect(captureHrefForCode("8076800195057")).toBe("/app/cattura?barcode=8076800195057");
  });
});

describe("classifyCameraError", () => {
  it("distingue permesso negato, fotocamera assente e occupata", () => {
    expect(classifyCameraError(new DOMException("x", "NotAllowedError"))).toBe("denied");
    expect(classifyCameraError(new DOMException("x", "NotFoundError"))).toBe("absent");
    expect(classifyCameraError(new DOMException("x", "NotReadableError"))).toBe("busy");
    expect(classifyCameraError(new Error("boh"))).toBe("failed");
    expect(classifyCameraError(undefined)).toBe("failed");
  });
});
