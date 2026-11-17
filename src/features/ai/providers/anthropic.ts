// API Messages di Anthropic, chiamata direttamente dal browser.
// Intestazioni verificate sulla documentazione ufficiale (platform.claude.com, "Browser-based applications" e "API overview"):
// `x-api-key`, `anthropic-version` e, per le richieste dirette dal browser, `anthropic-dangerous-direct-browser-access: true`.
import { AiError, type AiRequest, type AiResponse } from "@/core/ai";
import { errorFromResponse, postJson } from "./http";
import type { AiProvider, CallOptions } from "./types";

export const ANTHROPIC_BASE_URL = "https://api.anthropic.com";
/** Versione dell'API in vigore (la più recente indicata dalla documentazione). */
export const ANTHROPIC_VERSION = "2026-10-21";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
  /** Solo per chiavi non legate a un'area di lavoro (workspace). */
  workspaceId?: string;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const tokens = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

export function buildAnthropicBody(request: AiRequest, model: string): Record<string, unknown> {
  return {
    model,
    max_tokens: request.maxOutputTokens,
    system: request.instructions,
    messages: [
      {
        role: "user",
        content: [
          ...request.images.map((image) => ({
            type: "image",
            source: { type: "base64", media_type: image.mediaType, data: image.dataBase64 },
          })),
          { type: "text", text: request.text },
        ],
      },
    ],
  };
}

export function parseAnthropicResponse(json: unknown, fallbackModel: string): AiResponse {
  if (!isObj(json)) throw new AiError("invalid_response");
  // i token si leggono per primi: una risposta rifiutata o illeggibile è comunque pagata, e va contata
  const u = isObj(json.usage) ? json.usage : {};
  const declared = typeof u.input_tokens === "number" && typeof u.output_tokens === "number";
  // una risposta ricevuta a una richiesta con contenuto non può costare zero token in ingresso o in uscita: uno zero vale come non dichiarato
  const usageReported = declared && tokens(u.input_tokens) > 0 && tokens(u.output_tokens) > 0;
  const usage = {
    inputTokens: tokens(u.input_tokens) + tokens(u.cache_creation_input_tokens) + tokens(u.cache_read_input_tokens),
    outputTokens: tokens(u.output_tokens),
  };
  // un rifiuto o una risposta vuota può avere zero token in uscita, ma non in ingresso
  const charged = declared && usage.inputTokens > 0 ? { usage } : {};
  if (!Array.isArray(json.content)) throw new AiError("invalid_response", charged);
  const stop = json.stop_reason;
  if (stop === "refusal") {
    const details = isObj(json.stop_details) ? json.stop_details : undefined;
    const explanation = details && typeof details.explanation === "string" ? details.explanation : undefined;
    throw new AiError("refused", { detail: explanation?.slice(0, 300), ...charged });
  }
  const text = json.content
    .filter((block): block is { type: "text"; text: string } => isObj(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
  const truncated = stop === "max_tokens" || stop === "model_context_window_exceeded";
  if (text === "" && !truncated) throw new AiError("invalid_response", charged);
  return {
    text,
    usage,
    usageReported,
    model: typeof json.model === "string" && json.model !== "" ? json.model : fallbackModel,
    truncated,
  };
}

export function createAnthropicProvider(config: AnthropicConfig): AiProvider {
  const apiKey = config.apiKey.trim();
  return {
    id: "anthropic",
    model: config.model,
    async call(request: AiRequest, options?: CallOptions): Promise<AiResponse> {
      if (apiKey === "") throw new AiError("missing_key");
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      };
      if (config.workspaceId?.trim()) headers["anthropic-workspace-id"] = config.workspaceId.trim();
      const result = await postJson({
        url: `${ANTHROPIC_BASE_URL}/v1/messages`,
        headers,
        body: buildAnthropicBody(request, config.model),
        options,
      });
      if (!result.ok) throw errorFromResponse(result, [apiKey]);
      return parseAnthropicResponse(result.json, config.model);
    },
  };
}
