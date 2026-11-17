/** Lettura dei colori di tema dal CSS (solo browser). Non importa three. */
import { FALLBACK_COLORS, type InkColors } from "./materials";

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
