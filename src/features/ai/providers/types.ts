import type { AiRequest, AiResponse } from "@/core/ai";

export const PROVIDER_IDS = ["anthropic", "openai_compatible"] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const PROVIDER_LABELS: Record<ProviderId, string> = {
  anthropic: "Anthropic (Claude)",
  openai_compatible: "Compatibile con OpenAI",
};

export interface CallOptions {
  /** Per annullare la chiamata dall'esterno. */
  signal?: AbortSignal;
  /** Sostituisce `fetch`: serve ai test. */
  fetchImpl?: typeof fetch;
  /** Tempo massimo, in millisecondi. */
  timeoutMs?: number;
}

/** Un fornitore già configurato (chiave e modello inclusi): chi lo usa non tocca mai la chiave. */
export interface AiProvider {
  readonly id: ProviderId;
  readonly model: string;
  call(request: AiRequest, options?: CallOptions): Promise<AiResponse>;
}
