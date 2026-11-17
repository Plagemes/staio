import { describe, expect, it, vi } from "vitest";
import { createFetch, createImportHandler, MAX_BODY_BYTES } from "./handler";
import type { FetchResult } from "./fetch-page";
import { createRateLimiter } from "./rate-limit";
import { PUBLIC_V4, chunks, fakeNet, response } from "./test-helpers";

const HOST = "ricette.example.com";
const PAGE = `https://${HOST}/torta`;

const LD = {
  "@context": "https://schema.org",
  "@type": "Recipe",
  name: "Torta di mele",
  recipeYield: "8",
  recipeIngredient: ["3 mele", "200 g di farina"],
  recipeInstructions: [{ "@type": "HowToStep", text: "Infornare per 40 minuti." }],
};
const HTML_WITH_RECIPE = `<html><head><script type="application/ld+json">${JSON.stringify(LD)}</script></head><body></body></html>`;
const HTML_PLAIN = `<html><head><title>Una pagina</title></head><body><main><p>Solo testo, nessun dato strutturato.</p></main></body></html>`;

function post(body: unknown, headers: Record<string, string> = {}, raw = false): Request {
  return new Request("https://app.example.org/api/ricetta", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://app.example.org", "x-forwarded-for": "203.0.113.50", ...headers },
    body: raw ? (body as string) : JSON.stringify(body),
  });
}

interface Setup {
  handler: ReturnType<typeof createImportHandler>;
  net: ReturnType<typeof fakeNet>;
}
function setup(pages: Parameters<typeof fakeNet>[1], hosts: Parameters<typeof fakeNet>[0] = { [HOST]: [PUBLIC_V4] }, perCallerLimit = 10): Setup {
  const net = fakeNet(hosts, pages);
  const handler = createImportHandler({
    fetch: createFetch(net),
    perCaller: createRateLimiter({ limit: perCallerLimit, windowMs: 60_000 }),
    global: createRateLimiter({ limit: 1000, windowMs: 60_000 }),
  });
  return { handler, net };
}

async function json(r: Response): Promise<Record<string, unknown>> {
  return (await r.json()) as Record<string, unknown>;
}

describe("POST /api/ricetta: risposta", () => {
  it("restituisce la ricetta estratta, senza salvare nulla", async () => {
    const { handler, net } = setup({ [PAGE]: { body: chunks(HTML_WITH_RECIPE) } });
    const r = await handler(post({ url: PAGE }));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("content-type")).toContain("application/json");
    const b = await json(r);
    expect(b.ok).toBe(true);
    expect(b.found).toBe(true);
    expect(b.recipe).toMatchObject({ title: "Torta di mele", servings: 8, origin: { url: PAGE } });
    expect(net.transport).toHaveBeenCalledTimes(1);
  });

  it("senza dati strutturati risponde 'non trovata' con titolo e testo", async () => {
    const { handler } = setup({ [PAGE]: { body: chunks(HTML_PLAIN) } });
    const b = await json(await handler(post({ url: PAGE })));
    expect(b).toEqual({ ok: true, found: false, title: "Una pagina", text: "Solo testo, nessun dato strutturato." });
  });

  it("segue i reindirizzamenti ricontrollandoli e riporta l'indirizzo finale come fonte", async () => {
    const { handler } = setup(
      { [PAGE]: { status: 301, headers: { location: `https://${HOST}/nuova` } }, [`https://${HOST}/nuova`]: { body: chunks(HTML_WITH_RECIPE) } },
    );
    const b = await json(await handler(post({ url: PAGE })));
    expect((b.recipe as { origin: { url: string } }).origin.url).toBe(`https://${HOST}/nuova`);
  });

  it("nessun cookie, credenziale o intestazione dell'utente arriva al sito", async () => {
    const { handler, net } = setup({ [PAGE]: { body: chunks(HTML_PLAIN) } });
    await handler(
      post({ url: PAGE }, {
        cookie: "sessione=segretissima",
        authorization: "Bearer token-segreto",
        "x-api-key": "chiave",
        referer: "https://app.example.org/privato",
        "x-forwarded-for": "198.51.100.9",
        "user-agent": "browser-dell-utente",
      }),
    );
    const sent = JSON.stringify(net.transport.mock.calls[0]?.[0].headers);
    expect(sent).not.toMatch(/segretissima|token-segreto|chiave|privato|198\.51|browser-dell-utente|cookie|authorization/i);
  });

  it("non registra gli indirizzi richiesti: nessuna scrittura sui log", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => undefined));
    const { handler } = setup({ [PAGE]: { body: chunks(HTML_PLAIN) } });
    await handler(post({ url: PAGE }));
    await handler(post({ url: "https://localhost/segreto" }));
    await handler(post("{rotto", {}, true));
    for (const s of spies) expect(s).not.toHaveBeenCalled();
    spies.forEach((s) => s.mockRestore());
  });
});

describe("POST /api/ricetta: richiesta non valida", () => {
  it("rifiuta JSON non valido, forme sbagliate e indirizzi mancanti", async () => {
    const { handler } = setup({});
    for (const [body, raw] of [["{rotto", true], ["", true], ["null", true], ["[]", true], ["42", true], [{}, false], [{ url: 3 }, false], [{ url: "  " }, false], [{ link: PAGE }, false]] as const) {
      const r = await handler(post(body, {}, raw));
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(((await json(r)).error as { code: string }).code).toBe("invalid_request");
    }
  });

  it("accetta solo contenuto JSON", async () => {
    const { handler } = setup({});
    const r = await handler(post(JSON.stringify({ url: PAGE }), { "content-type": "text/plain" }, true));
    expect(r.status).toBe(415);
    const r2 = await handler(new Request("https://app.example.org/api/ricetta", { method: "POST", headers: { origin: "https://app.example.org" }, body: JSON.stringify({ url: PAGE }) }));
    expect(r2.status).toBe(415);
  });

  it("rifiuta corpi troppo grandi, dichiarati o letti a flusso", async () => {
    const { handler, net } = setup({});
    const big = JSON.stringify({ url: `https://${HOST}/${"a".repeat(MAX_BODY_BYTES)}` });
    expect((await handler(post(big, {}, true))).status).toBe(413);
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        const piece = new TextEncoder().encode("x".repeat(1024));
        for (let i = 0; i < 8; i++) c.enqueue(piece);
        c.close();
      },
    });
    const r = await handler(new Request("https://app.example.org/api/ricetta", { method: "POST", headers: { "content-type": "application/json", origin: "https://app.example.org" }, body: stream, duplex: "half" } as RequestInit));
    expect(r.status).toBe(413);
    expect(net.resolve).not.toHaveBeenCalled();
  });
});

describe("POST /api/ricetta: indirizzi non ammessi", () => {
  const code = async (r: Response) => ((await json(r)).error as { code: string }).code;

  it("solo https", async () => {
    const { handler, net } = setup({});
    const r = await handler(post({ url: "http://ricette.example.com/torta" }));
    expect(r.status).toBe(400);
    expect(await code(r)).toBe("not_https");
    expect(net.resolve).not.toHaveBeenCalled();
  });

  it("rifiuta reti private, locali e riservate per nome e per indirizzo numerico", async () => {
    const { handler, net } = setup({}, undefined, 100);
    for (const u of ["https://localhost/", "https://127.0.0.1/", "https://2130706433/", "https://0x7f.1/", "https://[::1]/", "https://[::ffff:10.0.0.1]/", "https://169.254.169.254/latest/meta-data/", "https://192.168.1.1/", "https://intranet/", "https://u:p@ricette.example.com/", "https://ricette.example.com:8443/"]) {
      const r = await handler(post({ url: u }));
      expect(r.status, u).toBe(400);
      expect(["address_not_allowed", "invalid_url"]).toContain(await code(r));
    }
    expect(net.resolve).not.toHaveBeenCalled();
    expect(net.transport).not.toHaveBeenCalled();
  });

  it("rifiuta un nome che si risolve in un indirizzo privato, senza rivelare quale", async () => {
    const { handler, net } = setup({ [PAGE]: {} }, { [HOST]: [{ address: "10.20.30.40", family: 4 }] });
    const r = await handler(post({ url: PAGE }));
    expect(r.status).toBe(400);
    const text = JSON.stringify(await json(r));
    expect(text).toContain("address_not_allowed");
    expect(text).not.toMatch(/10\.20\.30\.40|ricette\.example\.com/);
    expect(net.transport).not.toHaveBeenCalled();
  });
});

describe("POST /api/ricetta: errori senza dettagli interni", () => {
  const cases: [string, Parameters<typeof fakeNet>[1], Parameters<typeof fakeNet>[0], number, string][] = [
    ["sito irraggiungibile", {}, {}, 502, "unreachable"],
    ["errore del sito", { [PAGE]: { status: 500 } }, { [HOST]: [PUBLIC_V4] }, 502, "upstream_error"],
    ["pagina non trovata", { [PAGE]: { status: 404 } }, { [HOST]: [PUBLIC_V4] }, 502, "upstream_error"],
    ["non HTML", { [PAGE]: { headers: { "content-type": "application/pdf" } } }, { [HOST]: [PUBLIC_V4] }, 422, "not_html"],
    ["troppo grande", { [PAGE]: { headers: { "content-length": "999999999" } } }, { [HOST]: [PUBLIC_V4] }, 422, "too_large"],
    ["troppi salti", { [PAGE]: { status: 302, headers: { location: "/a" } }, [`https://${HOST}/a`]: { status: 302, headers: { location: "/b" } }, [`https://${HOST}/b`]: { status: 302, headers: { location: "/c" } }, [`https://${HOST}/c`]: { status: 302, headers: { location: "/d" } }, [`https://${HOST}/d`]: {} }, { [HOST]: [PUBLIC_V4] }, 502, "too_many_redirects"],
  ];
  for (const [label, pages, hosts, status, code] of cases) {
    it(`${label}: ${status} ${code}`, async () => {
      const { handler } = setup(pages, hosts);
      const r = await handler(post({ url: PAGE }));
      expect(r.status).toBe(status);
      const b = await json(r);
      expect(b).toEqual({ ok: false, error: { code, message: expect.any(String) } });
      expect(JSON.stringify(b)).not.toMatch(/ENOTFOUND|interno\)|93\.184|stack| at /);
    });
  }

  it("il tempo scaduto è 504", async () => {
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [PAGE]: () => new Promise(() => undefined) });
    const handler = createImportHandler({ fetch: createFetch(net, { timeoutMs: 20 }), perCaller: createRateLimiter({ limit: 5, windowMs: 1000 }) });
    expect((await handler(post({ url: PAGE }))).status).toBe(504);
  });

  it("un'eccezione imprevista è un 500 generico, senza messaggio né stack", async () => {
    const handler = createImportHandler({
      fetch: async () => {
        throw new Error("password del database: hunter2 in /srv/app/segreto.ts");
      },
      perCaller: createRateLimiter({ limit: 5, windowMs: 1000 }),
    });
    const r = await handler(post({ url: PAGE }));
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(text).not.toMatch(/hunter2|segreto\.ts|Error:|\bat /);
    expect(JSON.parse(text)).toEqual({ ok: false, error: { code: "internal", message: "Errore interno." } });
  });

  it("anche un risultato di scarico malformato non fa uscire dettagli", async () => {
    const handler = createImportHandler({
      fetch: async () => ({ ok: false, code: "codice-sconosciuto" }) as unknown as FetchResult,
      perCaller: createRateLimiter({ limit: 5, windowMs: 1000 }),
    });
    expect((await handler(post({ url: PAGE }))).status).toBe(500);
  });
});

describe("POST /api/ricetta: limite di richieste", () => {
  it("rifiuta con 429 e Retry-After oltre il limite del chiamante", async () => {
    const { handler } = setup({ [PAGE]: { body: chunks(HTML_PLAIN) } }, undefined, 3);
    const results: number[] = [];
    for (let i = 0; i < 5; i++) results.push((await handler(post({ url: PAGE }))).status);
    expect(results).toEqual([200, 200, 200, 429, 429]);
    const r = await handler(post({ url: PAGE }));
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await json(r)).error as { code: string }).code).toBe("rate_limited");
  });

  it("conta anche le richieste rifiutate per altri motivi, e per chiamante", async () => {
    const { handler } = setup({ [PAGE]: { body: chunks(HTML_PLAIN) } }, undefined, 2);
    expect((await handler(post({ url: "http://x.example.com/" }))).status).toBe(400);
    expect((await handler(post({ url: "http://x.example.com/" }))).status).toBe(400);
    expect((await handler(post({ url: "http://x.example.com/" }))).status).toBe(429);
    expect((await handler(post({ url: PAGE }, { "x-forwarded-for": "198.51.100.1" }))).status).toBe(200);
  });

  it("c'è anche un limite complessivo contro chi cambia indirizzo a ogni richiesta", async () => {
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [PAGE]: {} });
    const handler = createImportHandler({
      fetch: createFetch(net),
      perCaller: createRateLimiter({ limit: 100, windowMs: 60_000 }),
      global: createRateLimiter({ limit: 2, windowMs: 60_000 }),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await handler(post({ url: PAGE }, { "x-forwarded-for": `198.51.100.${i + 1}` }))).status);
    expect(statuses).toEqual([200, 200, 429, 429]);
  });

  it("limita gli scarichi contemporanei", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [PAGE]: async () => (await gate, response({ body: chunks(HTML_PLAIN) })) });
    const handler = createImportHandler({ fetch: createFetch(net), perCaller: createRateLimiter({ limit: 100, windowMs: 1000 }), maxConcurrent: 1 });
    const first = handler(post({ url: PAGE }));
    await new Promise((r) => setTimeout(r, 10));
    const second = await handler(post({ url: PAGE }));
    expect(second.status).toBe(503);
    release();
    expect((await first).status).toBe(200);
    expect((await handler(post({ url: PAGE }))).status).toBe(200);
  });
});

