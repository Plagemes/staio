import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyTheme } from "./applyTheme";

let attrs: Map<string, string>;

beforeEach(() => {
  attrs = new Map();
  vi.stubGlobal("window", { matchMedia: () => ({ matches: false }) });
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

describe("applyTheme: attributi sulla radice", () => {
  it("Grano: palette di Vivo e variante", () => {
    applyTheme({ theme: "grano", mode: "dark" });
    expect(Object.fromEntries(attrs)).toEqual({ "data-palette": "vivo", "data-variant": "grano", "data-theme": "dark" });
  });

  it("dopo Grano, un altro tema toglie la variante; il predefinito toglie anche la palette", () => {
    applyTheme({ theme: "grano", mode: "device" });
    applyTheme({ theme: "vivo", mode: "device" });
    expect(Object.fromEntries(attrs)).toEqual({ "data-palette": "vivo" });
    applyTheme({ theme: "grano", mode: "device" });
    applyTheme({ theme: "registro", mode: "device" });
    expect(Object.fromEntries(attrs)).toEqual({});
  });

  it("restituisce la modalità effettiva", () => {
    expect(applyTheme({ theme: "grano", mode: "light" })).toBe("light");
    expect(applyTheme({ theme: "grano", mode: "device" })).toBe("light");
  });
});
