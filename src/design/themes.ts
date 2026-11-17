/** Elenco dei temi e scelta chiaro/scuro. I colori stanno solo nei CSS (tokens.css, themes.css); qui solo ciò che serve prima che il CSS sia disponibile. */

export type ThemeId = "vivo" | "registro" | "bottega" | "ardesia" | "netto";
export type ThemeMode = "light" | "dark" | "device";

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  description: string;
  /** Colore della carta (chiaro, scuro) per la barra del browser: la meta tag non legge le variabili CSS. Verificato contro il CSS dal test. */
  themeColor: readonly [light: string, dark: string];
}

export const DEFAULT_THEME: ThemeId = "registro";
export const DEFAULT_MODE: ThemeMode = "device";

/** In ordine di presentazione: Vivo e Registro per primi. Il predefinito resta Registro (DEFAULT_THEME). */
export const THEMES: readonly ThemeInfo[] = [
  { id: "vivo", name: "Vivo", description: "Colori pieni con un significato, schede e controlli pieni.", themeColor: ["#f2f2f7", "#000000"] },
  { id: "registro", name: "Registro", description: "Carta avorio, inchiostro, verde bosco.", themeColor: ["#f6f5f1", "#101214"] },
  { id: "bottega", name: "Bottega", description: "Carta calda, inchiostro bruno, ruggine.", themeColor: ["#f5efe4", "#17120e"] },
  { id: "ardesia", name: "Ardesia", description: "Carta fredda, inchiostro ardesia, blu notte.", themeColor: ["#f1f3f5", "#0f1318"] },
  { id: "netto", name: "Netto", description: "Bianco e nero puri, alto contrasto.", themeColor: ["#ffffff", "#000000"] },
];

export const MODES: readonly { id: ThemeMode; name: string }[] = [
  { id: "light", name: "Chiaro" },
  { id: "dark", name: "Scuro" },
  { id: "device", name: "Come il dispositivo" },
];

/** Chiavi delle impostazioni salvate in `@/data` (rientrano nell'esportazione delle impostazioni). */
export const THEME_SETTING_KEY = "appearance.theme";
export const MODE_SETTING_KEY = "appearance.mode";

export const isThemeId = (v: unknown): v is ThemeId => THEMES.some((t) => t.id === v);
export const isThemeMode = (v: unknown): v is ThemeMode => MODES.some((m) => m.id === v);

export interface ThemeChoice {
  theme: ThemeId;
  mode: ThemeMode;
}

export function normalizeChoice(v: unknown): ThemeChoice {
  const o = typeof v === "object" && v !== null ? (v as Record<string, unknown>) : {};
  return {
    theme: isThemeId(o.theme) ? o.theme : DEFAULT_THEME,
    mode: isThemeMode(o.mode) ? o.mode : DEFAULT_MODE,
  };
}

export const resolveMode = (mode: ThemeMode, systemDark: boolean): "light" | "dark" =>
  mode === "device" ? (systemDark ? "dark" : "light") : mode;

export function themeColorOf(theme: ThemeId, resolved: "light" | "dark"): string {
  const info = THEMES.find((t) => t.id === theme) ?? THEMES.find((t) => t.id === DEFAULT_THEME)!;
  return info.themeColor[resolved === "dark" ? 1 : 0];
}
