import { DEFAULT_THEME, normalizeChoice, resolveMode, themeColorOf, type ThemeChoice } from "./themes";

/** Copia sincrona della scelta, leggibile dallo script iniziale prima del primo disegno. La fonte resta l'archivio (`@/data`). */
export const APPEARANCE_STORAGE_KEY = "appearance";

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

export function readStoredChoice(): ThemeChoice {
  try {
    return normalizeChoice(JSON.parse(window.localStorage.getItem(APPEARANCE_STORAGE_KEY) ?? "null"));
  } catch {
    return normalizeChoice(null);
  }
}

export function writeStoredChoice(choice: ThemeChoice): void {
  try {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(choice));
  } catch {
    // archivio del browser non disponibile: la scelta vale solo per questa sessione
  }
}

export const systemPrefersDark = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.(SYSTEM_DARK_QUERY).matches;

let revision = 0;

/**
 * Applica il tema alla radice del documento e alla barra del browser. Restituisce la modalità effettiva.
 * Il ritocco di `--theme-rev` serve a chi osserva solo `style`/`data-theme` (i modelli 3D) e deve accorgersi di un cambio di tema.
 */
export function applyTheme(choice: ThemeChoice): "light" | "dark" {
  const root = document.documentElement;
  if (choice.theme === DEFAULT_THEME) root.removeAttribute("data-palette");
  else root.setAttribute("data-palette", choice.theme);
  if (choice.mode === "device") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", choice.mode);

  const resolved = resolveMode(choice.mode, systemPrefersDark());
  const color = themeColorOf(choice.theme, resolved);
  for (const meta of document.head.querySelectorAll('meta[name="theme-color"]')) {
    meta.removeAttribute("media");
    meta.setAttribute("content", color);
  }
  root.style.setProperty("--theme-rev", String(++revision));
  return resolved;
}
