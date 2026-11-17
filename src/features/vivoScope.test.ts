import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Le schermate in Vivo cambiano solo con regole limitate a [data-palette="vivo"]: negli altri temi non cambia niente.
 * Qui si controlla che le classi e gli attributi aggiunti per Vivo non abbiano resa fuori da quelle regole.
 */
const ROOTS = ["../features", "../app", "../design/components"].map((p) => fileURLToPath(new URL(p, import.meta.url)));
const VIVO = ':global([data-palette="vivo"])';

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return cssFiles(path);
    return name.endsWith(".module.css") ? [path] : [];
  });
}

/** Selettori di ogni regola (anche dentro @media), senza commenti. */
function selectors(css: string): string[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  for (const m of text.matchAll(/([^{}]+)\{[^{}]*\}/g)) {
    const head = m[1].trim();
    if (head.startsWith("@") || head === "" || /^(from|to|\d+%)/.test(head)) continue;
    out.push(...head.split(",").map((s) => s.trim()));
  }
  return out;
}

const FILES = ROOTS.flatMap(cssFiles).map((path) => ({ path, sel: selectors(readFileSync(path, "utf8")) }));

/** Classi messe nel markup solo per Vivo: altrove non devono avere regole. */
const VIVO_ONLY_CLASSES: Record<string, string[]> = {
  "ui.module.css": [".group", ".tile", ".tone", ".stateRow", ".fields"],
  "Today.module.css": [".dayLabel", ".momentList"],
  "health.module.css": [".ring"],
  "frigo.module.css": [".scene"],
  "LotSheet.module.css": [".rows"],
};

/** Attributi messi nel markup per Vivo. */
const VIVO_ONLY_ATTRIBUTES = ["[data-tone", "[data-state", "[data-status", "[data-level", "[data-nutrient", "[data-estimated"];

describe("Vivo nelle schermate: niente cambia negli altri temi", () => {
  it("trova i moduli CSS", () => {
    expect(FILES.length).toBeGreaterThan(20);
  });

  it("le classi aggiunte per Vivo hanno regole solo sotto [data-palette=\"vivo\"]", () => {
    for (const [file, classes] of Object.entries(VIVO_ONLY_CLASSES)) {
      const hits = FILES.filter((f) => f.path.endsWith(file));
      expect(hits.length).toBe(1);
      for (const s of hits[0].sel) {
        for (const cls of classes) {
          if (new RegExp(String.raw`\.${cls.slice(1)}(?![\w-])`).test(s)) expect(s.startsWith(VIVO), `${file}: ${s}`).toBe(true);
        }
      }
    }
  });

  it("gli attributi aggiunti per Vivo hanno regole solo sotto [data-palette=\"vivo\"]", () => {
    for (const f of FILES) {
      for (const s of f.sel) {
        if (VIVO_ONLY_ATTRIBUTES.some((a) => s.includes(a))) expect(s.startsWith(VIVO), `${f.path}: ${s}`).toBe(true);
      }
    }
  });
});
