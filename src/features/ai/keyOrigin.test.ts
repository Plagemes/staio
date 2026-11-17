import { describe, expect, it } from "vitest";
import {
  configIssue,
  defaultAiSettings,
  destinationHost,
  hostOf,
  loadAiSettings,
  memorySettingsStore,
  normalizeSettings,
  providerFor,
  setApiKey,
  updateAiSettings,
} from "./settings";

const NOV = "2026-11-17T10:00:00.000Z";
const KEY = "chiave-compatibile-1234567";

async function withService(baseUrl: string) {
  const store = memorySettingsStore();
  await updateAiSettings(store, (s) => ({ ...s, provider: "openai_compatible", openai: { ...s.openai, baseUrl, model: "m" } }), NOV);
  await setApiKey(store, "openai_compatible", KEY, NOV);
  return store;
}

describe("la chiave segue l'origine per cui è stata inserita", () => {
  it("salvare la chiave la lega all'origine dell'indirizzo", async () => {
    const store = await withService("https://api.uno.example/v1");
    const s = await loadAiSettings(store, NOV);
    expect(s.openai.apiKey).toBe(KEY);
    expect(s.openai.keyOrigin).toBe("https://api.uno.example");
    expect(configIssue(s)).toBeNull();
  });

  it("cambiando dominio la chiave salvata viene scartata, dal disco, e il fornitore non è più pronto", async () => {
    const store = await withService("https://api.uno.example/v1");
    const s = await updateAiSettings(store, (c) => ({ ...c, openai: { ...c.openai, baseUrl: "https://api.altro.example/v1" } }), NOV);
    expect(s.openai.apiKey).toBe("");
    expect(configIssue(s)).toBe("missing_key");
    expect(providerFor(s)).toBeNull();
    expect(JSON.stringify(await store.read())).not.toContain(KEY);
  });

  it("vale anche per un altro schema, un'altra porta o un dominio che somiglia", async () => {
    for (const other of ["http://localhost:11434/v1", "https://api.uno.example:8443/v1", "https://api.uno.example.evil.io/v1"]) {
      const store = await withService("https://api.uno.example/v1");
      const s = await updateAiSettings(store, (c) => ({ ...c, openai: { ...c.openai, baseUrl: other } }), NOV);
      expect(s.openai.apiKey).toBe("");
    }
  });

  it("cambiare solo il percorso tiene la chiave; chiave e indirizzo nuovi insieme restano validi", async () => {
    const store = await withService("https://api.uno.example/v1");
    const same = await updateAiSettings(store, (c) => ({ ...c, openai: { ...c.openai, baseUrl: "https://api.uno.example/altro/v2/" } }), NOV);
    expect(same.openai.apiKey).toBe(KEY);
    const both = await updateAiSettings(
      store,
      (c) => ({ ...c, openai: { ...c.openai, baseUrl: "https://api.altro.example/v1", apiKey: "nuova-chiave-1234567", keyOrigin: "https://api.altro.example" } }),
      NOV,
    );
    expect(both.openai.apiKey).toBe("nuova-chiave-1234567");
  });

  it("una chiave già sul disco senza origine registrata non viene mai inviata", () => {
    const s = normalizeSettings({ provider: "openai_compatible", openai: { apiKey: KEY, baseUrl: "https://api.uno.example/v1", model: "m" } }, NOV);
    expect(s.openai.apiKey).toBe("");
  });

  it("e neppure con un indirizzo non valido", () => {
    const s = normalizeSettings({ openai: { apiKey: KEY, keyOrigin: "https://api.uno.example", baseUrl: "boh", model: "m" } }, NOV);
    expect(s.openai.apiKey).toBe("");
  });

  it("la chiave di Anthropic non dipende dall'indirizzo del servizio compatibile", async () => {
    const store = memorySettingsStore();
    await setApiKey(store, "anthropic", "sk-ant-api03-ABCDEFGHIJ", NOV);
    const s = await updateAiSettings(store, (c) => ({ ...c, openai: { ...c.openai, baseUrl: "https://altro.example/v1" } }), NOV);
    expect(s.anthropic.apiKey).toBe("sk-ant-api03-ABCDEFGHIJ");
  });

  it("mostra il dominio a cui andrà la chiave", () => {
    const d = defaultAiSettings("2026-11");
    expect(destinationHost(d)).toBe("api.anthropic.com");
    expect(destinationHost({ ...d, provider: "openai_compatible", openai: { ...d.openai, baseUrl: "https://api.uno.example:8443/v1" } })).toBe("api.uno.example:8443");
    expect(hostOf("openai_compatible", "boh")).toBe("");
    expect(hostOf("anthropic", "boh")).toBe("api.anthropic.com");
  });
});
