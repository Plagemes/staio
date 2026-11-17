import { describe, expect, it } from "vitest";
import { memorySettingsStore } from "../ai/settings";
import {
  EMPTY_VIDEO_SERVICE,
  checkServiceUrl,
  checkToken,
  clearVideoService,
  isConfigured,
  loadVideoService,
  normalizeVideoService,
  saveVideoService,
  tokenToSave,
} from "./settings";

const TOKEN = "a1b2c3d4e5f6a7b8c9d0";

describe("impostazioni del servizio", () => {
  it("per impostazione predefinita sono vuote", async () => {
    expect(await loadVideoService(memorySettingsStore())).toEqual(EMPTY_VIDEO_SERVICE);
    expect(isConfigured(EMPTY_VIDEO_SERVICE)).toBe(false);
  });

  it("qualunque forma inattesa vale «nessun servizio»", () => {
    for (const raw of [null, 5, "x", [], {}, { url: 3, token: 4 }, { url: "http://esempio.it", token: TOKEN }, { url: "https://a.it", token: "corto" }]) {
      expect(normalizeVideoService(raw)).toEqual(EMPTY_VIDEO_SERVICE);
    }
  });

  it("salva solo indirizzi https (o http su localhost) e token validi", async () => {
    const store = memorySettingsStore();
    expect((await saveVideoService(store, { url: "http://esempio.it", token: TOKEN })).ok).toBe(false);
    expect((await saveVideoService(store, { url: "https://u:p@esempio.it", token: TOKEN })).ok).toBe(false);
    expect((await saveVideoService(store, { url: "https://esempio.it", token: "con spazio dentro 123" })).ok).toBe(false);
    expect((await saveVideoService(store, { url: "https://esempio.it", token: "corto" })).ok).toBe(false);
    expect(await loadVideoService(store)).toEqual(EMPTY_VIDEO_SERVICE);

    const ok = await saveVideoService(store, { url: " https://esempio.it/api/ ", token: ` ${TOKEN} ` });
    expect(ok.ok).toBe(true);
    expect(await loadVideoService(store)).toEqual({ url: "https://esempio.it/api", token: TOKEN });
    expect((await saveVideoService(store, { url: "http://localhost:8787", token: TOKEN })).ok).toBe(true);
  });

  it("si cancella del tutto", async () => {
    const store = memorySettingsStore();
    await saveVideoService(store, { url: "https://esempio.it", token: TOKEN });
    await clearVideoService(store);
    expect(await loadVideoService(store)).toEqual(EMPTY_VIDEO_SERVICE);
  });

  it("controlli di indirizzo e token", () => {
    expect(checkServiceUrl("")).toEqual({ ok: false, error: "empty" });
    expect(checkServiceUrl("esempio.it")).toEqual({ ok: false, error: "invalid" });
    expect(checkToken("")).toEqual({ ok: false, error: "empty" });
    expect(checkToken("àèìòùàèìòùàèìòùàèìòù")).toEqual({ ok: false, error: "invalid" });
    expect(checkToken("x".repeat(600))).toEqual({ ok: false, error: "invalid" });
  });

  it("cambiando dominio il vecchio token non si riusa", () => {
    const saved = { url: "https://uno.example", token: TOKEN };
    expect(tokenToSave(saved, "https://uno.example/altro", "")).toBe(TOKEN);
    expect(tokenToSave(saved, "https://due.example", "")).toBe("");
    expect(tokenToSave(saved, "https://due.example", "nuovo-token-123456789")).toBe("nuovo-token-123456789");
    expect(tokenToSave(EMPTY_VIDEO_SERVICE, "https://uno.example", "")).toBe("");
  });
});
