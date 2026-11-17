import { describe, expect, it, vi } from "vitest";
import { AiError, estimateUsage } from "@/core/ai";
import { callAi } from "./call";
import { describeAiError } from "./messages";
import { loadAiSettings, memorySettingsStore, setApiKey, updateAiSettings } from "./settings";

const NOW = "2026-11-17T09:30:00.000Z";
const KEY = "sk-ant-api03-SEGRETISSIMA-1234567890";
const image = { mediaType: "image/jpeg" as const, dataBase64: "A".repeat(100_000) };
const request = { instructions: "istruzioni", text: "testo", images: [image], maxOutputTokens: 8000 };
const expected = estimateUsage(request);
const PRICE = { "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 } };

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fetchOf = (handler: (init: RequestInit) => Response | Promise<Response>) =>
  vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => handler(init ?? {})) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
const hang = (init: RequestInit) =>
  new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("x", "AbortError"))));
const ok = (usage?: { input_tokens: number; output_tokens: number }) =>
  reply({ type: "message", model: "claude-sonnet-5-5", content: [{ type: "text", text: "ciao" }], stop_reason: "end_turn", ...(usage ? { usage } : {}) });

async function configured(cap: number | null = null, priced = true) {
  const store = memorySettingsStore();
  await setApiKey(store, "anthropic", KEY, NOW);
  await updateAiSettings(store, (s) => ({ ...s, monthlyCap: cap, priceList: priced ? PRICE : {} }), NOW);
  return store;
}
const usageOf = async (store: Awaited<ReturnType<typeof configured>>) => (await loadAiSettings(store, NOW)).usage;
const fails = async (p: Promise<unknown>) => (await p.catch((e: unknown) => e)) as AiError;

describe("una chiamata pagata viene sempre contata", () => {
  it("rifiuto del modello con stato 200: conta i token dichiarati", async () => {
    const store = await configured();
    const f = fetchOf(() => reply({ content: [], stop_reason: "refusal", usage: { input_tokens: 900, output_tokens: 3 } }));
    const error = await fails(callAi({ store, request, now: () => NOW, fetchImpl: f }));
    expect(error.kind).toBe("refused");
    expect(await usageOf(store)).toMatchObject({ calls: 1, inputTokens: 900, outputTokens: 3, estimatedCalls: 0 });
    expect(describeAiError(error, { provider: "anthropic" })).toMatch(/contata/);
  });

  it("risposta vuota con stato 200: contata, con i token dichiarati o con una stima", async () => {
    const withTokens = await configured();
    await fails(callAi({ store: withTokens, request, now: () => NOW, fetchImpl: fetchOf(() => reply({ content: [], stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 0 } })) }));
    expect(await usageOf(withTokens)).toMatchObject({ calls: 1, inputTokens: 500, estimatedCalls: 0 });

    const without = await configured();
    await fails(callAi({ store: without, request, now: () => NOW, fetchImpl: fetchOf(() => reply({ content: [], stop_reason: "end_turn" })) }));
    expect(await usageOf(without)).toMatchObject({ calls: 1, inputTokens: expected.inputTokens, outputTokens: expected.outputTokens, estimatedCalls: 1 });
  });

  it("annullata dopo l'invio: stima prudente, dichiarata tale", async () => {
    const store = await configured();
    const controller = new AbortController();
    const f = fetchOf(hang);
    const pending = fails(callAi({ store, request, now: () => NOW, fetchImpl: f, signal: controller.signal }));
    await vi.waitFor(() => expect(f).toHaveBeenCalled());
    controller.abort();
    const error = await pending;
    expect(error.kind).toBe("aborted");
    expect(await usageOf(store)).toMatchObject({ calls: 1, inputTokens: expected.inputTokens, outputTokens: expected.outputTokens, estimatedCalls: 1 });
    expect(describeAiError(error, { provider: "anthropic" })).toMatch(/stima/);
  });

  it("scaduta dopo l'invio: stima prudente", async () => {
    const store = await configured();
    const error = await fails(callAi({ store, request, now: () => NOW, fetchImpl: fetchOf(hang), timeoutMs: 10 }));
    expect(error.kind).toBe("timeout");
    expect(await usageOf(store)).toMatchObject({ calls: 1, estimatedCalls: 1 });
  });

  it("già annullata prima di partire, rete assente o chiave rifiutata: non si conta niente", async () => {
    const store = await configured();
    const controller = new AbortController();
    controller.abort();
    await fails(callAi({ store, request, now: () => NOW, fetchImpl: fetchOf(() => ok()), signal: controller.signal }));
    await fails(callAi({ store, request, now: () => NOW, fetchImpl: fetchOf(() => { throw new TypeError("Failed to fetch"); }) }));
    await fails(callAi({ store, request, now: () => NOW, fetchImpl: fetchOf(() => reply({ error: { message: "no" } }, 401)) }));
    expect((await usageOf(store)).calls).toBe(0);
  });
});

describe("il tetto regge anche senza token dichiarati", () => {
  it("una risposta senza token si conta come stima prudente, e lo dice", async () => {
    const store = await configured(5);
    const result = await callAi({ store, request, now: () => NOW, fetchImpl: fetchOf(() => ok()) });
    expect(result.usageEstimated).toBe(true);
    expect(result.usage).toEqual(expected);
    expect(result.cost).toBeCloseTo((expected.inputTokens * 2 + expected.outputTokens * 10) / 1e6, 9);
    expect(await usageOf(store)).toMatchObject({ calls: 1, estimatedCalls: 1, inputTokens: expected.inputTokens });
  });

  it("con i token dichiarati si contano quelli, non la stima", async () => {
    const store = await configured(5);
    const result = await callAi({ store, request, now: () => NOW, fetchImpl: fetchOf(() => ok({ input_tokens: 1000, output_tokens: 100 })) });
    expect(result.usageEstimated).toBe(false);
    expect(result.usage).toEqual({ inputTokens: 1000, outputTokens: 100 });
  });

  it("un servizio che non dichiara mai i token non aggira il tetto", async () => {
    const perCall = (expected.inputTokens * 2 + expected.outputTokens * 10) / 1e6; // circa 0,08
    const store = await configured(perCall * 2.5);
    const f = fetchOf(() => ok());
    await callAi({ store, request, now: () => NOW, fetchImpl: f });
    await callAi({ store, request, now: () => NOW, fetchImpl: f });
    await callAi({ store, request, now: () => NOW, fetchImpl: f }); // 3 x perCall supera il tetto di 2,5
    const blocked = await fails(callAi({ store, request, now: () => NOW, fetchImpl: f }));
    expect(blocked.kind).toBe("budget");
    expect(f).toHaveBeenCalledTimes(3);
  });

  it("senza tetto e senza listino la stima conta comunque i token, segnata come stima", async () => {
    const store = await configured(null, false);
    const result = await callAi({ store, request, now: () => NOW, fetchImpl: fetchOf(() => ok()) });
    expect(result.cost).toBeNull();
    expect(await usageOf(store)).toMatchObject({ calls: 1, cost: 0, unpricedCalls: 1, estimatedCalls: 1 });
  });
});

describe("uso dichiarato a zero", () => {
  const zeros = [
    { input_tokens: 0, output_tokens: 0 },
    { input_tokens: 0, output_tokens: 120 },
    { input_tokens: 900, output_tokens: 0 },
  ];

  it.each(zeros)("%j vale come non dichiarato: si conta la stima, segnata come tale", async (usage) => {
    const store = await configured(5);
    const result = await callAi({ store, request, now: () => NOW, fetchImpl: fetchOf(() => ok(usage)) });
    expect(result.usageEstimated).toBe(true);
    expect(result.usage).toEqual(expected);
    expect(await usageOf(store)).toMatchObject({ calls: 1, estimatedCalls: 1, inputTokens: expected.inputTokens });
  });

  it("un servizio che dichiara sempre zero non aggira il tetto (5 chiamate)", async () => {
    const perCall = (expected.inputTokens * 2 + expected.outputTokens * 10) / 1e6;
    const store = await configured(perCall * 2.5);
    const f = fetchOf(() => ok({ input_tokens: 0, output_tokens: 0 }));
    let blockedAt = 0;
    for (let i = 1; i <= 5; i++) {
      const error = await callAi({ store, request, now: () => NOW, fetchImpl: f }).then(() => null, (e: unknown) => e as AiError);
      if (error) {
        expect(error.kind).toBe("budget");
        blockedAt = i;
        break;
      }
    }
    expect(blockedAt).toBe(4);
    expect(f).toHaveBeenCalledTimes(3);
    expect((await usageOf(store)).cost).toBeGreaterThan(0);
  });

  it("un rifiuto con zero token in ingresso conta la stima; con ingresso dichiarato conta quello", async () => {
    const a = await configured();
    await fails(callAi({ store: a, request, now: () => NOW, fetchImpl: fetchOf(() => reply({ content: [], stop_reason: "refusal", usage: { input_tokens: 0, output_tokens: 0 } })) }));
    expect(await usageOf(a)).toMatchObject({ calls: 1, inputTokens: expected.inputTokens, estimatedCalls: 1 });
    const b = await configured();
    await fails(callAi({ store: b, request, now: () => NOW, fetchImpl: fetchOf(() => reply({ content: [], stop_reason: "refusal", usage: { input_tokens: 900, output_tokens: 0 } })) }));
    expect(await usageOf(b)).toMatchObject({ calls: 1, inputTokens: 900, outputTokens: 0, estimatedCalls: 0 });
  });
});
