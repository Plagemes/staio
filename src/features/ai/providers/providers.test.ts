import { describe, expect, it, vi } from "vitest";
import { AiError, type AiRequest } from "@/core/ai";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";

const KEY = "sk-ant-api03-SEGRETISSIMA-1234567890";
const OPENAI_KEY = "sk-proj-ZZZZZZZZZZZZZZZZ9876";

const request: AiRequest = {
  instructions: "Rispondi in JSON.",
  text: "Ecco la foto.",
  images: [{ mediaType: "image/jpeg", dataBase64: "QUJDRA==" }],
  maxOutputTokens: 4000,
};

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

/** `fetch` simulato: nessuna chiamata di rete vera. */
function fakeFetch(...handlers: Handler[]) {
  let i = 0;
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ url, init: init ?? {}, body });
    const handler = handlers[Math.min(i, handlers.length - 1)];
    i += 1;
    return handler(url, init ?? {});
  });
  return { impl: impl as unknown as typeof fetch, calls, spy: impl };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const headersOf = (init: RequestInit) => init.headers as Record<string, string>;

async function failure(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error("doveva fallire");
}

/** Nulla di ciò che l'errore espone deve contenere pezzi della chiave. */
function expectNoLeak(error: AiError, ...secrets: string[]) {
  const everything = JSON.stringify({ m: error.message, d: error.detail, s: String(error.stack), k: error.kind });
  for (const secret of secrets) {
    expect(everything).not.toContain(secret);
    expect(everything).not.toContain(secret.slice(6, 16));
  }
}

describe("Anthropic", () => {
  const ok = {
    id: "msg_1",
    type: "message",
    model: "claude-sonnet-5-5",
    role: "assistant",
    content: [
      { type: "thinking", thinking: "", signature: "x" },
      { type: "text", text: '{"lines":[]}' },
    ],
    stop_reason: "end_turn",
    usage: { input_tokens: 1800, output_tokens: 320 },
  };

  it("chiama l'API Messages dal browser con le intestazioni giuste e legge la risposta", async () => {
    const f = fakeFetch(() => json(ok));
    const provider = createAnthropicProvider({ apiKey: ` ${KEY} `, model: "claude-sonnet-5-5" });
    const response = await provider.call(request, { fetchImpl: f.impl });

    expect(response).toEqual({
      text: '{"lines":[]}',
      usage: { inputTokens: 1800, outputTokens: 320 },
      model: "claude-sonnet-5-5",
      truncated: false,
      usageReported: true,
    });
    const [call] = f.calls;
    expect(call.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call.init.method).toBe("POST");
    expect(headersOf(call.init)).toMatchObject({
      "x-api-key": KEY,
      "anthropic-version": "2026-10-21",
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    });
    expect(call.init.credentials).toBe("omit");
    expect(call.body).toEqual({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      system: "Rispondi in JSON.",
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "QUJDRA==" } },
            { type: "text", text: "Ecco la foto." },
          ],
        },
      ],
    });
    // niente parametri di campionamento né tool: non servono e alcuni modelli li rifiutano
    expect(Object.keys(call.body).sort()).toEqual(["max_tokens", "messages", "model", "system"]);
  });

  it("la chiave non va mai nell'indirizzo", async () => {
    const f = fakeFetch(() => json(ok));
    await createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl });
    expect(f.calls[0].url).not.toContain("sk-");
    expect(f.calls[0].url).not.toContain("?");
  });

  it("aggiunge l'area di lavoro solo se indicata", async () => {
    const f = fakeFetch(() => json(ok));
    await createAnthropicProvider({ apiKey: KEY, model: "m", workspaceId: "wrkspc_123" }).call(request, { fetchImpl: f.impl });
    await createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl });
    expect(headersOf(f.calls[0].init)["anthropic-workspace-id"]).toBe("wrkspc_123");
    expect(headersOf(f.calls[1].init)["anthropic-workspace-id"]).toBeUndefined();
  });

  it("risposta troncata dal limite di lunghezza", async () => {
    const f = fakeFetch(() => json({ ...ok, content: [{ type: "text", text: '{"lines":[{"name":"Pa' }], stop_reason: "max_tokens" }));
    const response = await createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl });
    expect(response.truncated).toBe(true);
    expect(response.text).toContain("Pa");
  });

  it("chiave mancante: non parte nessuna chiamata", async () => {
    const f = fakeFetch(() => json(ok));
    const error = await failure(createAnthropicProvider({ apiKey: "  ", model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("missing_key");
    expect(f.spy).not.toHaveBeenCalled();
  });

  it("chiave rifiutata (401), senza ripetere ciò che dice il fornitore", async () => {
    const f = fakeFetch(() => json({ type: "error", error: { type: "authentication_error", message: `invalid x-api-key ${KEY}` } }, 401));
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("rejected_key");
    expect(error.status).toBe(401);
    expectNoLeak(error, KEY);
  });

  it("organizzazione che non ammette il browser", async () => {
    const f = fakeFetch(() =>
      json({ type: "error", error: { type: "authentication_error", message: "CORS requests are not allowed for this Organization because ..." } }, 401),
    );
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("browser_not_allowed");
  });

  it("limite di richieste (429) con l'attesa indicata", async () => {
    const f = fakeFetch(() =>
      json({ type: "error", error: { type: "rate_limit_error", message: "Number of requests has exceeded your rate limit" } }, 429, { "retry-after": "30" }),
    );
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterSeconds).toBe(30);
  });

  it("limite di richieste senza intestazione di attesa", async () => {
    const f = fakeFetch(() => json({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, 429));
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("rate_limited");
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  it.each([
    [400, "Your credit balance is too low to access the Anthropic API.", "billing"],
    [402, "payment", "billing"],
    [400, "messages: roles must alternate", "bad_request"],
    [403, "Not allowed", "forbidden"],
    [404, "model: claude-nope", "model_not_found"],
    [413, "too big", "request_too_large"],
    [500, "oops", "server"],
    [529, "Overloaded", "overloaded"],
  ])("stato %i -> %s", async (status, message, kind) => {
    const f = fakeFetch(() => json({ type: "error", error: { type: "x", message } }, status));
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe(kind);
    expect(error.status).toBe(status);
  });

  it("un messaggio d'errore che ripete la chiave viene ripulito", async () => {
    const f = fakeFetch(() => json({ type: "error", error: { type: "invalid_request_error", message: `bad thing near ${KEY} sorry` } }, 400));
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("bad_request");
    expect(error.detail).toContain("bad thing");
    expectNoLeak(error, KEY);
  });

  it("rete assente", async () => {
    const f = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("network");
    expect(error.status).toBeUndefined();
  });

  it("annullata dall'utente", async () => {
    const controller = new AbortController();
    const f = fakeFetch((_url, init) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError")))));
    const pending = failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl, signal: controller.signal }));
    controller.abort();
    expect((await pending).kind).toBe("aborted");
  });

  it("nessuna risposta entro il tempo massimo", async () => {
    const f = fakeFetch((_url, init) => new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError")))));
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl, timeoutMs: 20 }));
    expect(error.kind).toBe("timeout");
  });

  it("rifiuto del modello (refusal)", async () => {
    const f = fakeFetch(() => json({ ...ok, content: [], stop_reason: "refusal", stop_details: { type: "refusal", category: null, explanation: "non posso" } }));
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("refused");
  });

  it.each([[{}], [{ content: "testo" }], [{ ...ok, content: [{ type: "thinking", thinking: "" }] }]])("risposta fuori formato %j", async (body) => {
    const f = fakeFetch(() => json(body));
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("invalid_response");
  });

  it("corpo non JSON con stato 200", async () => {
    const f = fakeFetch(() => new Response("<html>", { status: 200 }));
    const error = await failure(createAnthropicProvider({ apiKey: KEY, model: "m" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("invalid_response");
  });
});

describe("compatibile con OpenAI", () => {
  const config = { apiKey: OPENAI_KEY, baseUrl: "https://api.example.com/v1/", model: "modello-visione" };
  const ok = {
    id: "chatcmpl-1",
    model: "modello-visione-2026",
    choices: [{ index: 0, message: { role: "assistant", content: '{"lines":[]}' }, finish_reason: "stop" }],
    usage: { prompt_tokens: 2100, completion_tokens: 410, total_tokens: 2510 },
  };

  it("chiama /chat/completions dell'indirizzo scelto e legge la risposta", async () => {
    const f = fakeFetch(() => json(ok));
    const response = await createOpenAiProvider(config).call(request, { fetchImpl: f.impl });
    expect(response).toEqual({
      text: '{"lines":[]}',
      usage: { inputTokens: 2100, outputTokens: 410 },
      model: "modello-visione-2026",
      truncated: false,
      usageReported: true,
    });
    const [call] = f.calls;
    expect(call.url).toBe("https://api.example.com/v1/chat/completions");
    expect(headersOf(call.init).authorization).toBe(`Bearer ${OPENAI_KEY}`);
    expect(call.url).not.toContain("sk-");
    expect(call.body).toEqual({
      model: "modello-visione",
      max_completion_tokens: 4000,
      messages: [
        { role: "system", content: "Rispondi in JSON." },
        {
          role: "user",
          content: [
            { type: "text", text: "Ecco la foto." },
            { type: "image_url", image_url: { url: "data:image/jpeg;base64,QUJDRA==" } },
          ],
        },
      ],
    });
  });

  it("usa il nome del limite scelto", async () => {
    const f = fakeFetch(() => json(ok));
    await createOpenAiProvider({ ...config, tokenParam: "max_tokens" }).call(request, { fetchImpl: f.impl });
    expect(f.calls[0].body.max_tokens).toBe(4000);
    expect(f.calls[0].body.max_completion_tokens).toBeUndefined();
  });

  it("se il servizio conosce l'altro nome del limite, riprova una volta con quello", async () => {
    const f = fakeFetch(
      () => json({ error: { message: "Unsupported parameter: 'max_completion_tokens'. Use 'max_tokens' instead." } }, 400),
      () => json(ok),
    );
    const response = await createOpenAiProvider(config).call(request, { fetchImpl: f.impl });
    expect(response.text).toBe('{"lines":[]}');
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1].body.max_tokens).toBe(4000);
    expect(f.calls[1].body.max_completion_tokens).toBeUndefined();
  });

  it("non riprova all'infinito", async () => {
    const f = fakeFetch(() => json({ error: { message: "max_tokens is not valid" } }, 400));
    const error = await failure(createOpenAiProvider(config).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("bad_request");
    expect(f.calls).toHaveLength(2);
  });

  it("legge il contenuto anche in parti", async () => {
    const f = fakeFetch(() =>
      json({ ...ok, choices: [{ message: { content: [{ type: "text", text: "{" }, { type: "text", text: "}" }] }, finish_reason: "stop" }] }),
    );
    expect((await createOpenAiProvider(config).call(request, { fetchImpl: f.impl })).text).toBe("{}");
  });

  it("risposta troncata (finish_reason length)", async () => {
    const f = fakeFetch(() => json({ ...ok, choices: [{ message: { content: '{"lines":[{"na' }, finish_reason: "length" }] }));
    expect((await createOpenAiProvider(config).call(request, { fetchImpl: f.impl })).truncated).toBe(true);
  });

  it("chiave mancante", async () => {
    const f = fakeFetch(() => json(ok));
    const error = await failure(createOpenAiProvider({ ...config, apiKey: "" }).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("missing_key");
    expect(f.spy).not.toHaveBeenCalled();
  });

  it("chiave rifiutata, anche se il servizio ne ripete un pezzo", async () => {
    const f = fakeFetch(() => json({ error: { message: "Incorrect API key provided: sk-proj-****9876. You can find your API key at ...", type: "invalid_request_error" } }, 401));
    const error = await failure(createOpenAiProvider(config).call(request, { fetchImpl: f.impl }));
    expect(error.kind).toBe("rejected_key");
    expectNoLeak(error, OPENAI_KEY);
    expect(JSON.stringify(error.detail ?? "")).not.toContain("9876");
  });

  it("limite di richieste e credito esaurito, entrambi 429", async () => {
    const limit = fakeFetch(() => json({ error: { message: "Rate limit reached for requests" } }, 429, { "retry-after": "7" }));
    const e1 = await failure(createOpenAiProvider(config).call(request, { fetchImpl: limit.impl }));
    expect(e1).toMatchObject({ kind: "rate_limited", retryAfterSeconds: 7 });

    const quota = fakeFetch(() => json({ error: { message: "You exceeded your current quota, please check your plan and billing details.", code: "insufficient_quota" } }, 429));
    const e2 = await failure(createOpenAiProvider(config).call(request, { fetchImpl: quota.impl }));
    expect(e2.kind).toBe("billing");
  });

  it("modello sconosciuto, servizio che non va, rete assente", async () => {
    const notFound = fakeFetch(() => json({ error: { message: "The model `x` does not exist" } }, 404));
    expect((await failure(createOpenAiProvider(config).call(request, { fetchImpl: notFound.impl }))).kind).toBe("model_not_found");
    const down = fakeFetch(() => json({ error: { message: "bad gateway" } }, 502));
    expect((await failure(createOpenAiProvider(config).call(request, { fetchImpl: down.impl }))).kind).toBe("server");
    const offline = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    expect((await failure(createOpenAiProvider(config).call(request, { fetchImpl: offline.impl }))).kind).toBe("network");
  });

  it("indirizzo non valido o in chiaro: non parte nessuna chiamata", async () => {
    const f = fakeFetch(() => json(ok));
    for (const baseUrl of ["", "api.example.com", "http://api.example.com/v1"]) {
      const error = await failure(createOpenAiProvider({ ...config, baseUrl }).call(request, { fetchImpl: f.impl }));
      expect(error.kind).toBe("bad_request");
    }
    expect(f.spy).not.toHaveBeenCalled();
  });

  it("filtro dei contenuti", async () => {
    const f = fakeFetch(() => json({ ...ok, choices: [{ message: { content: null }, finish_reason: "content_filter" }] }));
    expect((await failure(createOpenAiProvider(config).call(request, { fetchImpl: f.impl }))).kind).toBe("refused");
  });

  it("risposta fuori formato", async () => {
    const f = fakeFetch(() => json({ choices: [] }));
    expect((await failure(createOpenAiProvider(config).call(request, { fetchImpl: f.impl }))).kind).toBe("invalid_response");
  });
});
