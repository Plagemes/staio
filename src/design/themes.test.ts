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
        const p = palette(theme.id, mode);
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
  it("ogni tema definisce le stesse variabili di Registro, in chiaro e in scuro", () => {
    const keys = Object.keys(palette("registro", "light")).sort();
    for (const t of THEMES) for (const m of MODES) expect(Object.keys(palette(t.id, m)).sort()).toEqual(keys);
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

describe("scelte manomesse", () => {
  it("chiavi ereditate dagli oggetti danno il tema predefinito", () => {
    for (const bad of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(isThemeId(bad)).toBe(false);
      expect(isThemeMode(bad)).toBe(false);
      expect(normalizeChoice({ theme: bad, mode: bad })).toEqual({ theme: DEFAULT_THEME, mode: DEFAULT_MODE });
    }
  });
});
