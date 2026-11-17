/**
 * Tema dei modelli 3D: stile di resa e colori, letti dal CSS (solo browser). È l'unico punto in cui si sceglie lo stile.
 * Non importa three.
 */
import { FALLBACK_COLORS, type InkColors } from "./materials";

/** `engraving`: tratti a inchiostro che seguono la forma. `color`: superfici piene nel colore dell'alimento. */
export type RenderStyle = "engraving" | "color";

/** Temi dell'app (`data-palette`) che si disegnano a colori. Tutti gli altri restano a incisione. */
export const COLOR_PALETTES: readonly string[] = ["vivo"];

export interface StyleSignals {
  /** `data-model-style` più vicino: forza lo stile, per chi vuole restare a incisione (o a colori) sempre. */
  override?: string | null;
  /** `data-palette` del documento. */
  palette?: string | null;
  /** La pagina porta una propria tavolozza a inchiostro (`--ink`), come la vetrina: resta a incisione. */
  ownInk?: boolean;
}

/** Scelta dello stile, pura: la prova è nei test. */
export function chooseRenderStyle({ override, palette, ownInk }: StyleSignals): RenderStyle {
  if (override === "engraving" || override === "color") return override;
  if (ownInk) return "engraving";
  return palette && COLOR_PALETTES.includes(palette) ? "color" : "engraving";
}

/** Stile di resa e colori come li vede `el`. Basta per ridisegnare tutto quando il tema cambia. */
export interface ThemeSnapshot {
  style: RenderStyle;
  /** Tema scuro (scelto a mano o dal dispositivo). */
  dark: boolean;
  colors: InkColors;
}

let probeCanvas: HTMLCanvasElement | null = null;

/** Converte qualunque colore CSS noto al browser in #rrggbb, passando da un canvas 2D. */
function toHex(css: string): string | null {
  probeCanvas ??= document.createElement("canvas");
  probeCanvas.width = probeCanvas.height = 1;
  const ctx = probeCanvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  // un valore non valido lascia fillStyle invariato: due sentinelle diverse lo smascherano
  ctx.fillStyle = "#010203";
  ctx.fillStyle = css;
  const first = ctx.fillStyle;
  ctx.fillStyle = "#030201";
  ctx.fillStyle = css;
  if (first !== ctx.fillStyle) return null;
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Prima la variabile della pagina (--ink), poi quella dei token dell'app (--color-ink), poi il ripiego. */
function resolve(el: Element, name: string, appName: string, fallback: string): string {
  const probe = document.createElement("span");
  probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;color:var(${name}, var(${appName}, ${fallback}))`;
  el.appendChild(probe);
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return toHex(computed) ?? fallback;
}

/** Legge `--ink`, `--paper`, `--signal` come li vede `el`, con valori di ripiego. */
export function readThemeColors(el: Element): InkColors {
  return {
    ink: resolve(el, "--ink", "--color-ink", FALLBACK_COLORS.ink),
    paper: resolve(el, "--paper", "--color-paper", FALLBACK_COLORS.paper),
    signal: resolve(el, "--signal", "--color-signal", FALLBACK_COLORS.signal),
  };
}

/** Lo stile di resa per `el`, ricavato dal tema attivo. */
export function readRenderStyle(el: Element): RenderStyle {
  return chooseRenderStyle({
    override: el.closest("[data-model-style]")?.getAttribute("data-model-style"),
    palette: document.documentElement.getAttribute("data-palette"),
    ownInk: getComputedStyle(el).getPropertyValue("--ink").trim() !== "",
  });
}

/** Chiaro o scuro: `data-theme` se la scelta è manuale, altrimenti la preferenza del dispositivo. */
export function readIsDark(el: Element): boolean {
  const mode = (el.closest("[data-theme]") ?? document.documentElement).getAttribute("data-theme");
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches === true;
}

export function readTheme(el: Element): ThemeSnapshot {
  return { style: readRenderStyle(el), dark: readIsDark(el), colors: readThemeColors(el) };
}

/** Chiama `onChange` quando cambia il tema (attributo data-theme, classe, preferenza di sistema). */
export function watchTheme(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-palette", "class", "style"] });
  const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
  mq?.addEventListener?.("change", onChange);
  return () => {
    observer.disconnect();
    mq?.removeEventListener?.("change", onChange);
  };
}
