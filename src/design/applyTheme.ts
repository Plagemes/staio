import { DEFAULT_THEME, normalizeChoice, resolveMode, themeColorOf, type ThemeChoice } from "./themes";

/**
 * Copia sincrona della scelta, leggibile dallo script iniziale prima del primo disegno. La fonte resta l'archivio (`@/data`).
 * Forma: `{ theme, mode, chosen? }`; `chosen: true` dice che lo stile è già stato scelto (o rimandato) e la scelta iniziale non va più proposta.
 */
export const APPEARANCE_STORAGE_KEY = "appearance";

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/** Attributo sulla radice, valore "pending", finché la shell non ha deciso se proporre la scelta dello stile. */
export const STYLE_CHOICE_ATTR = "data-style-choice";

/** Ritardo massimo (ms) per cui la pagina resta in attesa della scelta dello stile; lo script iniziale toglie l'attesa da solo. */
export const STYLE_CHOICE_MAX_WAIT = 800;

/** Vero se l'archivio sincrono del browser si può leggere e scrivere (non lo è in alcune finestre private o con i dati bloccati). */
export function isStorageAvailable(): boolean {
  try {
    const probe = `${APPEARANCE_STORAGE_KEY}.probe`;
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** Testo salvato così com'è (null se manca o se l'archivio del browser non risponde). */
export function readStoredRaw(): string | null {
  try {
    return window.localStorage.getItem(APPEARANCE_STORAGE_KEY);
  } catch {
    return null;
  }
}

function parseStored(raw: string | null): unknown {
  try {
    return JSON.parse(raw ?? "null");
  } catch {
    return null;
  }
}

export function readStoredChoice(): ThemeChoice {
  return normalizeChoice(parseStored(readStoredRaw()));
}

/** Vero se la copia salvata porta il segno di stile già scelto. */
export function storedStyleChosen(raw: string | null): boolean {
  const o = parseStored(raw);
  return typeof o === "object" && o !== null && (o as Record<string, unknown>).chosen === true;
}

/** Salva la copia sincrona. Il segno di stile scelto resta com'era, salvo `chosen: true` esplicito. */
export function writeStoredChoice(choice: ThemeChoice, opts: { chosen?: boolean } = {}): void {
  try {
    const chosen = opts.chosen ?? storedStyleChosen(readStoredRaw());
    const record = chosen ? { theme: choice.theme, mode: choice.mode, chosen: true } : { theme: choice.theme, mode: choice.mode };
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(record));
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
