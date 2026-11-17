import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSetting, setSetting, wipeAll } from "@/data";
import { APPEARANCE_STORAGE_KEY, MODE_SETTING_KEY, STYLE_CHOICE_ATTR, THEME_SETTING_KEY, readStoredRaw, writeStoredChoice } from "@/design";
import {
  abandonStyleChoice,
  clearStyleChoicePending,
  confirmStyle,
  decideStyleChoice,
  isStyleChoicePath,
  markStyleChosen,
  needsStyleChoice,
  postponeStyle,
  previewStyle,
} from "./firstRunStyle";

const NOTHING_SAVED = { theme: undefined, mode: undefined };

let store: Map<string, string>;
let attrs: Map<string, string>;

beforeEach(async () => {
  await wipeAll();
  store = new Map();
  attrs = new Map();
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
    matchMedia: () => ({ matches: false }),
  });
  vi.stubGlobal("document", {
    documentElement: {
      setAttribute: (n: string, v: string) => void attrs.set(n, v),
      removeAttribute: (n: string) => void attrs.delete(n),
      style: { setProperty: () => {} },
    },
    head: { querySelectorAll: () => [] },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scelta dello stile alla prima apertura", () => {
  it("prima apertura (niente in locale né in archivio): la scelta si propone", () => {
    expect(needsStyleChoice(null, NOTHING_SAVED)).toBe(true);
    // la copia con i valori predefiniti la scrive ThemeSync anche senza una scelta
    expect(needsStyleChoice(JSON.stringify({ theme: "registro", mode: "device" }), NOTHING_SAVED)).toBe(true);
    expect(needsStyleChoice("{non json", NOTHING_SAVED)).toBe(true);
  });

  it("preferenza già esistente: la scelta non si propone", () => {
    expect(needsStyleChoice(null, { theme: "ardesia", mode: undefined })).toBe(false);
    expect(needsStyleChoice(null, { theme: undefined, mode: "dark" })).toBe(false);
    expect(needsStyleChoice(JSON.stringify({ theme: "bottega", mode: "device" }), NOTHING_SAVED)).toBe(false);
    expect(needsStyleChoice(JSON.stringify({ theme: "registro", mode: "dark" }), NOTHING_SAVED)).toBe(false);
    expect(needsStyleChoice(JSON.stringify({ theme: "registro", mode: "device", chosen: true }), NOTHING_SAVED)).toBe(false);
  });

  it("solo sulla pagina iniziale dell'app", () => {
    expect(isStyleChoicePath("/app")).toBe(true);
    expect(isStyleChoicePath("/app/")).toBe(true);
    expect(isStyleChoicePath("/app/cattura")).toBe(false);
    expect(isStyleChoicePath("/")).toBe(false);
  });

  it("«Decido dopo»: resta Registro, nulla in archivio, e la scelta non riappare", async () => {
    previewStyle({ theme: "vivo", mode: "dark" });
    expect(attrs.get("data-palette")).toBe("vivo");
    postponeStyle();
    expect(attrs.has("data-palette")).toBe(false);
    expect(attrs.has("data-theme")).toBe(false);
    expect(JSON.parse(store.get(APPEARANCE_STORAGE_KEY)!)).toEqual({ theme: "registro", mode: "device", chosen: true });
    expect(await getSetting(THEME_SETTING_KEY)).toBeUndefined();
    expect(needsStyleChoice(readStoredRaw(), NOTHING_SAVED)).toBe(false);
  });

  it("«Usa questo stile»: applicato subito, salvato in archivio e in locale, la scelta non riappare", async () => {
    await confirmStyle({ theme: "vivo", mode: "dark" });
    expect(attrs.get("data-palette")).toBe("vivo");
    expect(attrs.get("data-theme")).toBe("dark");
    expect(await getSetting(THEME_SETTING_KEY)).toBe("vivo");
    expect(await getSetting(MODE_SETTING_KEY)).toBe("dark");
    expect(JSON.parse(store.get(APPEARANCE_STORAGE_KEY)!)).toEqual({ theme: "vivo", mode: "dark", chosen: true });
    expect(needsStyleChoice(readStoredRaw(), { theme: "vivo", mode: "dark" })).toBe(false);
    expect(needsStyleChoice(readStoredRaw(), NOTHING_SAVED)).toBe(false);
  });

  it("il segno di scelta fatta sopravvive alle riscritture della copia locale (ThemeSync)", () => {
    postponeStyle();
    writeStoredChoice({ theme: "ardesia", mode: "light" });
    expect(JSON.parse(store.get(APPEARANCE_STORAGE_KEY)!)).toEqual({ theme: "ardesia", mode: "light", chosen: true });
  });

  it("chi aveva già una preferenza viene segnato una volta; l'attesa sulla radice si toglie", async () => {
    await setSetting(THEME_SETTING_KEY, "netto");
    store.set(APPEARANCE_STORAGE_KEY, JSON.stringify({ theme: "netto", mode: "device" }));
    markStyleChosen();
    expect(JSON.parse(store.get(APPEARANCE_STORAGE_KEY)!)).toEqual({ theme: "netto", mode: "device", chosen: true });

    attrs.set(STYLE_CHOICE_ATTR, "pending");
    clearStyleChoicePending();
    expect(attrs.has(STYLE_CHOICE_ATTR)).toBe(false);
  });

  it("decisione: attende la lettura, propone alla prima apertura, altrimenti apre l'app", () => {
    const saved = { theme: undefined, mode: undefined, loading: false, error: undefined };
    const base = { pathname: "/app", raw: null, storageOk: true, saved };
    expect(decideStyleChoice({ ...base, raw: undefined })).toBe("wait");
    expect(decideStyleChoice({ ...base, saved: { ...saved, loading: true } })).toBe("wait");
    expect(decideStyleChoice(base)).toBe("offer");
    expect(decideStyleChoice({ ...base, pathname: "/app/dispensa" })).toBe("skip");
    expect(decideStyleChoice({ ...base, saved: { ...saved, theme: "vivo" } })).toBe("skip");
  });

  it("localStorage bloccato o archivio in errore: si apre l'app (Registro), la scelta resta in Aspetto", () => {
    const saved = { theme: undefined, mode: undefined, loading: false, error: undefined };
    expect(decideStyleChoice({ pathname: "/app", raw: null, storageOk: false, saved })).toBe("skip");
    expect(decideStyleChoice({ pathname: "/app", raw: null, storageOk: true, saved: { ...saved, error: new Error("idb") } })).toBe("skip");
  });

  it("se la schermata di scelta si rompe torna lo stile salvato e l'attesa si toglie", () => {
    previewStyle({ theme: "vivo", mode: "dark" });
    attrs.set(STYLE_CHOICE_ATTR, "pending");
    abandonStyleChoice();
    expect(attrs.has("data-palette")).toBe(false);
    expect(attrs.has("data-theme")).toBe(false);
    expect(attrs.has(STYLE_CHOICE_ATTR)).toBe(false);
  });
});
