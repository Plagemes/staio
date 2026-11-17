// Servizi compatibili con l'API di OpenAI (Chat Completions), chiamati direttamente dal browser.
// Il servizio deve accettare immagini in `image_url` e consentire le richieste dal browser (CORS): non tutti lo fanno.
import { AiError, normalizeBaseUrl, type AiRequest, type AiResponse } from "@/core/ai";
import { errorFromResponse, postJson, providerMessage } from "./http";
import type { AiProvider, CallOptions } from "./types";

export type TokenParam = "max_completion_tokens" | "max_tokens";

export interface OpenAiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Nome del campo che limita la risposta: i modelli recenti vogliono il primo, molti servizi il secondo. */
  tokenParam?: TokenParam;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const tokens = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

const other = (param: TokenParam): TokenParam => (param === "max_tokens" ? "max_completion_tokens" : "max_tokens");

export function buildOpenAiBody(request: AiRequest, model: string, tokenParam: TokenParam): Record<string, unknown> {
  return {
    model,
    [tokenParam]: request.maxOutputTokens,
    messages: [
      { role: "system", content: request.instructions },
      {
        role: "user",
        content: [
          { type: "text", text: request.text },
          ...request.images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mediaType};base64,${image.dataBase64}` },
          })),
        ],
      },
    ],
  };
}

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isObj(part) && typeof part.text === "string" ? part.text : ""))
      .join("");
  }
  return "";
}

export function parseOpenAiResponse(json: unknown, fallbackModel: string): AiResponse {
  if (!isObj(json)) throw new AiError("invalid_response");
  // i token si leggono per primi: una risposta rifiutata o illeggibile è comunque pagata, e va contata
  const u = isObj(json.usage) ? json.usage : {};
  const declared = typeof u.prompt_tokens === "number" && typeof u.completion_tokens === "number";
  // una risposta ricevuta a una richiesta con contenuto non può costare zero token in ingresso o in uscita: uno zero vale come non dichiarato
  const usageReported = declared && tokens(u.prompt_tokens) > 0 && tokens(u.completion_tokens) > 0;
  const usage = { inputTokens: tokens(u.prompt_tokens), outputTokens: tokens(u.completion_tokens) };
  // un rifiuto o una risposta vuota può avere zero token in uscita, ma non in ingresso
  const charged = declared && usage.inputTokens > 0 ? { usage } : {};
  if (!Array.isArray(json.choices) || !isObj(json.choices[0])) throw new AiError("invalid_response", charged);
  const choice = json.choices[0];
  const message = isObj(choice.message) ? choice.message : {};
  if (choice.finish_reason === "content_filter" || (typeof message.refusal === "string" && message.refusal !== "")) {
    throw new AiError("refused", { detail: typeof message.refusal === "string" ? message.refusal.slice(0, 300) : undefined, ...charged });
  }
  const text = contentText(message.content);
  const truncated = choice.finish_reason === "length";
  if (text === "" && !truncated) throw new AiError("invalid_response", charged);
  return {
    text,
    usage,
    usageReported,
    model: typeof json.model === "string" && json.model !== "" ? json.model : fallbackModel,
    truncated,
  };
}

export function createOpenAiProvider(config: OpenAiConfig): AiProvider {
  const apiKey = config.apiKey.trim();
  return {
    id: "openai_compatible",
    model: config.model,
    async call(request: AiRequest, options?: CallOptions): Promise<AiResponse> {
      if (apiKey === "") throw new AiError("missing_key");
      const base = normalizeBaseUrl(config.baseUrl);
      if (!base.ok) throw new AiError("bad_request", { detail: "indirizzo del servizio non valido" });
      const url = `${base.url}/chat/completions`;
      const headers = { "content-type": "application/json", authorization: `Bearer ${apiKey}` };

      const send = (param: TokenParam) =>
        postJson({ url, headers, body: buildOpenAiBody(request, config.model, param), options });

      const first = config.tokenParam ?? "max_completion_tokens";
      let result = await send(first);
      // alcuni servizi conoscono un solo nome per il limite: se lo dicono, si riprova una volta con l'altro
      if (result.status === 400 && /max_(completion_)?tokens/i.test(providerMessage(result.json) ?? "")) {
        result = await send(other(first));
      }
      if (!result.ok) throw errorFromResponse(result, [apiKey]);
      return parseOpenAiResponse(result.json, config.model);
    },
  };
}
