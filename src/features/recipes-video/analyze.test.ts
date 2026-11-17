import { describe, expect, it, vi } from "vitest";
import { memorySettingsStore, setApiKey, updateAiSettings } from "../ai/settings";
import { readVideo } from "./analyze";

const NOW = "2026-11-17T09:30:00.000Z";
const KEY = "sk-ant-api03-SEGRETISSIMA-1234567890";
const frame = { mediaType: "image/jpeg" as const, dataBase64: `/9j/${"A".repeat(200)}` };
const video = { caption: "Uova al tegamino", frames: [frame], durationSec: 20 };

const answer = JSON.stringify({ isRecipe: true, ingredients: [{ name: "uova", quantity: 2 }], steps: [{ text: "Cuoci." }] });
const anthropicOk = (text: string) =>
  new Response(
    JSON.stringify({ type: "message", model: "claude-sonnet-5-5", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 3000, output_tokens: 200 } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

describe("readVideo", () => {
  it("senza chiave non chiama nessuno", async () => {
    const fetchImpl = vi.fn();
    await expect(readVideo({ store: memorySettingsStore(), video, now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ kind: "missing_key" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rispetta il tetto di spesa", async () => {
    const store = memorySettingsStore();
    await setApiKey(store, "anthropic", KEY, NOW);
    await updateAiSettings(
      store,
      (s) => ({ ...s, monthlyCap: 1, priceList: { "claude-sonnet-5-5": { inputPerMTok: 3, outputPerMTok: 15 } }, usage: { ...s.usage, month: "2026-11", cost: 5 } }),
      NOW,
    );
    const fetchImpl = vi.fn();
    await expect(readVideo({ store, video, now: () => NOW, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toMatchObject({ kind: "budget" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("chiama il fornitore, legge la risposta e conta l'uso", async () => {
    const store = memorySettingsStore();
    await setApiKey(store, "anthropic", KEY, NOW);
    const fetchImpl = vi.fn(async () => anthropicOk(answer)) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const r = await readVideo({ store, video, now: () => NOW, fetchImpl });
    expect(r.reading.isRecipe).toBe(true);
    expect(r.reading.recipe?.ingredients[0]).toMatchObject({ name: "uova", quantity: { value: 2, unit: "pz" } });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("api.anthropic.com");
    expect(String(init.body)).toContain("Uova al tegamino");
    expect(String(init.body)).toContain("image/jpeg");
  });

  it("una risposta illeggibile non è un errore: diventa problemi", async () => {
    const store = memorySettingsStore();
    await setApiKey(store, "anthropic", KEY, NOW);
    const r = await readVideo({ store, video, now: () => NOW, fetchImpl: vi.fn(async () => anthropicOk("Non posso aiutarti.")) as unknown as typeof fetch });
    expect(r.reading.isRecipe).toBe(false);
    expect(r.reading.problems.length).toBeGreaterThan(0);
  });
});
