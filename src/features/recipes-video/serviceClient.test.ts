import { describe, expect, it, vi } from "vitest";
import { EXTRACT_PATH, checkService, extractVideo } from "./serviceClient";

const service = { url: "https://servizio.example", token: "a1b2c3d4e5f6a7b8c9d0" };
const jpeg = `/9j/${"A".repeat(200)}`;
const okBody = { caption: "Pasta", frames: [jpeg], durationSec: 30 };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const deps = (fetchImpl: (input: string, init: RequestInit) => Promise<Response>, extra: object = {}) => ({ fetch: fetchImpl, online: true, ...extra });

describe("extractVideo", () => {
  it("senza servizio non chiama nessuno e dice la verità", async () => {
    const fetchImpl = vi.fn();
    const r = await extractVideo("https://youtu.be/x", { url: "", token: "" }, deps(fetchImpl));
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: false, code: "not_configured" });
    expect(!r.ok && r.message).toBe("Per leggere il video serve il servizio di estrazione, che non è ancora attivo. Intanto puoi incollare qui la didascalia.");
  });

  it("senza rete non chiama nessuno", async () => {
    const fetchImpl = vi.fn();
    expect(await extractVideo("https://youtu.be/x", service, { fetch: fetchImpl, online: false })).toMatchObject({ code: "offline" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("invia solo il link e il token del servizio, mai altro", async () => {
    const fetchImpl = vi.fn(async () => json(okBody));
    const r = await extractVideo("https://youtu.be/x", service, deps(fetchImpl));
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://servizio.example${EXTRACT_PATH}`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ url: "https://youtu.be/x" });
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${service.token}`);
    expect(init.credentials).toBe("omit");
    expect(init.referrerPolicy).toBe("no-referrer");
  });

  it("legge il contenuto valido", async () => {
    const r = await extractVideo("https://youtu.be/x", service, deps(async () => json(okBody)));
    expect(r.ok && r.video.frames).toHaveLength(1);
    expect(r.ok && r.video.caption).toBe("Pasta");
  });

  it("scarta una risposta fuori contratto", async () => {
    const r = await extractVideo("https://youtu.be/x", service, deps(async () => json({ ...okBody, frames: Array.from({ length: 9 }, () => jpeg) })));
    expect(r).toMatchObject({ ok: false, code: "bad_response" });
    expect(await extractVideo("https://youtu.be/x", service, deps(async () => new Response("<html>", { status: 200 })))).toMatchObject({ code: "bad_response" });
    expect(await extractVideo("https://youtu.be/x", service, deps(async () => json({ ...okBody, durationSec: 900 })))).toMatchObject({ code: "too_long" });
  });

  it("traduce gli stati e i codici del servizio", async () => {
    const code = async (status: number, body: unknown = {}) => {
      const r = await extractVideo("https://youtu.be/x", service, deps(async () => json(body, status)));
      return r.ok ? "ok" : r.code;
    };
    expect(await code(401)).toBe("unauthorized");
    expect(await code(429)).toBe("rate_limited");
    expect(await code(504)).toBe("timeout");
    expect(await code(503)).toBe("busy");
    expect(await code(422, { error: "domain_not_allowed" })).toBe("domain_not_allowed");
    expect(await code(422, { error: "too_long" })).toBe("too_long");
    expect(await code(502, { error: "unavailable" })).toBe("unavailable");
    expect(await code(500)).toBe("unavailable");
    expect(await code(400, { error: "qualcosa di strano" })).toBe("bad_response");
  });

  it("problemi di rete, annullamento e tempo scaduto", async () => {
    const down = await extractVideo("https://youtu.be/x", service, deps(async () => Promise.reject(new TypeError("x"))));
    expect(down).toMatchObject({ code: "network" });
    const controller = new AbortController();
    const slow = (_: string, init: RequestInit) =>
      new Promise<Response>((_res, rej) => init.signal?.addEventListener("abort", () => rej(new DOMException("a", "AbortError"))));
    const pending = extractVideo("https://youtu.be/x", service, deps(slow, { signal: controller.signal }));
    controller.abort();
    expect(await pending).toMatchObject({ code: "aborted" });
    expect(await extractVideo("https://youtu.be/x", service, deps(slow, { timeoutMs: 10 }))).toMatchObject({ code: "timeout" });
  });

  it("nessun messaggio contiene il token", async () => {
    const r = await extractVideo("https://youtu.be/x", service, deps(async () => json({}, 401)));
    expect(JSON.stringify(r)).not.toContain(service.token);
  });
});

describe("checkService", () => {
  it("chiede lo stato senza token", async () => {
    const fetchImpl = vi.fn(async () => json({ ok: true }));
    const r = await checkService(service, { fetch: fetchImpl });
    expect(r.ok).toBe(true);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://servizio.example/salute");
    expect(init.headers).toBeUndefined();
  });
  it("dice se non risponde", async () => {
    expect((await checkService(service, { fetch: async () => Promise.reject(new Error("x")) })).ok).toBe(false);
    expect((await checkService(service, { fetch: async () => json({}, 500) })).ok).toBe(false);
  });
});
