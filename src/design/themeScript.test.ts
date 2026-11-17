import { describe, expect, it } from "vitest";
import { APPEARANCE_STORAGE_KEY } from "./applyTheme";
import { buildThemeScript } from "./themeScript";

function run(stored: string | null, systemDark = false, throwing = false) {
  const attrs = new Map<string, string>();
  const metas = [
    { media: "(prefers-color-scheme: light)", content: "#f6f5f1" },
    { media: "(prefers-color-scheme: dark)", content: "#101214" },
  ].map((m) => ({
    state: { ...m } as Record<string, string | undefined>,
    removeAttribute(n: string) {
      this.state[n] = undefined;
    },
    setAttribute(n: string, v: string) {
      this.state[n] = v;
    },
  }));
  const doc = {
    documentElement: { setAttribute: (n: string, v: string) => attrs.set(n, v) },
    head: { querySelectorAll: () => metas },
    addEventListener: () => {},
  };
  const win = {
    localStorage: {
      getItem: (k: string) => {
        if (throwing) throw new Error("blocked");
        return k === APPEARANCE_STORAGE_KEY ? stored : null;
      },
    },
    matchMedia: () => ({ matches: systemDark, addEventListener: () => {} }),
  };
  new Function("document", "window", `return ${buildThemeScript()}`)(doc, win);
  return { attrs: Object.fromEntries(attrs), colors: metas.map((m) => m.state.content), media: metas.map((m) => m.state.media) };
}

describe("script iniziale del tema", () => {
  it("senza scelta salvata non tocca nulla (resta Registro, come il dispositivo)", () => {
    expect(run(null).attrs).toEqual({});
    expect(run(null, true).attrs).toEqual({});
  });

  it("applica tema e modalità salvati e colora la barra del browser", () => {
    const r = run(JSON.stringify({ theme: "ardesia", mode: "dark" }));
    expect(r.attrs).toEqual({ "data-palette": "ardesia", "data-theme": "dark" });
    expect(r.colors).toEqual(["#0f1318", "#0f1318"]);
    expect(r.media).toEqual([undefined, undefined]);
  });

  it("in modalità dispositivo segue la preferenza del sistema", () => {
    const r = run(JSON.stringify({ theme: "bottega", mode: "device" }), true);
    expect(r.attrs).toEqual({ "data-palette": "bottega" });
    expect(r.colors[0]).toBe("#17120e");
    expect(run(JSON.stringify({ theme: "bottega", mode: "device" }), false).colors[0]).toBe("#f5efe4");
  });

  it("ignora valori non validi e localStorage che lancia", () => {
    expect(run(JSON.stringify({ theme: "nope", mode: "boh" })).attrs).toEqual({});
    for (const bad of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const r = run(JSON.stringify({ theme: bad, mode: bad }));
      expect(r.attrs).toEqual({});
      expect(r.colors).toEqual(["#f6f5f1", "#f6f5f1"]);
    }
    expect(run("{non json").attrs).toEqual({});
    expect(run(null, false, true).attrs).toEqual({});
  });
});
