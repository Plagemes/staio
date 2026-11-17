// Prove con risposte simulate: nessuna chiamata a un fornitore vero.
import { describe, expect, it, vi } from "vitest";
import { loadAiSettings, memorySettingsStore, setApiKey, updateAiSettings, type SettingsStore } from "../ai/settings";
import { askAssistant } from "./ask";

const KEY = "sk-ant-api03-SEGRETISSIMA-1234567890";
const NOW = "2026-11-17T09:30:00.000Z";

const GOOD = JSON.stringify({
  title: "Il ferro",
  blocks: [{ type: "figure", label: "Ferro, media", query: { name: "nutrient_average", params: { nutrient: "ironMg", period: "last_30_days" } } }],
});

const anthropicOk = (text: string, stop = "end_turn") =>
  new Response(JSON.stringify({ type: "message", model: "claude-sonnet-5-5", content: [{ type: "text", text }], stop_reason: stop, usage: { input_tokens: 2000, output_tokens: 300 } }), {
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

const ask = (store: SettingsStore, fetchImpl: typeof fetch, question = "com'è andato il ferro questo mese?") => askAssistant({ store, question, now: () => NOW, fetchImpl });

describe("askAssistant", () => {
  it("una risposta buona diventa una vista; al fornitore va solo la domanda con il catalogo", async () => {
    const fetchImpl = fetchReturning(() => anthropicOk(GOOD));
    const out = await ask(await configured(), fetchImpl);
    expect(out.kind).toBe("answer");
    if (out.kind !== "answer") return;
    expect(out.outcome.kind).toBe("view");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const body = String(init.body);
    expect(body).toContain("com'è andato il ferro questo mese?");
    expect(body).toContain("nutrient_average");
    expect(body).not.toContain(KEY);
  });

  it("senza chiave non chiama nessuno e manda alle impostazioni", async () => {
    const fetchImpl = fetchReturning(() => anthropicOk(GOOD));
    const out = await ask(memorySettingsStore(), fetchImpl);
    expect(out).toMatchObject({ kind: "error", needsSettings: true });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("con il tetto raggiunto non parte la chiamata e lo dice", async () => {
    const store = await configured((s) => ({ ...s, monthlyCap: 0.001, priceList: { "claude-sonnet-5-5": { inputPerMTok: 2, outputPerMTok: 10 } } }));
    const fetchImpl = fetchReturning(() => anthropicOk(GOOD));
    expect((await ask(store, fetchImpl)).kind).toBe("answer"); // la prima passa e supera il tetto
    const blocked = await ask(store, fetchImpl);
    expect(blocked).toMatchObject({ kind: "error", needsSettings: true });
    if (blocked.kind === "error") expect(blocked.message).toMatch(/tetto/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("una risposta non valida arriva come esito con i motivi, non come errore né come schermata vuota", async () => {
    const out = await ask(await configured(), fetchReturning(() => anthropicOk('{"title":"x","blocks":[{"type":"iframe"}]}')));
    expect(out.kind).toBe("answer");
    if (out.kind === "answer") {
      expect(out.outcome.kind).toBe("invalid");
      if (out.outcome.kind === "invalid") expect(out.outcome.problems.length).toBeGreaterThan(0);
    }
    const prose = await ask(await configured(), fetchReturning(() => anthropicOk("Certo! Il ferro va benissimo.")));
    expect(prose.kind === "answer" && prose.outcome.kind).toBe("invalid");
  });

  it("una risposta tagliata dal limite di lunghezza è segnalata come tale", async () => {
    const out = await ask(await configured(), fetchReturning(() => anthropicOk(GOOD.slice(0, 60), "max_tokens")));
    expect(out.kind === "answer" && out.outcome).toMatchObject({ kind: "invalid", reason: "truncated" });
  });

  it("«non so rispondere» passa com'è", async () => {
    const out = await ask(await configured(), fetchReturning(() => anthropicOk('{"unsupported":"Non so quanto costano i ristoranti."}')));
    expect(out.kind === "answer" && out.outcome).toMatchObject({ kind: "unsupported" });
  });

  it("gli errori del fornitore sono frasi italiane senza la chiave", async () => {
    const store = await configured();
    const out = await ask(store, fetchReturning(() => new Response(JSON.stringify({ error: { message: `bad key ${KEY}` } }), { status: 401 })));
    expect(out.kind).toBe("error");
    if (out.kind === "error") {
      expect(out.message).not.toContain(KEY);
      expect(out.needsSettings).toBe(true);
    }
    const rate = await ask(store, fetchReturning(() => new Response("{}", { status: 429 })));
    expect(rate).toMatchObject({ kind: "error", needsSettings: false });
    const down = await ask(store, (async () => {
      throw new TypeError("rete assente");
    }) as unknown as typeof fetch);
    expect(down.kind).toBe("error");
  });

  it("una domanda troppo corta non parte", async () => {
    const fetchImpl = fetchReturning(() => anthropicOk(GOOD));
    expect((await ask(await configured(), fetchImpl, "  a ")).kind).toBe("error");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
