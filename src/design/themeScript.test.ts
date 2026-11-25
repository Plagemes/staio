import { describe, expect, it } from "vitest";
import { APPEARANCE_STORAGE_KEY, STYLE_CHOICE_MAX_WAIT } from "./applyTheme";
import { buildThemeScript } from "./themeScript";

function run(stored: string | null, systemDark = false, throwing = false, pathname?: string) {
  const attrs = new Map<string, string>();
  const timers: { fn: () => void; ms: number }[] = [];
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
    documentElement: { setAttribute: (n: string, v: string) => attrs.set(n, v), removeAttribute: (n: string) => attrs.delete(n) },
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
    setTimeout: (fn: () => void, ms: number) => timers.push({ fn, ms }),
    ...(pathname === undefined ? {} : { location: { pathname } }),
  };
  new Function("document", "window", `return ${buildThemeScript()}`)(doc, win);
  /** Fa scattare i timer messi dallo script, come farebbe il browser senza che nessun altro codice giri. */
  const elapse = () => {
    for (const t of timers.splice(0)) t.fn();
    return Object.fromEntries(attrs);
  };
  return {
    attrs: Object.fromEntries(attrs),
    colors: metas.map((m) => m.state.content),
    media: metas.map((m) => m.state.media),
    timers,
    elapse,
  };
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

  it("accetta Vivo, chiaro e scuro", () => {
    const r = run(JSON.stringify({ theme: "vivo", mode: "dark" }));
    expect(r.attrs).toEqual({ "data-palette": "vivo", "data-theme": "dark" });
    expect(r.colors).toEqual(["#000000", "#000000"]);
    expect(run(JSON.stringify({ theme: "vivo", mode: "light" })).colors).toEqual(["#f2f2f7", "#f2f2f7"]);
  });

  it("Grano: palette di Vivo più la variante, colore della barra del browser di Grano", () => {
    const dark = run(JSON.stringify({ theme: "grano", mode: "dark" }));
    expect(dark.attrs).toEqual({ "data-palette": "vivo", "data-variant": "grano", "data-theme": "dark" });
    expect(dark.colors).toEqual(["#151a14", "#151a14"]);
    expect(run(JSON.stringify({ theme: "grano", mode: "light" })).colors).toEqual(["#f3ede3", "#f3ede3"]);
    expect(run(JSON.stringify({ theme: "grano", mode: "device" }), true).colors[0]).toBe("#151a14");
  });

  it("gli altri temi non mettono data-variant", () => {
    for (const theme of ["vivo", "bottega", "ardesia", "netto"]) expect(run(JSON.stringify({ theme, mode: "device" })).attrs).not.toHaveProperty("data-variant");
  });
});

describe("script iniziale: attesa della scelta dello stile", () => {
  it("su /app senza stile scelto segna l'attesa", () => {
    expect(run(null, false, false, "/app").attrs).toEqual({ "data-style-choice": "pending" });
    expect(run(null, false, false, "/app/").attrs).toEqual({ "data-style-choice": "pending" });
    expect(run(JSON.stringify({ theme: "registro", mode: "device" }), false, false, "/app").attrs).toEqual({ "data-style-choice": "pending" });
  });

  it("toglie l'attesa da solo, senza React né altri moduli, entro il ritardo massimo (<= 1 s)", () => {
    const r = run(null, false, false, "/app");
    expect(r.attrs["data-style-choice"]).toBe("pending");
    expect(r.timers).toHaveLength(1);
    expect(r.timers[0].ms).toBe(STYLE_CHOICE_MAX_WAIT);
    expect(STYLE_CHOICE_MAX_WAIT).toBeLessThanOrEqual(1000);
    expect(r.elapse()).toEqual({});
  });

  it("con localStorage che lancia eccezioni non nasconde nulla", () => {
    const r = run(null, false, true, "/app");
    expect(r.attrs).toEqual({});
    expect(r.timers).toHaveLength(0);
  });

  it("non segna nulla se lo stile è già scelto, su altre pagine o senza location", () => {
    expect(run(JSON.stringify({ theme: "vivo", mode: "device", chosen: true }), false, false, "/app").attrs).toEqual({ "data-palette": "vivo" });
    expect(run(null, false, false, "/app/dispensa").attrs).toEqual({});
    expect(run(null, false, false, "/").attrs).toEqual({});
    expect(run(null).attrs).toEqual({});
  });
});
