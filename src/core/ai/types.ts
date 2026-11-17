// Tipi indipendenti dal fornitore di intelligenza artificiale. Nessun accesso a rete, disco o React.

export const AI_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type AiImageType = (typeof AI_IMAGE_TYPES)[number];

export interface AiImage {
  mediaType: AiImageType;
  /** Contenuto in base64, senza prefisso `data:`. */
  dataBase64: string;
}

export interface AiRequest {
  /** Istruzioni di sistema: cosa fare e in che forma rispondere. */
  instructions: string;
  /** Messaggio dell'utente che accompagna le immagini. */
  text: string;
  images: readonly AiImage[];
  /** Limite alla lunghezza della risposta, in token. */
  maxOutputTokens: number;
}

export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface AiResponse {
  text: string;
  usage: AiUsage;
  /** Modello che ha risposto, come lo dichiara il fornitore. */
  model: string;
  /** La risposta si è fermata per il limite di lunghezza: il testo può essere incompleto. */
  truncated: boolean;
  /** Il fornitore ha dichiarato i token usati. Se no, `usage` è zero e chi conta deve ricorrere a una stima. */
  usageReported: boolean;
}

/**
 * Motivi per cui una chiamata fallisce. Tutti sono mostrabili all'utente senza rivelare la chiave.
 * - `browser_not_allowed`: l'organizzazione del fornitore non accetta chiamate dirette dal browser.
 * - `billing`: credito esaurito o problema di pagamento sul conto del fornitore.
 */
export type AiErrorKind =
  | "missing_key"
  | "rejected_key"
  | "forbidden"
  | "browser_not_allowed"
  | "billing"
  | "rate_limited"
  | "network"
  | "timeout"
  | "aborted"
  | "model_not_found"
  | "bad_request"
  | "request_too_large"
  | "overloaded"
  | "server"
  | "refused"
  | "invalid_response"
  | "budget";

export class AiError extends Error {
  readonly kind: AiErrorKind;
  readonly status?: number;
  /** Frase del fornitore, già ripulita da ogni segreto e accorciata. */
  readonly detail?: string;
  readonly retryAfterSeconds?: number;
  /** Token dichiarati dal fornitore per una risposta 200 che poi è stata rifiutata o non si leggeva: la chiamata è comunque pagata. */
  readonly usage?: AiUsage;
  /** La richiesta era già partita quando si è interrotta (annullata o scaduta): può essere stata addebitata. */
  readonly afterSend?: boolean;

  constructor(
    kind: AiErrorKind,
    extra: { status?: number; detail?: string; retryAfterSeconds?: number; usage?: AiUsage; afterSend?: boolean } = {},
  ) {
    super(`ai_error:${kind}`);
    this.name = "AiError";
    this.kind = kind;
    this.status = extra.status;
    this.detail = extra.detail;
    this.retryAfterSeconds = extra.retryAfterSeconds;
    this.usage = extra.usage;
    this.afterSend = extra.afterSend;
  }
}

export function isAiError(value: unknown): value is AiError {
  return value instanceof AiError;
}
