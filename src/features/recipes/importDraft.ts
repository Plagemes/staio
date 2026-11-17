// Importazione: chiamata a `POST /api/ricetta`, messaggi per ogni esito e composizione della bozza. Il contenuto
// che arriva da una pagina è solo testo: qui non si interpreta mai come HTML.
import {
  parseRecipeText,
  type ExtractedRecipe,
  type ParsedIngredient,
  type RecipeDraft,
  type RecipeSource,
  type RecipeStep,
  type RecipeTimes,
} from "@/core/recipes";

export const IMPORT_ENDPOINT = "/api/ricetta";

export type ImportErrorCode =
  | "invalid_request"
  | "unsupported_media_type"
  | "payload_too_large"
  | "forbidden_origin"
  | "rate_limited"
  | "busy"
  | "invalid_url"
  | "not_https"
  | "address_not_allowed"
  | "unreachable"
  | "timeout"
  | "too_large"
  | "not_html"
  | "upstream_error"
  | "too_many_redirects"
  | "internal";

export type ClientErrorCode = ImportErrorCode | "offline" | "network" | "bad_response" | "empty";

const PASTE_HINT = "Puoi sempre incollare il testo della ricetta.";

export const IMPORT_MESSAGES: Record<ClientErrorCode, string> = {
  empty: "Scrivi o incolla l'indirizzo della pagina.",
  offline: `Senza rete non posso leggere una pagina. ${PASTE_HINT}`,
  network: `Non riesco a collegarmi. Controlla la rete e riprova. ${PASTE_HINT}`,
  bad_response: `La risposta non era leggibile. Riprova più tardi. ${PASTE_HINT}`,
  invalid_request: `La richiesta non è andata a buon fine. Riprova. ${PASTE_HINT}`,
  unsupported_media_type: `La richiesta non è andata a buon fine. Riprova. ${PASTE_HINT}`,
  payload_too_large: "L'indirizzo è troppo lungo.",
  forbidden_origin: `Il servizio non accetta la richiesta da questa origine: apri Staio dal suo indirizzo normale e riprova. ${PASTE_HINT}`,
  rate_limited: "Troppe richieste in poco tempo: aspetta un minuto e riprova.",
  busy: "Il servizio è occupato: riprova tra poco.",
  invalid_url: "L'indirizzo non sembra valido. Controlla di averlo copiato per intero.",
  not_https: "Sono ammessi solo indirizzi che iniziano con https.",
  address_not_allowed: "Questo indirizzo non è ammesso.",
  unreachable: `Non riesco a raggiungere il sito. ${PASTE_HINT}`,
  timeout: `Il sito ha impiegato troppo a rispondere. Riprova, oppure incolla il testo.`,
  too_large: `La pagina è troppo grande da leggere. ${PASTE_HINT}`,
  not_html: `L'indirizzo non porta a una pagina web. ${PASTE_HINT}`,
  upstream_error: `Il sito ha risposto con un errore. ${PASTE_HINT}`,
  too_many_redirects: `Il sito rimanda ad altri indirizzi troppe volte. ${PASTE_HINT}`,
  internal: `Qualcosa non ha funzionato. Riprova più tardi. ${PASTE_HINT}`,
};

export type ImportOutcome =
  | { kind: "recipe"; recipe: ExtractedRecipe; alternatives: number; url: string }
  /** La pagina non ha dati strutturati: testo ripulito da far leggere alla lettura da testo. */
  | { kind: "text"; title?: string; text: string; url: string }
  | { kind: "error"; code: ClientErrorCode; message: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === "string";

function isExtractedRecipe(v: unknown): v is ExtractedRecipe {
  return (
    isRecord(v) &&
    isString(v.title) &&
    Array.isArray(v.ingredients) &&
    v.ingredients.every((i) => isRecord(i) && isString(i.name)) &&
    Array.isArray(v.steps) &&
    v.steps.every((s) => isRecord(s) && isString(s.text))
  );
}

const ERROR_CODES = new Set<string>(Object.keys(IMPORT_MESSAGES));

/** Legge con prudenza la risposta della rotta: qualunque forma inattesa diventa un errore, mai un'eccezione. */
export function readImportResponse(json: unknown, url: string): ImportOutcome {
  const bad: ImportOutcome = { kind: "error", code: "bad_response", message: IMPORT_MESSAGES.bad_response };
  if (!isRecord(json)) return bad;
  if (json.ok === false) {
    const code = isRecord(json.error) && isString(json.error.code) && ERROR_CODES.has(json.error.code) ? (json.error.code as ClientErrorCode) : "internal";
    return { kind: "error", code, message: IMPORT_MESSAGES[code] };
  }
  if (json.ok !== true) return bad;
  if (json.found === true && isExtractedRecipe(json.recipe)) {
    return {
      kind: "recipe",
      recipe: json.recipe,
      alternatives: Array.isArray(json.alternatives) ? json.alternatives.length : 0,
      url,
    };
  }
  if (json.found === false && isString(json.text)) {
    return { kind: "text", ...(isString(json.title) && json.title !== "" ? { title: json.title } : {}), text: json.text, url };
  }
  return bad;
}

/**
 * Prepara l'indirizzo: senza schema si assume https. Restituisce un errore chiaro per ciò che il server rifiuterebbe
 * comunque, così non si aspetta una richiesta inutile.
 */
export function normalizeUrl(input: string): { ok: true; url: string } | { ok: false; code: ClientErrorCode } {
  const t = input.trim();
  if (t === "") return { ok: false, code: "empty" };
  if (/\s/.test(t)) return { ok: false, code: "invalid_url" };
  if (/^http:\/\//i.test(t)) return { ok: false, code: "not_https" };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:") return { ok: false, code: "not_https" };
    if (!u.hostname.includes(".")) return { ok: false, code: "invalid_url" };
    return { ok: true, url: u.href };
  } catch {
    return { ok: false, code: "invalid_url" };
  }
}

export interface ImportDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  /** `navigator.onLine`: falso = niente rete. */
  online: boolean;
  signal?: AbortSignal;
}

/** Chiede alla rotta la ricetta di una pagina. Non lancia: ogni problema è un esito `error` con il suo messaggio. */
export async function importFromUrl(input: string, deps: ImportDeps): Promise<ImportOutcome> {
  const url = normalizeUrl(input);
  if (!url.ok) return { kind: "error", code: url.code, message: IMPORT_MESSAGES[url.code] };
  if (!deps.online) return { kind: "error", code: "offline", message: IMPORT_MESSAGES.offline };
  let response: Response;
  try {
    response = await deps.fetch(IMPORT_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: url.url }),
      ...(deps.signal ? { signal: deps.signal } : {}),
    });
  } catch {
    return { kind: "error", code: "network", message: IMPORT_MESSAGES.network };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    if (response.status === 429) return { kind: "error", code: "rate_limited", message: IMPORT_MESSAGES.rate_limited };
    return { kind: "error", code: "bad_response", message: IMPORT_MESSAGES.bad_response };
  }
  return readImportResponse(json, url.url);
}

/* ---------- bozza ---------- */

/** Bozza di ricetta da rivedere, più ciò che non si è capito. */
export interface ImportDraft extends RecipeDraft {
  /** Righe non riconosciute, da collocare a mano. */
  leftovers: string[];
  /** Descrizione della pagina, se c'era: non entra nella ricetta, serve solo a chi rivede. */
  description?: string;
  /** Come è stata letta: dati strutturati della pagina o testo. */
  via: "page" | "text";
}

function withOrigin(origin: RecipeSource | undefined, url: string | undefined, author: string | undefined): RecipeSource | undefined {
  const merged: RecipeSource = {
    ...(origin ?? {}),
    ...(origin?.url ? {} : url ? { url } : {}),
    ...(origin?.author ? {} : author ? { author } : {}),
  };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** Bozza dai dati strutturati di una pagina. L'indirizzo richiesto è la fonte, se la pagina non ne dà uno suo. */
export function draftFromExtracted(recipe: ExtractedRecipe, url: string): ImportDraft {
  const origin = withOrigin(recipe.origin, url, undefined);
  return {
    title: recipe.title,
    ...(recipe.servings !== undefined ? { servings: recipe.servings } : {}),
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    ...(recipe.times ? { times: recipe.times } : {}),
    equipment: recipe.equipment,
    tags: recipe.tags,
    ...(origin ? { origin } : {}),
    leftovers: [],
    ...(recipe.description ? { description: recipe.description } : {}),
    via: "page",
  };
}

export interface TextSource {
  url?: string;
  author?: string;
  /** Titolo di riserva (per esempio quello della pagina), se il testo non ne ha uno. */
  title?: string;
}

/** Bozza dal testo incollato o dal testo ripulito di una pagina. */
export function draftFromText(text: string, source: TextSource = {}): ImportDraft {
  const parsed = parseRecipeText(text);
  const origin = withOrigin(undefined, source.url?.trim() || undefined, source.author?.trim() || undefined);
  const title = parsed.title ?? (source.title?.trim() || undefined);
  const times: RecipeTimes | undefined = parsed.times;
  return {
    ...(title ? { title } : {}),
    ...(parsed.servings !== undefined ? { servings: parsed.servings } : {}),
    ingredients: parsed.ingredients as ParsedIngredient[],
    steps: parsed.steps as RecipeStep[],
    ...(times ? { times } : {}),
    ...(origin ? { origin } : {}),
    leftovers: parsed.unrecognized,
    via: "text",
  };
}

/** Il testo ha dato qualcosa su cui lavorare? */
export function draftIsEmpty(d: ImportDraft): boolean {
  return d.ingredients.length === 0 && d.steps.length === 0 && (d.title ?? "") === "";
}

/** Riga di riepilogo per chi rivede: "12 ingredienti, 5 passi. Porzioni: da scrivere." */
export function draftSummary(d: ImportDraft): string {
  const ing = d.ingredients.length === 1 ? "1 ingrediente" : `${d.ingredients.length} ingredienti`;
  const steps = d.steps.length === 1 ? "1 passo" : `${d.steps.length} passi`;
  const servings = d.servings !== undefined ? `Porzioni: ${d.servings}.` : "Porzioni: non indicate, da scrivere.";
  return `${ing}, ${steps}. ${servings}`;
}
