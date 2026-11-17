import { describe, expect, it, vi } from "vitest";
import { AiError } from "@/core/ai";
import { callAi } from "./call";
import { readReceipt } from "./readReceipt";
import { buildReceiptEvents, toReviewLines } from "./receiptEvents";
import { describeAiError } from "./messages";
import { loadAiSettings, memorySettingsStore, setApiKey, updateAiSettings, type SettingsStore } from "./settings";

const KEY = "sk-ant-api03-SEGRETISSIMA-1234567890";
const NOW = "2026-11-17T09:30:00.000Z";
const request = { instructions: "i", text: "t", images: [], maxOutputTokens: 100 };

const receiptJson = JSON.stringify({
  store: "COOP",
  chain: "Coop",
  date: "2026-11-16",
  lines: [
    { raw: "YOGURT BIANCO 125G", name: "Yogurt bianco", quantity: 125, unit: "g", priceCents: 69, isFood: true, category: "yogurt" },
    { raw: "SCONTO", name: "Sconto", kind: "discount", priceCents: -9 },
    { raw: "PANE CASERECCIO", name: "Pane casereccio", priceCents: 180, isFood: true, category: "bread_fresh" },
    { raw: "CARTA CUCINA", name: "Carta cucina", priceCents: 250, isFood: false },
  ],
  totalCents: 490,
});

const anthropicOk = (text: string, usage = { input_tokens: 2000, output_tokens: 300 }, stop = "end_turn") =>
  new Response(JSON.stringify({ type: "message", model: "claude-sonnet-5-5", content: [{ type: "text", text }], stop_reason: stop, usage }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const fetchReturning = (make: () => Response) => vi.fn(async () => make()) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

async function configured(extra?: (s: Awaited<ReturnType<typeof loadAiSettings>>) => Awaited<ReturnType<typeof loadAiSettings>>): Promise<SettingsStore> {
  const store = memorySettingsStore();
  await setApiKey(store, "anthropic", KEY, NOW);
  if (extra) await updateAiSettings(store, extra, NOW);
  return store;
}

describe("callAi", () => {
  it("senza chiave non chiama nessuno", async () => {
    const fetchImpl = fetchReturning(() => anthropicOk("x"));
    await expect(callAi({ store: memorySettingsStore(), request, now: () => NOW, fetchImpl })).rejects.toMatchObject({ kind: "missing_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("chiama il fornitore scelto, conta i token e stima il costo dal listino", async () => {
    const store = await configured((s) => ({ ...s, priceList: { "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 } } }));
    const fetchImpl = fetchReturning(() => anthropicOk("ciao"));
    const result = await callAi({ store, request, now: () => NOW, fetchImpl });
    expect(result.response.text).toBe("ciao");
    expect(result.cost).toBeCloseTo((2000 * 2 + 300 * 10) / 1e6, 9);
    const settings = await loadAiSettings(store, NOW);
    expect(settings.usage).toMatchObject({ calls: 1, inputTokens: 2000, outputTokens: 300, unpricedCalls: 0 });
    expect(settings.usage.cost).toBeCloseTo(0.007, 9);
  });

  it("con il listino vuoto conta le chiamate e i token ma non inventa un costo", async () => {
    const store = await configured();
    const result = await callAi({ store, request, now: () => NOW, fetchImpl: fetchReturning(() => anthropicOk("ciao")) });
    expect(result.cost).toBeNull();
    expect((await loadAiSettings(store, NOW)).usage).toMatchObject({ calls: 1, cost: 0, unpricedCalls: 1 });
  });

  it("usa il modello economico se scelto", async () => {
    const store = await configured((s) => ({ ...s, anthropic: { ...s.anthropic, useCheapModel: true } }));
    const fetchImpl = fetchReturning(() => anthropicOk("ok"));
    await callAi({ store, request, now: () => NOW, fetchImpl });
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as { model: string };
    expect(body.model).toBe("claude-haiku-5-5");
  });

  it("una chiamata fallita non viene contata", async () => {
    const store = await configured();
    const fetchImpl = fetchReturning(() => new Response(JSON.stringify({ error: { message: "no" } }), { status: 401 }));
    await expect(callAi({ store, request, now: () => NOW, fetchImpl })).rejects.toMatchObject({ kind: "rejected_key" });
    expect((await loadAiSettings(store, NOW)).usage.calls).toBe(0);
  });

  it("con un tetto e il prezzo sconosciuto non parte nessuna chiamata", async () => {
    const store = await configured((s) => ({ ...s, monthlyCap: 5 }));
    const fetchImpl = fetchReturning(() => anthropicOk("x"));
    const error = await callAi({ store, request, now: () => NOW, fetchImpl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AiError);
    expect((error as AiError).kind).toBe("budget");
    expect((error as AiError).detail).toMatch(/listino/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("si ferma quando il mese ha raggiunto il tetto, e riparte il mese dopo", async () => {
    const store = await configured((s) => ({
      ...s,
      monthlyCap: 0.01,
      priceList: { "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 } },
    }));
    const fetchImpl = fetchReturning(() => anthropicOk("ok"));
    await callAi({ store, request, now: () => NOW, fetchImpl }); // costa 0,007
    await callAi({ store, request, now: () => NOW, fetchImpl }); // arriva a 0,014: il tetto è superato
    const blocked = await callAi({ store, request, now: () => NOW, fetchImpl }).catch((e: unknown) => e);
    expect((blocked as AiError).kind).toBe("budget");
    expect((blocked as AiError).detail).toMatch(/tetto/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await callAi({ store, request, now: () => "2026-12-01T08:00:00.000Z", fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("gli errori non contengono la chiave", async () => {
    const store = await configured();
    const fetchImpl = fetchReturning(() => new Response(JSON.stringify({ error: { message: `bad ${KEY}` } }), { status: 400 }));
    const error = (await callAi({ store, request, now: () => NOW, fetchImpl }).catch((e: unknown) => e)) as AiError;
    expect(JSON.stringify([error.message, error.detail, describeAiError(error, { provider: "anthropic" })])).not.toContain("SEGRETISSIMA");
  });
});

describe("lettura di uno scontrino, con risposte simulate", () => {
  const image = { mediaType: "image/jpeg" as const, dataBase64: "QUJD" };

  it("dalla foto agli acquisti da registrare", async () => {
    const store = await configured();
    const fetchImpl = fetchReturning(() => anthropicOk("Ecco:\n```json\n" + receiptJson + "\n```"));
    const result = await readReceipt({ store, images: [image], today: "2026-11-17", now: () => NOW, fetchImpl });

    const sent = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body)) as { system: string; messages: { content: { type: string; text?: string }[] }[] };
    expect(sent.system).toContain("scontrino");
    expect(sent.messages[0].content.map((c) => c.type)).toEqual(["image", "text"]);
    expect(sent.messages[0].content[1].text).toContain("2026-11-17");

    expect(result.check).toMatchObject({ status: "ok", sumCents: 490 });
    expect(result.reading.lines).toHaveLength(3);
    const lines = toReviewLines(result.reading);
    expect(lines.map((l) => l.include)).toEqual([true, true, false]);

    const built = buildReceiptEvents(lines, { store: "Coop", date: result.reading.date ?? "" }, { now: NOW, deviceId: "d" });
    if (!built.ok) throw new Error(JSON.stringify(built));
    expect(built.events.map((e) => [e.productRef, e.priceCents])).toEqual([["Yogurt bianco", 60], ["Pane casereccio", 180]]);
    expect(built.events.every((e) => e.receiptId === built.receiptId && e.at === "2026-11-16T12:00:00.000Z")).toBe(true);
  });

  it("risposta troncata: le righe recuperate arrivano con un avviso, e la lettura costa comunque", async () => {
    const store = await configured();
    const cut = receiptJson.slice(0, receiptJson.indexOf('{"raw":"SCONTO"') + 12);
    const fetchImpl = fetchReturning(() => anthropicOk(cut, { input_tokens: 2000, output_tokens: 8000 }, "max_tokens"));
    const result = await readReceipt({ store, images: [image], today: "2026-11-17", now: () => NOW, fetchImpl });
    expect(result.truncated).toBe(true);
    expect(result.reading.lines).toHaveLength(1);
    expect(result.reading.problems.some((p) => p.code === "truncated")).toBe(true);
    expect((await loadAiSettings(store, NOW)).usage.calls).toBe(1);
  });

  it("testo che non è uno scontrino: nessun errore, solo problemi", async () => {
    const store = await configured();
    const fetchImpl = fetchReturning(() => anthropicOk("Mi dispiace, la foto è troppo scura."));
    const result = await readReceipt({ store, images: [image], today: "2026-11-17", now: () => NOW, fetchImpl });
    expect(result.reading.lines).toEqual([]);
    expect(result.reading.problems[0].code).toBe("no_json");
  });

  it("rete assente e limite di richieste arrivano come errori dal messaggio chiaro", async () => {
    const store = await configured();
    const offline = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const e1 = (await readReceipt({ store, images: [image], today: "2026-11-17", now: () => NOW, fetchImpl: offline }).catch((e: unknown) => e)) as AiError;
    expect(e1.kind).toBe("network");
    expect(describeAiError(e1, { provider: "anthropic" })).toMatch(/connessione|rete/i);

    const limited = fetchReturning(() => new Response(JSON.stringify({ error: { message: "slow" } }), { status: 429, headers: { "retry-after": "20" } }));
    const e2 = (await readReceipt({ store, images: [image], today: "2026-11-17", now: () => NOW, fetchImpl: limited }).catch((e: unknown) => e)) as AiError;
    expect(describeAiError(e2, { provider: "anthropic" })).toContain("20 secondi");
  });
});

describe("messaggi", () => {
  it("ogni motivo ha una frase in italiano, senza dettagli dentro se non ce ne sono", () => {
    const kinds = [
      "missing_key", "rejected_key", "forbidden", "browser_not_allowed", "billing", "rate_limited", "network", "timeout", "aborted",
      "model_not_found", "bad_request", "request_too_large", "overloaded", "server", "refused", "invalid_response", "budget",
    ] as const;
    for (const kind of kinds) {
      const text = describeAiError(new AiError(kind), { provider: "anthropic", model: "m" });
      expect(text.length).toBeGreaterThan(10);
      expect(text).not.toContain("undefined");
    }
  });
});
