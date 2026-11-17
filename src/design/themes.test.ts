import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio } from "./contrast";
import { DEFAULT_MODE, DEFAULT_THEME, THEMES, isThemeId, isThemeMode, normalizeChoice, type ThemeId } from "./themes";

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
const CSS = `${read("tokens.css")}\n${read("themes.css")}`;

interface Rule {
  media: string | null;
  selectors: string[];
  vars: Record<string, string>;
}

/** Lettore minimo: regole di primo livello e regole dentro un solo @media. */
function parseRules(css: string, media: string | null = null): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules: Rule[] = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf("{", i);
    if (open < 0) break;
    let depth = 1;
    let j = open + 1;
    while (depth > 0 && j < text.length) {
      if (text[j] === "{") depth++;
      else if (text[j] === "}") depth--;
      j++;
    }
    const head = text.slice(i, open).trim();
    const body = text.slice(open + 1, j - 1);
    if (head.startsWith("@media")) rules.push(...parseRules(body, head));
    else {
      const vars: Record<string, string> = {};
      for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[m[1]] = m[2].trim();
      rules.push({ media: media, selectors: head.split(",").map((s) => s.trim()), vars });
    }
    i = j;
  }
  return rules;
}

const RULES = parseRules(CSS);

function find(selector: string, media: boolean): Record<string, string> {
  const hit = RULES.filter((r) => (r.media !== null) === media && r.selectors.includes(selector) && "--color-paper" in r.vars);
  if (hit.length !== 1) throw new Error(`expected one rule for ${selector} (media=${media}), got ${hit.length}`);
  return hit[0].vars;
}

const palette = (id: ThemeId, mode: "light" | "dark") =>
  mode === "light" ? find(`[data-palette="${id}"]`, false) : find(`[data-palette="${id}"][data-theme="dark"]`, false);

const MODES = ["light", "dark"] as const;

/** La regola senza @media con esattamente questi selettori e questa variabile. */
function findBlock(selectors: string[], marker: string): Record<string, string> {
  const hit = RULES.filter((r) => r.media === null && r.selectors.join("|") === selectors.join("|") && marker in r.vars);
  if (hit.length !== 1) throw new Error(`expected one rule for ${selectors.join(", ")} with ${marker}, got ${hit.length}`);
  return hit[0].vars;
}

/** Variabili comuni (forma) e significati predefiniti, validi su :root e su ogni [data-palette]. */
const COMMON = findBlock([":root", "[data-palette]"], "--rule-width");
const SEMANTIC_DEFAULTS = findBlock([":root", "[data-palette]"], "--area-today");
const VIVO_SHAPE = findBlock(['[data-palette="vivo"]'], "--weight-display");

/** Colori effettivi di un tema: significati predefiniti, poi il blocco del tema, con i rimandi var() risolti. */
function resolved(id: ThemeId, mode: "light" | "dark"): Record<string, string> {
  const raw: Record<string, string> = { ...SEMANTIC_DEFAULTS, ...palette(id, mode) };
  if (id === "vivo") for (const [k, v] of Object.entries(VIVO_SHAPE)) if (k.startsWith("--area-current")) raw[k] = v;
  const get = (name: string, depth = 0): string => {
    const v = raw[name];
    if (v === undefined) throw new Error(`missing ${name} in ${id} ${mode}`);
    const m = /^var\((--[\w-]+)\)$/.exec(v);
    if (!m) return v;
    if (depth > 10) throw new Error(`var loop at ${name}`);
    return get(m[1], depth + 1);
  };
  return Object.fromEntries(Object.keys(raw).map((k) => [k, get(k)]));
}

const SEMANTIC = [
  "--area-today",
  "--area-pantry",
  "--area-capture",
  "--area-plan",
  "--area-health",
  "--nutrient-protein",
  "--nutrient-carbs",
  "--nutrient-fat",
  "--nutrient-fiber",
  "--water",
  "--state-ok",
  "--state-near",
  "--state-expired",
  "--state-estimate",
] as const;

describe("contrastRatio", () => {
  it("valori noti", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#fff", "#fff")).toBeCloseTo(1, 5);
    expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
  });
  it("è simmetrico e rifiuta colori non validi", () => {
    expect(contrastRatio("#1e4634", "#f6f5f1")).toBe(contrastRatio("#f6f5f1", "#1e4634"));
    expect(() => contrastRatio("rosso", "#fff")).toThrow();
  });
});

describe("temi: contrasto", () => {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      describe(`${theme.id} ${mode}`, () => {
        const p = resolved(theme.id, mode);
        const on = (fg: string, bg = "--color-paper") => contrastRatio(p[fg], p[bg]);

        // Testo: almeno 4,5:1 su carta.
        it.each(["--color-ink", "--color-graphite", "--color-accent", "--color-signal", "--color-ochre"])("%s su carta >= 4,5", (v) => {
          expect(on(v)).toBeGreaterThanOrEqual(4.5);
        });
        it("testo e testo secondario su superficie >= 4,5", () => {
          expect(on("--color-ink", "--color-surface")).toBeGreaterThanOrEqual(4.5);
          expect(on("--color-graphite", "--color-surface")).toBeGreaterThanOrEqual(4.5);
        });
        it("testo sull'inchiostro (pulsanti pieni) >= 4,5", () => {
          expect(on("--color-on-ink", "--color-ink")).toBeGreaterThanOrEqual(4.5);
        });
        // Solo elementi grafici (barre, anello del focus): bastano 3:1 (WCAG 1.4.11). I filetti sono decorativi e non si misurano.
        it("elementi grafici (barra piena, focus) su carta >= 3", () => {
          expect(on("--color-bar-fill")).toBeGreaterThanOrEqual(3);
          expect(on("--color-focus")).toBeGreaterThanOrEqual(3);
        });
      });
    }
  }
});

describe("temi: struttura", () => {
  it("ogni tema definisce le stesse variabili di Registro, in chiaro e in scuro (Vivo in più ha i colori con significato)", () => {
    const keys = Object.keys(palette("registro", "light")).sort();
    for (const t of THEMES.filter((t) => t.id !== "vivo")) for (const m of MODES) expect(Object.keys(palette(t.id, m)).sort()).toEqual(keys);
    const vivo = Object.keys(palette("vivo", "light")).sort();
    expect(vivo).toEqual(expect.arrayContaining(keys));
    expect(Object.keys(palette("vivo", "dark")).sort()).toEqual(vivo);
    for (const v of SEMANTIC) expect(vivo).toEqual(expect.arrayContaining([v, `${v}-tint`]));
  });

  it("fuori da Vivo nessuna regola ridefinisce la forma o i colori con significato", () => {
    for (const r of RULES) {
      if (r.vars === COMMON || r.vars === SEMANTIC_DEFAULTS || r.selectors.some((sel) => sel.includes('"vivo"'))) continue;
      for (const k of Object.keys(r.vars)) {
        expect(k in COMMON || k in SEMANTIC_DEFAULTS, `${r.selectors.join(", ")} ridefinisce ${k}`).toBe(false);
      }
    }
  });

  it("il blocco scuro per «come il dispositivo» è uguale a quello scuro scelto a mano", () => {
    for (const t of THEMES) {
      expect(find(`[data-palette="${t.id}"]:not([data-theme="light"])`, true)).toEqual(palette(t.id, "dark"));
    }
    expect(find(':root:not([data-palette]):not([data-theme="light"])', true)).toEqual(palette("registro", "dark"));
    expect(find(':root[data-theme="dark"]:not([data-palette])', false)).toEqual(palette("registro", "dark"));
    expect(find(":root", false)).toEqual(palette("registro", "light"));
  });

  it("il tema predefinito non cambia di un valore", () => {
    expect(palette("registro", "light")).toEqual({
      "--color-paper": "#f6f5f1",
      "--color-surface": "#fbfaf7",
      "--color-ink": "#14171a",
      "--color-graphite": "#5b6168",
      "--color-rule": "#dedcd5",
      "--color-rule-strong": "#14171a",
      "--color-control-border": "#14171a",
      "--color-accent": "#1e4634",
      "--color-signal": "#a8321c",
      "--color-ochre": "#8a5a00",
      "--color-on-ink": "#f6f5f1",
      "--color-bar-track": "#dedcd5",
      "--color-bar-fill": "#14171a",
      "--color-focus": "#1e4634",
    });
    expect(palette("registro", "dark")).toEqual({
      "--color-paper": "#101214",
      "--color-surface": "#181b1e",
      "--color-ink": "#edebe6",
      "--color-graphite": "#a1a6ac",
      "--color-rule": "#2a2e33",
      "--color-rule-strong": "#edebe6",
      "--color-control-border": "#3a3f45",
      "--color-accent": "#8cc2a6",
      "--color-signal": "#e8826b",
      "--color-ochre": "#dba84a",
      "--color-on-ink": "#101214",
      "--color-bar-track": "#2a2e33",
      "--color-bar-fill": "#edebe6",
      "--color-focus": "#8cc2a6",
    });
  });

  it("il colore della barra del browser è la carta del tema", () => {
    for (const t of THEMES) {
      expect(t.themeColor[0]).toBe(palette(t.id, "light")["--color-paper"]);
      expect(t.themeColor[1]).toBe(palette(t.id, "dark")["--color-paper"]);
    }
  });
});

describe("variabili nuove: nel tema di base hanno i valori che prima erano scritti a mano", () => {
  it("forma dei componenti", () => {
    expect(COMMON).toMatchObject({
      "--font-brand": 'var(--font-instrument-serif), "Iowan Old Style", Georgia, serif',
      "--weight-display": "400",
      "--motion-fast": "120ms",
      "--press-transform": "none",
      "--press-opacity": "0.8",
      "--label-font": "var(--font-data)",
      "--label-size": "var(--text-label)",
      "--label-case": "uppercase",
      "--label-tracking": "var(--tracking-label)",
      "--label-color": "var(--color-graphite)",
      "--section-font": "var(--font-data)",
      "--section-size": "var(--text-label)",
      "--section-case": "uppercase",
      "--section-tracking": "var(--tracking-label)",
      "--section-color": "var(--color-graphite)",
      "--section-weight": "400",
      "--section-rule-width": "var(--rule-width)",
      "--card-fill": "transparent",
      "--card-fill-hover": "var(--color-surface)",
      "--card-border": "var(--color-control-border)",
      "--card-shadow": "none",
      "--radius-card": "var(--radius-md)",
      "--button-fill": "var(--color-ink)",
      "--button-text": "var(--color-on-ink)",
      "--button-quiet-fill": "transparent",
      "--button-quiet-border": "var(--color-control-border)",
      "--button-quiet-text": "var(--color-ink)",
      "--radius-button": "var(--radius-md)",
      "--tabs-gap": "var(--space-10)",
      "--tabs-fill": "transparent",
      "--tabs-pad": "0px",
      "--tabs-radius": "0px",
      "--tabs-rule-width": "var(--rule-width)",
      "--tab-grow": "0",
      "--tab-pad-x": "0px",
      "--tab-radius": "0px",
      "--tab-indicator": "2px",
      "--tab-selected-fill": "transparent",
      "--tab-selected-shadow": "none",
      "--nav-fill": "var(--color-paper)",
      "--nav-rule-width": "var(--rule-width)",
      "--nav-backdrop": "none",
      "--nav-current": "var(--color-ink)",
      "--capture-fill": "var(--color-ink)",
      "--capture-text": "var(--color-on-ink)",
      "--chip-strength": "0%",
      "--chip-pad-y": "0px",
      "--chip-pad-x": "0px",
      "--chip-radius": "0px",
      "--figure-gap": "0px",
      "--figure-fill": "transparent",
      "--figure-radius": "0px",
      "--figure-pad-x": "0px",
      "--figure-follow-pad": "var(--space-7)",
      "--figure-divider": "var(--rule-width)",
      "--figure-grid-rule": "var(--rule-width)",
      "--bar-height": "3px",
      "--bar-radius": "0px",
      "--progress-height": "2px",
      "--progress-track": "var(--color-rule)",
    });
    // le variabili che esistevano già non cambiano
    expect(COMMON).toMatchObject({
      "--font-display": 'var(--font-instrument-serif), "Iowan Old Style", Georgia, serif',
      "--radius-sm": "8px",
      "--radius-md": "10px",
      "--rule-width": "1px",
      "--tracking-title": "-0.01em",
      "--tracking-display": "-0.02em",
    });
  });

  it("colori con significato: negli altri temi rimandano all'accento, all'inchiostro o ai colori di stato già in uso", () => {
    for (const t of THEMES.filter((t) => t.id !== "vivo")) {
      for (const m of MODES) {
        const p = resolved(t.id, m);
        const base = palette(t.id, m);
        for (const a of ["--area-today", "--area-pantry", "--area-capture", "--area-plan", "--area-health", "--area-current"]) {
          expect(p[a]).toBe(base["--color-accent"]);
          expect(p[`${a}-tint`]).toBe("transparent");
        }
        for (const n of ["--nutrient-protein", "--nutrient-carbs", "--nutrient-fat", "--nutrient-fiber", "--water", "--state-ok"]) {
          expect(p[n]).toBe(base["--color-ink"]);
        }
        expect(p["--state-near"]).toBe(base["--color-ochre"]);
        expect(p["--state-expired"]).toBe(base["--color-signal"]);
        expect(p["--state-estimate"]).toBe(base["--color-graphite"]);
        expect(p["--color-on-fill"]).toBe(base["--color-on-ink"]);
      }
    }
  });
});

describe("colori con significato: contrasto in tutti i temi", () => {
  for (const theme of THEMES) {
    for (const mode of MODES) {
      describe(`${theme.id} ${mode}`, () => {
        const p = resolved(theme.id, mode);
        const c = (fg: string, bg: string) => contrastRatio(p[fg], p[bg]);
        it.each(SEMANTIC)("%s: testo su carta e superficie, testo sopra il colore pieno, testo sul fondo tinto >= 4,5", (v) => {
          expect(c(v, "--color-paper")).toBeGreaterThanOrEqual(4.5);
          expect(c(v, "--color-surface")).toBeGreaterThanOrEqual(4.5);
          expect(c("--color-on-fill", v)).toBeGreaterThanOrEqual(4.5);
          if (p[`${v}-tint`] !== "transparent") {
            expect(c(v, `${v}-tint`)).toBeGreaterThanOrEqual(4.5);
            expect(c("--color-ink", `${v}-tint`)).toBeGreaterThanOrEqual(4.5);
            expect(c("--color-graphite", `${v}-tint`)).toBeGreaterThanOrEqual(4.5);
          }
        });
        it("testo e testo secondario sui fondi neutri (segmenti) >= 4,5", () => {
          for (const bg of ["--color-fill", "--color-raised"]) {
            expect(c("--color-ink", bg)).toBeGreaterThanOrEqual(4.5);
            expect(c("--color-graphite", bg)).toBeGreaterThanOrEqual(4.5);
          }
        });
        it("testo sopra l'accento pieno >= 4,5", () => {
          expect(c("--color-on-fill", "--color-accent")).toBeGreaterThanOrEqual(4.5);
        });
      });
    }
  }
});

describe("Vivo", () => {
  for (const mode of MODES) {
    describe(mode, () => {
      const p = resolved("vivo", mode);
      const c = (fg: string, bg: string) => contrastRatio(p[fg], p[bg]);
      it("l'accento di base è il colore di Oggi, il segnale è «scaduto», l'ocra è «in scadenza»", () => {
        expect(p["--color-accent"]).toBe(p["--area-today"]);
        expect(p["--color-focus"]).toBe(p["--area-today"]);
        expect(p["--color-signal"]).toBe(p["--state-expired"]);
        expect(p["--color-ochre"]).toBe(p["--state-near"]);
        expect(p["--area-current"]).toBe(p["--area-today"]);
      });
      it("bordi dei campi e dei controlli visibili su carta e superficie >= 3", () => {
        expect(c("--color-control-border", "--color-paper")).toBeGreaterThanOrEqual(3);
        expect(c("--color-control-border", "--color-surface")).toBeGreaterThanOrEqual(3);
      });
      it("pulsante pieno di pericolo (carta sul segnale) >= 4,5", () => {
        expect(c("--color-paper", "--color-signal")).toBeGreaterThanOrEqual(4.5);
      });
      it("aree, nutrienti e stati sono colori diversi tra loro", () => {
        const distinct = (keys: string[]) => new Set(keys.map((k) => p[k])).size === keys.length;
        expect(distinct(["--area-today", "--area-pantry", "--area-capture", "--area-plan", "--area-health"])).toBe(true);
        expect(distinct(["--nutrient-protein", "--nutrient-carbs", "--nutrient-fat", "--nutrient-fiber", "--water"])).toBe(true);
        expect(distinct(["--state-ok", "--state-near", "--state-expired", "--state-estimate"])).toBe(true);
      });
    });
  }
});

describe("attesa della scelta dello stile (CSS)", () => {
  it("nasconde solo il contenuto dell'app, con un'animazione che finisce da sola entro 1 s", () => {
    const css = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]*\[data-style-choice="pending"\][^{]*)\{([^}]*)\}/g)];
    expect(rules).toHaveLength(1);
    const [, selector, body] = rules[0];
    expect(selector.trim()).toBe('html[data-style-choice="pending"] [data-app-content]');
    expect(body).not.toMatch(/visibility\s*:/);
    expect(body).not.toMatch(/forwards|infinite/);
    const ms = /animation:\s*style-choice-hold\s+(\d+)ms/.exec(body);
    expect(ms).not.toBeNull();
    expect(Number(ms![1])).toBeLessThanOrEqual(1000);
  });
});

describe("scelte manomesse", () => {
  it("chiavi ereditate dagli oggetti danno il tema predefinito", () => {
    for (const bad of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(isThemeId(bad)).toBe(false);
      expect(isThemeMode(bad)).toBe(false);
      expect(normalizeChoice({ theme: bad, mode: bad })).toEqual({ theme: DEFAULT_THEME, mode: DEFAULT_MODE });
    }
  });
});

/**
 * Coppie testo/fondo e controllo/fondo aggiunte con le schermate in Vivo. Le altre (colore su carta, superficie e
 * fondo tinto; testo e testo secondario sui fondi tinti e neutri; testo sopra il colore pieno) sono già sopra.
 */
describe("Vivo: coppie delle schermate", () => {
  const TINTS = SEMANTIC.map((v) => `${v}-tint`);
  for (const mode of MODES) {
    describe(mode, () => {
      const p = resolved("vivo", mode);
      const c = (fg: string, bg: string) => contrastRatio(p[fg], p[bg]);
      it("campi e interruttore spento dentro una scheda tinta: bordo dei controlli su ogni fondo tinto >= 3", () => {
        for (const t of TINTS) expect(c("--color-control-border", t)).toBeGreaterThanOrEqual(3);
      });
      it("avviso a comparsa (testo sull'inchiostro) >= 4,5", () => {
        expect(c("--color-on-ink", "--color-ink")).toBeGreaterThanOrEqual(4.5);
      });
      it("interruttore acceso, anelli, strisce di stato e barre: colore pieno su superficie e carta >= 3", () => {
        for (const v of SEMANTIC) {
          expect(c(v, "--color-surface")).toBeGreaterThanOrEqual(3);
          expect(c(v, "--color-paper")).toBeGreaterThanOrEqual(3);
        }
      });
      it("pulsante pieno dentro una scheda tinta (testo sopra il colore della scheda) e pulsante chiaro (colore su superficie) >= 4,5", () => {
        for (const v of SEMANTIC) {
          expect(c("--color-on-fill", v)).toBeGreaterThanOrEqual(4.5);
          expect(c(v, "--color-surface")).toBeGreaterThanOrEqual(4.5);
        }
      });
    });
  }
});
