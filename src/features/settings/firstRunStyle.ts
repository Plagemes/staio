import {
  DEFAULT_MODE,
  DEFAULT_THEME,
  STYLE_CHOICE_ATTR,
  applyTheme,
  normalizeChoice,
  readStoredChoice,
  storedStyleChosen,
  writeStoredChoice,
  type ThemeChoice,
} from "@/design";
import { chooseAppearance } from "./appearance";

/** La scelta dello stile si propone solo sulla pagina iniziale dell'app: un collegamento diretto (cattura, condivisione) non viene fermato. */
export const isStyleChoicePath = (pathname: string): boolean => pathname === "/app" || pathname === "/app/";

/**
 * Prima apertura: nessun segno di stile scelto nella copia locale, nessuna preferenza in archivio,
 * e la copia locale assente o con i valori predefiniti (la riscrive ThemeSync anche quando nessuno ha scelto).
 * Chi ha già una preferenza, in archivio o in locale, non vede la scelta.
 */
export function needsStyleChoice(raw: string | null, saved: { theme: unknown; mode: unknown }): boolean {
  if (storedStyleChosen(raw)) return false;
  if (saved.theme !== undefined || saved.mode !== undefined) return false;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw ?? "null");
  } catch {
    parsed = null;
  }
  const local = normalizeChoice(parsed);
  return local.theme === DEFAULT_THEME && local.mode === DEFAULT_MODE;
}

export interface StyleChoiceInput {
  pathname: string;
  /** Copia locale: undefined finché non è stata letta (server, primo disegno). */
  raw: string | null | undefined;
  storageOk: boolean;
  saved: { theme: unknown; mode: unknown; loading: boolean; error: unknown };
}

/**
 * "wait": non si sa ancora; "offer": proporre la scelta; "skip": aprire l'app normalmente.
 * Ogni dubbio (archivio o localStorage non disponibili, errori) porta a "skip": la scelta resta in Impostazioni, Aspetto.
 */
export function decideStyleChoice(input: StyleChoiceInput): "wait" | "offer" | "skip" {
  if (!isStyleChoicePath(input.pathname)) return "skip";
  if (input.raw === undefined || input.saved.loading) return "wait";
  if (!input.storageOk || input.saved.error) return "skip";
  try {
    return needsStyleChoice(input.raw, { theme: input.saved.theme, mode: input.saved.mode }) ? "offer" : "skip";
  } catch {
    return "skip";
  }
}

/** Prova uno stile su tutta la pagina senza salvarlo. */
export function previewStyle(choice: ThemeChoice): void {
  applyTheme(choice);
}

/** «Usa questo stile»: applica, salva in archivio e segna la scelta fatta. */
export async function confirmStyle(choice: ThemeChoice): Promise<void> {
  await chooseAppearance(choice);
}

/** «Decido dopo»: resta Registro, come il dispositivo; la scelta non viene più proposta. Nulla va in archivio. */
export function postponeStyle(): void {
  const choice = { theme: DEFAULT_THEME, mode: DEFAULT_MODE };
  applyTheme(choice);
  writeStoredChoice(choice, { chosen: true });
}

/** Chi aveva già una preferenza: si segna una volta, così lo script iniziale non mette più la pagina in attesa. */
export function markStyleChosen(): void {
  writeStoredChoice(readStoredChoice(), { chosen: true });
}

export function clearStyleChoicePending(): void {
  document.documentElement.removeAttribute(STYLE_CHOICE_ATTR);
}

/** Se la schermata di scelta si rompe: torna lo stile salvato (Registro se non c'è) e si apre l'app. */
export function abandonStyleChoice(): void {
  try {
    applyTheme(readStoredChoice());
  } catch {
    // niente da ripristinare
  }
  clearStyleChoicePending();
}
