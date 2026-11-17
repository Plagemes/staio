import { describe, expect, it, vi } from "vitest";
import { AiError, type AiRequest } from "@/core/ai";
import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";

const KEY = "sk-ant-api03-SEGRETISSIMA-1234567890";
const request: AiRequest = { instructions: "i", text: "t", images: [], maxOutputTokens: 100 };
const okBody = { type: "message", model: "m", content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" };

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchOf = (handler: (init: RequestInit) => Response | Promise<Response>) =>
  vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => handler(init ?? {})) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const hang = (init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))));

async function fails(promise: Promise<unknown>): Promise<AiError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AiError);
    return error as AiError;
  }
  throw new Error("doveva fallire");
}

const anthropic = () => createAnthropicProvider({ apiKey: KEY, model: "m" });
const openai = () => createOpenAiProvider({ apiKey: "chiave-1234567", baseUrl: "https://api.example.com/v1", model: "m" });

describe("uso dichiarato dal fornitore", () => {
  it("un rifiuto con stato 200 porta con sé i token dichiarati", async () => {
    const f = fetchOf(() => reply({ ...okBody, content: [], stop_reason: "refusal", usage: { input_tokens: 900, output_tokens: 3 } }));
    const error = await fails(anthropic().call(request, { fetchImpl: f }));
    expect(error.kind).toBe("refused");
    expect(error.usage).toEqual({ inputTokens: 900, outputTokens: 3 });
  });

  it("anche una risposta vuota", async () => {
    const f = fetchOf(() => reply({ ...okBody, content: [], usage: { input_tokens: 700, output_tokens: 0 } }));
    const error = await fails(anthropic().call(request, { fetchImpl: f }));
    expect(error.kind).toBe("invalid_response");
    expect(error.usage).toEqual({ inputTokens: 700, outputTokens: 0 });
  });

  it("senza token dichiarati lo dice, e l'errore non inventa un uso", async () => {
    const response = await anthropic().call(request, { fetchImpl: fetchOf(() => reply(okBody)) });
    expect(response.usageReported).toBe(false);
    expect(response.usage).toEqual({ inputTokens: 0, outputTokens: 0 });
    const error = await fails(anthropic().call(request, { fetchImpl: fetchOf(() => reply({ ...okBody, content: [], stop_reason: "refusal" })) }));
    expect(error.usage).toBeUndefined();
  });

  it("compatibile OpenAI: filtro dei contenuti con token, o risposta senza token", async () => {
    const filtered = fetchOf(() => reply({ choices: [{ message: { content: null }, finish_reason: "content_filter" }], usage: { prompt_tokens: 50, completion_tokens: 1 } }));
    expect((await fails(openai().call(request, { fetchImpl: filtered }))).usage).toEqual({ inputTokens: 50, outputTokens: 1 });
    const silent = fetchOf(() => reply({ choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }));
    expect(await openai().call(request, { fetchImpl: silent })).toMatchObject({ usageReported: false, usage: { inputTokens: 0, outputTokens: 0 } });
  });
});

describe("chiamate interrotte", () => {
  it("scaduta o annullata dopo l'invio: segnata come partita", async () => {
    const timeout = await fails(anthropic().call(request, { fetchImpl: fetchOf(hang), timeoutMs: 10 }));
    expect(timeout).toMatchObject({ kind: "timeout", afterSend: true });
    const controller = new AbortController();
    const pending = fails(anthropic().call(request, { fetchImpl: fetchOf(hang), signal: controller.signal }));
    controller.abort();
    expect(await pending).toMatchObject({ kind: "aborted", afterSend: true });
  });

  it("già annullata prima di partire: non esce nulla e non è «partita»", async () => {
    const f = fetchOf(() => reply({}));
    const controller = new AbortController();
    controller.abort();
    const error = await fails(anthropic().call(request, { fetchImpl: f, signal: controller.signal }));
    expect(error.kind).toBe("aborted");
    expect(error.afterSend).toBeFalsy();
    expect(f).not.toHaveBeenCalled();
  });

  it("la rete assente non è «partita»", async () => {
    const f = fetchOf(() => {
      throw new TypeError("Failed to fetch");
    });
    expect((await fails(anthropic().call(request, { fetchImpl: f }))).afterSend).toBeFalsy();
  });
});
