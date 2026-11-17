import { describe, expect, it } from "vitest";
import { callerKey, createFetch, createImportHandler, parseOrigins } from "./handler";
import { createRateLimiter } from "./rate-limit";
import { PUBLIC_V4, chunks, fakeNet } from "./test-helpers";

const HOST = "ricette.example.com";
const PAGE = `https://${HOST}/torta`;
const HTML_PLAIN = "<html><head><title>Una pagina</title></head><body><p>Testo.</p></body></html>";

function setup(options: { allowedOrigins?: readonly string[]; limit?: number } = {}) {
  const net = fakeNet({ [HOST]: [PUBLIC_V4] }, { [PAGE]: { body: chunks(HTML_PLAIN) } });
  const handler = createImportHandler({
    fetch: createFetch(net),
    perCaller: createRateLimiter({ limit: options.limit ?? 100, windowMs: 60_000 }),
    ...(options.allowedOrigins ? { allowedOrigins: options.allowedOrigins } : {}),
  });
  return { net, handler };
}

async function status(
  handler: ReturnType<typeof createImportHandler>,
  headers: Record<string, string | null>,
): Promise<number> {
  const h = new Headers({ "content-type": "application/json", "x-forwarded-for": "203.0.113.50" });
  for (const [k, v] of Object.entries(headers)) {
    if (v === null) h.delete(k);
    else h.set(k, v);
  }
  const r = await handler(new Request("https://app.example.org/api/ricetta", { method: "POST", headers: h, body: JSON.stringify({ url: PAGE }) }));
  return r.status;
}

describe("POST /api/ricetta: origine obbligatoria", () => {
  it("esige un'intestazione Origin uguale all'origine dell'app", async () => {
    const { handler, net } = setup();
    expect(await status(handler, { origin: "https://app.example.org" })).toBe(200);
    // curl o strumenti simili: nessuna intestazione
    expect(await status(handler, {})).toBe(403);
    expect(await status(handler, { origin: "" })).toBe(403);
    expect(await status(handler, { origin: "null" })).toBe(403);
    expect(await status(handler, { origin: "non un url" })).toBe(403);
    expect(await status(handler, { origin: "https://cattivo.example.net" })).toBe(403);
    expect(await status(handler, { origin: "http://app.example.org" })).toBe(403);
    expect(await status(handler, { origin: "https://app.example.org:8443" })).toBe(403);
    expect(await status(handler, { origin: "https://sub.app.example.org" })).toBe(403);
    expect(net.transport).toHaveBeenCalledTimes(1);
  });

  it("il rifiuto ha un codice fisso", async () => {
    const { handler } = setup();
    const r = await handler(
      new Request("https://app.example.org/api/ricetta", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://cattivo.example.net" },
        body: JSON.stringify({ url: PAGE }),
      }),
    );
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ ok: false, error: { code: "forbidden_origin" } });
  });

  it("Host e X-Forwarded-Host scelti dal cliente non aprono la rotta", async () => {
    const { handler } = setup();
    expect(await status(handler, { origin: "https://cattivo.example.net", host: "cattivo.example.net" })).toBe(403);
    expect(await status(handler, { origin: "https://cattivo.example.net", "x-forwarded-host": "cattivo.example.net" })).toBe(403);
    expect(await status(handler, { "sec-fetch-site": "same-origin" })).toBe(403);
  });

  it("ammette le origini elencate, ignorando le voci non valide", async () => {
    const { handler } = setup({ allowedOrigins: parseOrigins("https://staging.example.org, non-un-url, https://www.example.org/percorso") });
    expect(await status(handler, { origin: "https://staging.example.org" })).toBe(200);
    expect(await status(handler, { origin: "https://www.example.org" })).toBe(200);
    expect(await status(handler, { origin: "https://app.example.org" })).toBe(200);
    expect(await status(handler, { origin: "https://altro.example.org" })).toBe(403);
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins("javascript:alert(1)")).toEqual([]);
  });

  it("legge l'elenco dalla variabile d'ambiente quando non è passato", async () => {
    const previous = process.env.RECIPE_IMPORT_ALLOWED_ORIGINS;
    process.env.RECIPE_IMPORT_ALLOWED_ORIGINS = "https://staging.example.org";
    try {
      const { handler } = setup();
      expect(await status(handler, { origin: "https://staging.example.org" })).toBe(200);
      expect(await status(handler, { origin: "https://altro.example.org" })).toBe(403);
    } finally {
      if (previous === undefined) delete process.env.RECIPE_IMPORT_ALLOWED_ORIGINS;
      else process.env.RECIPE_IMPORT_ALLOWED_ORIGINS = previous;
    }
  });

  it("il rifiuto per origine avviene prima di ogni risoluzione e non consuma il limite", async () => {
    const { handler, net } = setup({ limit: 1 });
    expect(await status(handler, {})).toBe(403);
    expect(await status(handler, {})).toBe(403);
    expect(net.resolve).not.toHaveBeenCalled();
    expect(await status(handler, { origin: "https://app.example.org" })).toBe(200);
  });
});

describe("callerKey", () => {
  const h = (o: Record<string, string>) => new Headers(o);

  it("su Vercel usa solo x-vercel-forwarded-for e ignora le intestazioni scelte dal cliente", () => {
    const env = { VERCEL: "1" };
    expect(callerKey(h({ "x-vercel-forwarded-for": "203.0.113.5", "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }), env)).toBe("203.0.113.5");
    expect(callerKey(h({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }), env)).toBe("unknown");
    expect(callerKey(h({ "x-real-ip": "2.2.2.2" }), env)).toBe("unknown");
    expect(callerKey(h({ "x-vercel-forwarded-for": "non-un-ip" }), env)).toBe("unknown");
    expect(callerKey(h({ "x-vercel-forwarded-for": "2001:db8::1" }), env)).toBe("2001:db8::1");
  });

  it("fuori da Vercel usa la voce più a destra di x-forwarded-for, mai x-real-ip", () => {
    expect(callerKey(h({ "x-forwarded-for": "6.6.6.6, 7.7.7.7, 203.0.113.9" }), {})).toBe("203.0.113.9");
    expect(callerKey(h({ "x-forwarded-for": "203.0.113.9" }), {})).toBe("203.0.113.9");
    expect(callerKey(h({ "x-real-ip": "2.2.2.2", "x-vercel-forwarded-for": "3.3.3.3" }), {})).toBe("unknown");
    expect(callerKey(h({}), {})).toBe("unknown");
  });

  it("un cliente non cambia chiave aggiungendo voci a sinistra, quindi non aggira il limite", async () => {
    expect(callerKey(h({ "x-forwarded-for": "9.9.9.1, 203.0.113.9" }), {})).toBe(callerKey(h({ "x-forwarded-for": "9.9.9.2, 203.0.113.9" }), {}));
    const { handler } = setup({ limit: 2 });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) {
      codes.push(await status(handler, { origin: "https://app.example.org", "x-forwarded-for": `9.9.9.${i}, 203.0.113.9` }));
    }
    expect(codes).toEqual([200, 200, 429, 429]);
  });

  it("scarta valori non validi", () => {
    expect(callerKey(h({ "x-forwarded-for": "1.1.1.1; DROP TABLE" }), {})).toBe("unknown");
    expect(callerKey(h({ "x-forwarded-for": "1.1.1.1".padEnd(60, "1") }), {})).toBe("unknown");
    expect(callerKey(h({ "x-forwarded-for": "non-un-ip" }), {})).toBe("unknown");
  });

  it("senza argomento legge la variabile VERCEL dell'ambiente", () => {
    const previous = process.env.VERCEL;
    process.env.VERCEL = "1";
    try {
      expect(callerKey(h({ "x-forwarded-for": "1.1.1.1" }))).toBe("unknown");
      expect(callerKey(h({ "x-vercel-forwarded-for": "203.0.113.5" }))).toBe("203.0.113.5");
    } finally {
      if (previous === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = previous;
    }
  });
});
