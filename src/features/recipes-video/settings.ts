// Indirizzo e token del «servizio di estrazione» dei video. Restano nell'archivio locale del dispositivo (tabella
// `settings`, chiave propria): vuoti per impostazione predefinita, fuori dalle copie di sicurezza, tolti da «Cancella
// tutti i dati». Il token vale solo per quel servizio; la chiave dell'intelligenza artificiale non passa mai da qui.
import { normalizeBaseUrl } from "@/core/ai";
import { dexieSettingsStore, type SettingsStore } from "../ai/settings";

export const VIDEO_SERVICE_KEY = "video.service";

export interface VideoServiceSettings {
  /** Origine (e percorso, se c'è) del servizio, senza barra finale. Vuoto = nessun servizio. */
  url: string;
  token: string;
}

export const EMPTY_VIDEO_SERVICE: VideoServiceSettings = { url: "", token: "" };

export const TOKEN_LIMITS = { min: 16, max: 512 } as const;

export type ServiceUrlError = "empty" | "invalid" | "insecure" | "credentials";
export type TokenError = "empty" | "invalid" | "short";

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Legge ciò che è salvato: qualunque forma inattesa vale «nessun servizio». */
export function normalizeVideoService(raw: unknown): VideoServiceSettings {
  if (!isRecord(raw)) return { ...EMPTY_VIDEO_SERVICE };
  const url = typeof raw.url === "string" ? normalizeBaseUrl(raw.url) : undefined;
  const token = typeof raw.token === "string" ? checkToken(raw.token) : undefined;
  if (!url?.ok || !token?.ok) return { ...EMPTY_VIDEO_SERVICE };
  return { url: url.url, token: token.token };
}

export const isConfigured = (s: VideoServiceSettings): boolean => s.url !== "" && s.token !== "";

/** Indirizzo: https (http solo verso questo computer), senza nome utente né password, senza parametri. */
export function checkServiceUrl(input: string): { ok: true; url: string } | { ok: false; error: ServiceUrlError } {
  return normalizeBaseUrl(input);
}

/** Token: una sola riga di caratteri stampabili senza spazi, né troppo corta né troppo lunga. */
export function checkToken(input: string): { ok: true; token: string } | { ok: false; error: TokenError } {
  const token = input.trim();
  if (token === "") return { ok: false, error: "empty" };
  if (!/^[\x21-\x7e]+$/.test(token) || token.length > TOKEN_LIMITS.max) return { ok: false, error: "invalid" };
  if (token.length < TOKEN_LIMITS.min) return { ok: false, error: "short" };
  return { ok: true, token };
}

export const URL_ERRORS: Record<ServiceUrlError, string> = {
  empty: "Scrivi l'indirizzo del servizio.",
  invalid: "L'indirizzo non è valido: deve iniziare con https://.",
  insecure: "Il token viaggia con ogni richiesta: l'indirizzo deve iniziare con https:// (http:// si accetta solo per localhost).",
  credentials: "L'indirizzo non deve contenere nome utente o password.",
};

export const TOKEN_ERRORS: Record<TokenError, string> = {
  empty: "Incolla il token del servizio.",
  invalid: "Il token non è valido: deve essere una sola riga, senza spazi né lettere accentate.",
  short: `Il token è troppo corto: servono almeno ${TOKEN_LIMITS.min} caratteri.`,
};

/**
 * Il token da salvare: quello digitato, oppure, se il campo è vuoto, quello già salvato, ma solo se l'indirizzo resta
 * sulla stessa origine. Cambiando dominio il vecchio token non si riusa: non deve finire a un altro servizio.
 */
export function tokenToSave(saved: VideoServiceSettings, typedUrl: string, typedToken: string): string {
  if (typedToken.trim() !== "") return typedToken;
  if (saved.token === "") return "";
  const next = checkServiceUrl(typedUrl);
  if (!next.ok || !isConfigured(saved)) return "";
  return new URL(next.url).origin === new URL(saved.url).origin ? saved.token : "";
}

export const videoServiceStore =(): SettingsStore => dexieSettingsStore(VIDEO_SERVICE_KEY);

export async function loadVideoService(store: SettingsStore): Promise<VideoServiceSettings> {
  return normalizeVideoService(await store.read());
}

/** Salva dopo aver controllato: restituisce l'errore leggibile se indirizzo o token non vanno. */
export async function saveVideoService(
  store: SettingsStore,
  input: { url: string; token: string },
): Promise<{ ok: true; settings: VideoServiceSettings } | { ok: false; error: string }> {
  const url = checkServiceUrl(input.url);
  if (!url.ok) return { ok: false, error: URL_ERRORS[url.error] };
  const token = checkToken(input.token);
  if (!token.ok) return { ok: false, error: TOKEN_ERRORS[token.error] };
  const next: VideoServiceSettings = { url: url.url, token: token.token };
  await store.update(() => next);
  return { ok: true, settings: next };
}

export async function clearVideoService(store: SettingsStore): Promise<void> {
  await store.update(() => ({ ...EMPTY_VIDEO_SERVICE }));
}

/** Dominio a cui andranno il link del video e il token, da mostrare sempre in chiaro. */
export function serviceHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
