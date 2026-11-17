// Chiamata al servizio di estrazione: POST /estrai { url } con il token. Al servizio va solo il link del video e il
// token del servizio: mai la chiave dell'intelligenza artificiale. La risposta è un dato non fidato e passa dal
// controllo di `parseServiceResponse`. Non lancia: ogni problema è un esito `error` con la sua frase.
import { APP_NAME } from "@/config";
import { SERVICE_LIMITS, parseServiceResponse, type ExtractedVideo } from "@/core/ai/videoRecipeService";
import { isConfigured, serviceHost, type VideoServiceSettings } from "./settings";

export const EXTRACT_PATH = "/estrai";
export const HEALTH_PATH = "/salute";
/** Il servizio si ferma da solo prima; questo è il limite oltre il quale il telefono smette di aspettare. */
export const EXTRACT_TIMEOUT_MS = 150_000;

export type ServiceErrorCode =
  | "not_configured"
  | "offline"
  | "network"
  | "timeout"
  | "aborted"
  | "unauthorized"
  | "rate_limited"
  | "busy"
  | "invalid_url"
  | "domain_not_allowed"
  | "too_long"
  | "too_large"
  | "unavailable"
  | "bad_response"
  | "empty";

const PASTE = "Intanto puoi incollare qui la didascalia.";

export const SERVICE_MESSAGES: Record<ServiceErrorCode, string> = {
  not_configured: `Per leggere il video serve il servizio di estrazione, che non è ancora attivo. ${PASTE}`,
  offline: `Senza rete non posso leggere il video. ${PASTE}`,
  network: `Non riesco a collegarmi al servizio di estrazione: controlla la rete e l'indirizzo nelle impostazioni, oppure il servizio non consente le richieste da qui. ${PASTE}`,
  timeout: `Il servizio ha impiegato troppo a rispondere. Riprova più tardi. ${PASTE}`,
  aborted: "Lettura annullata.",
  unauthorized: "Il servizio non accetta il token. Controllalo nelle impostazioni dei video.",
  rate_limited: "Troppe richieste in poco tempo: aspetta qualche minuto e riprova.",
  busy: "Il servizio sta già leggendo un altro video: riprova tra poco.",
  invalid_url: `Il servizio non riconosce questo indirizzo come un video. ${PASTE}`,
  domain_not_allowed: `Il servizio legge solo i video di Instagram, TikTok e YouTube. ${PASTE}`,
  too_long: `Il video dura più di 5 minuti: il servizio non lo legge. ${PASTE}`,
  too_large: `Il video è troppo grande per il servizio. ${PASTE}`,
  unavailable: `Il servizio non è riuscito a scaricare il video (può essere privato, rimosso o bloccato). ${PASTE}`,
  bad_response: `La risposta del servizio non era nel formato atteso, e non la uso. ${PASTE}`,
  empty: `Dal video non è arrivato né testo né immagini. ${PASTE}`,
};

export type ExtractOutcome = { ok: true; video: ExtractedVideo } | { ok: false; code: ServiceErrorCode; message: string };

const fail = (code: ServiceErrorCode): ExtractOutcome => ({ ok: false, code, message: SERVICE_MESSAGES[code] });

export interface ExtractDeps {
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  online: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Codici di errore che il servizio può scrivere nel corpo della risposta. */
const BODY_CODES: Readonly<Record<string, ServiceErrorCode>> = {
  invalid_url: "invalid_url",
  domain_not_allowed: "domain_not_allowed",
  too_long: "too_long",
  too_large: "too_large",
  unavailable: "unavailable",
  timeout: "timeout",
  busy: "busy",
  rate_limited: "rate_limited",
  unauthorized: "unauthorized",
};

function errorFromStatus(status: number, body: unknown): ServiceErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status === 504) return "timeout";
  const code = typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>).error : undefined;
  if (typeof code === "string" && Object.hasOwn(BODY_CODES, code)) return BODY_CODES[code]!;
  if (status === 503) return "busy";
  if (status >= 500) return "unavailable";
  return "bad_response";
}

async function readLimited(response: Response): Promise<string | undefined> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > SERVICE_LIMITS.maxBodyChars * 2) return undefined;
  const text = await response.text();
  return text.length > SERVICE_LIMITS.maxBodyChars ? undefined : text;
}

/** Combina l'annullamento dell'utente con il tempo massimo. */
function withTimeout(signal: AbortSignal | undefined, ms: number): { signal: AbortSignal; done: () => void; timedOut: () => boolean } {
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort();
  }, ms);
  const onAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
    timedOut: () => expired,
  };
}

/** Chiede al servizio il contenuto di un video. `link` è già un indirizzo https di un video. */
export async function extractVideo(link: string, service: VideoServiceSettings, deps: ExtractDeps): Promise<ExtractOutcome> {
  if (!isConfigured(service)) return fail("not_configured");
  if (!deps.online) return fail("offline");
  const guard = withTimeout(deps.signal, deps.timeoutMs ?? EXTRACT_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await deps.fetch(`${service.url}${EXTRACT_PATH}`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${service.token}` },
        body: JSON.stringify({ url: link }),
        credentials: "omit",
        referrerPolicy: "no-referrer",
        cache: "no-store",
        signal: guard.signal,
      });
    } catch {
      if (deps.signal?.aborted) return fail("aborted");
      return fail(guard.timedOut() ? "timeout" : "network");
    }

    let text: string | undefined;
    try {
      text = await readLimited(response);
    } catch {
      if (deps.signal?.aborted) return fail("aborted");
      return fail(guard.timedOut() ? "timeout" : "network");
    }
    let json: unknown;
    if (text !== undefined) {
      try {
        json = JSON.parse(text);
      } catch {
        json = undefined;
      }
    }
    if (!response.ok) return fail(errorFromStatus(response.status, json));
    if (json === undefined) return fail("bad_response");
    const parsed = parseServiceResponse(json);
    return parsed.ok ? { ok: true, video: parsed.value } : fail(parsed.code);
  } finally {
    guard.done();
  }
}

/** Prova del collegamento: chiede lo stato al servizio, senza token e senza inviare alcun link. */
export async function checkService(
  service: Pick<VideoServiceSettings, "url">,
  deps: { fetch: (input: string, init: RequestInit) => Promise<Response>; signal?: AbortSignal; timeoutMs?: number },
): Promise<{ ok: boolean; message: string }> {
  const guard = withTimeout(deps.signal, deps.timeoutMs ?? 15_000);
  try {
    const response = await deps.fetch(`${service.url}${HEALTH_PATH}`, {
      method: "GET",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal: guard.signal,
    });
    if (!response.ok) return { ok: false, message: `Il servizio ${serviceHost(service.url)} ha risposto con un errore (${response.status}).` };
    return { ok: true, message: `Il servizio ${serviceHost(service.url)} risponde.` };
  } catch {
    return {
      ok: false,
      message: `Non riesco a raggiungere il servizio: controlla l'indirizzo e la rete. Se l'indirizzo è giusto, il servizio potrebbe non consentire le richieste da ${APP_NAME} (impostazione dell'origine ammessa).`,
    };
  } finally {
    guard.done();
  }
}
