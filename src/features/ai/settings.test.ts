import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { appendEvents, exportBackup, wipeAll } from "@/data";
import { getDb } from "@/data/db";
import { purchase, q } from "@/core/ledger/test-helpers";
import {
  AI_SETTINGS_KEY,
  DEFAULT_ANTHROPIC_CHEAP_MODEL,
  DEFAULT_ANTHROPIC_MODEL,
  activeModel,
  checkApiKey,
  clearApiKey,
  configIssue,
  defaultAiSettings,
  dexieSettingsStore,
  isPriceKnown,
  loadAiSettings,
  maskKey,
  memorySettingsStore,
  normalizeSettings,
  providerFor,
  recordCall,
  setApiKey,
  updateAiSettings,
} from "./settings";

const NOV = "2026-11-17T10:00:00.000Z";
const KEY = "sk-ant-api03-ABCDEFGHIJKLMNOP-1234";

describe("valori iniziali", () => {
  it("modelli iniziali, nessuna chiave, nessun tetto, listino vuoto", () => {
    const s = defaultAiSettings("2026-11");
    expect(s.provider).toBe("anthropic");
    expect(s.anthropic.model).toBe(DEFAULT_ANTHROPIC_MODEL);
    expect(s.anthropic.cheapModel).toBe(DEFAULT_ANTHROPIC_CHEAP_MODEL);
    expect(DEFAULT_ANTHROPIC_MODEL).toBe("claude-sonnet-5-5");
    expect(DEFAULT_ANTHROPIC_CHEAP_MODEL).toBe("claude-haiku-5-5");
    expect(s.anthropic.apiKey).toBe("");
    expect(s.openai.apiKey).toBe("");
    expect(s.monthlyCap).toBeNull();
    expect(s.priceList).toEqual({});
    expect(s.usage).toMatchObject({ month: "2026-11", calls: 0 });
  });

  it("non c'è nessun prezzo scritto nel codice: il listino iniziale è vuoto e il costo è sconosciuto", () => {
    expect(isPriceKnown(defaultAiSettings("2026-11"))).toBe(false);
  });
});

describe("normalizeSettings", () => {
  it("regge qualunque cosa ci sia sul disco", () => {
    for (const raw of [undefined, null, 5, "x", [], { provider: 7, anthropic: "no", openai: [], usage: "boh", priceList: 3 }]) {
      const s = normalizeSettings(raw, NOV);
      expect(s.provider).toBe("anthropic");
      expect(s.anthropic.model).toBe(DEFAULT_ANTHROPIC_MODEL);
      expect(s.priceList).toEqual({});
    }
  });

  it("tiene i valori validi e ripulisce gli altri", () => {
    const s = normalizeSettings(
      {
        provider: "openai_compatible",
        anthropic: { apiKey: `  ${KEY}  `, model: "", cheapModel: "mio-haiku", useCheapModel: true },
        openai: { baseUrl: " https://x.example/v1 ", model: "gpt-visione", tokenParam: "max_tokens" },
        monthlyCap: "5,5",
        priceList: { "gpt-visione": { inputPerMTok: 1, outputPerMTok: 2 }, rotto: 1 },
        currency: "EUR",
      },
      NOV,
    );
    expect(s.provider).toBe("openai_compatible");
    expect(s.anthropic).toMatchObject({ apiKey: KEY, model: DEFAULT_ANTHROPIC_MODEL, cheapModel: "mio-haiku", useCheapModel: true });
    expect(s.openai).toMatchObject({ baseUrl: "https://x.example/v1", model: "gpt-visione", tokenParam: "max_tokens" });
    expect(s.monthlyCap).toBe(5.5);
    expect(Object.keys(s.priceList)).toEqual(["gpt-visione"]);
  });

  it("un tetto non positivo vale come nessun tetto", () => {
    expect(normalizeSettings({ monthlyCap: 0 }, NOV).monthlyCap).toBeNull();
    expect(normalizeSettings({ monthlyCap: -3 }, NOV).monthlyCap).toBeNull();
  });
});

describe("chiave", () => {
  it("controlla che si possa mandare in un'intestazione", () => {
    expect(checkApiKey(`  "${KEY}" `)).toEqual({ ok: true, key: KEY });
    expect(checkApiKey("")).toEqual({ ok: false, error: "empty" });
    expect(checkApiKey("sk ant con spazi 123456")).toEqual({ ok: false, error: "invalid" });
    expect(checkApiKey("chiave-con-à-123456")).toEqual({ ok: false, error: "invalid" });
    expect(checkApiKey("corta")).toEqual({ ok: false, error: "invalid" });
  });

  it("mostra solo gli ultimi quattro caratteri", () => {
    expect(maskKey(KEY)).toBe("••••1234");
    expect(maskKey(KEY)).not.toContain("sk-ant");
    expect(maskKey("")).toBe("");
    expect(maskKey("corta")).toBe("••••");
  });
});

describe("salvataggio", () => {
  it("salva la chiave, e la cancella senza toccare il resto", async () => {
    const store = memorySettingsStore();
    await updateAiSettings(store, (s) => ({ ...s, monthlyCap: 4, anthropic: { ...s.anthropic, useCheapModel: true } }), NOV);
    await setApiKey(store, "anthropic", KEY, NOV);
    await setApiKey(store, "openai_compatible", "altra-chiave-1234567", NOV);
    expect((await loadAiSettings(store, NOV)).anthropic.apiKey).toBe(KEY);

    const cleared = await clearApiKey(store, "anthropic", NOV);
    expect(cleared.anthropic.apiKey).toBe("");
    expect(cleared.openai.apiKey).toBe("altra-chiave-1234567");
    expect(cleared.monthlyCap).toBe(4);
    expect(cleared.anthropic.useCheapModel).toBe(true);
    expect(JSON.stringify(await store.read())).not.toContain(KEY);

    const all = await clearApiKey(store, undefined, NOV);
    expect(all.openai.apiKey).toBe("");
  });

  it("sceglie il modello in base all'alternativa economica", () => {
    const s = defaultAiSettings("2026-11");
    expect(activeModel(s)).toBe("claude-sonnet-5-5");
    expect(activeModel({ ...s, anthropic: { ...s.anthropic, useCheapModel: true } })).toBe("claude-haiku-5-5");
    expect(activeModel({ ...s, provider: "openai_compatible" })).toBe("");
  });

  it("dice cosa manca per poter chiamare", () => {
    const s = defaultAiSettings("2026-11");
    expect(configIssue(s)).toBe("missing_key");
    expect(providerFor(s)).toBeNull();
    const withKey = { ...s, anthropic: { ...s.anthropic, apiKey: KEY } };
    expect(configIssue(withKey)).toBeNull();
    expect(providerFor(withKey)).toMatchObject({ id: "anthropic", model: "claude-sonnet-5-5" });
    const openai = { ...s, provider: "openai_compatible" as const, openai: { ...s.openai, apiKey: "chiave-1234567" } };
    expect(configIssue(openai)).toBe("missing_model");
    expect(configIssue({ ...openai, openai: { ...openai.openai, model: "m", baseUrl: "boh" } })).toBe("invalid_base_url");
    expect(configIssue({ ...openai, openai: { ...openai.openai, model: "m" } })).toBeNull();
  });

  it("conta le chiamate del mese e riparte a mese nuovo", async () => {
    const store = memorySettingsStore();
    await recordCall(store, { inputTokens: 1000, outputTokens: 200 }, 0.01, NOV);
    await recordCall(store, { inputTokens: 500, outputTokens: 50 }, null, NOV);
    expect((await loadAiSettings(store, NOV)).usage).toEqual({ month: "2026-11", calls: 2, inputTokens: 1500, outputTokens: 250, cost: 0.01, unpricedCalls: 1, estimatedCalls: 0 });
    const dec = await recordCall(store, { inputTokens: 10, outputTokens: 5 }, 0.5, "2026-12-02T08:00:00.000Z");
    expect(dec.usage).toMatchObject({ month: "2026-12", calls: 1, cost: 0.5 });
  });

  it("due conteggi insieme non si perdono", async () => {
    const store = memorySettingsStore();
    await Promise.all([1, 2, 3, 4, 5].map(() => recordCall(store, { inputTokens: 1, outputTokens: 1 }, 1, NOV)));
    expect((await loadAiSettings(store, NOV)).usage.calls).toBe(5);
  });
});

describe("archivio del dispositivo", () => {
  beforeEach(async () => {
    await wipeAll();
  });

  it("la chiave sta solo nella tabella delle impostazioni, non nelle copie di sicurezza", async () => {
    const store = dexieSettingsStore();
    await setApiKey(store, "anthropic", KEY, NOV);
    expect((await loadAiSettings(store, NOV)).anthropic.apiKey).toBe(KEY);
    expect(await getDb().settings.get(AI_SETTINGS_KEY)).toBeDefined();

    await appendEvents([purchase("e1", "2026-11-01T10:00:00.000Z", { lotId: "l1", productRef: "farina", quantity: q(500), location: "dispensa" })]);
    const backup = JSON.stringify(await exportBackup());
    expect(backup).not.toContain(KEY);
    expect(backup).not.toContain("ai.settings");
    expect(backup).not.toContain("apiKey");
  });

  it("«Cancella tutti i dati» toglie anche la chiave", async () => {
    const store = dexieSettingsStore();
    await setApiKey(store, "anthropic", KEY, NOV);
    await wipeAll();
    expect((await loadAiSettings(store, NOV)).anthropic.apiKey).toBe("");
  });

  it("cancellare la chiave la toglie dal disco", async () => {
    const store = dexieSettingsStore();
    await setApiKey(store, "anthropic", KEY, NOV);
    await clearApiKey(store, "anthropic", NOV);
    expect(JSON.stringify(await getDb().settings.toArray())).not.toContain(KEY);
  });
});
