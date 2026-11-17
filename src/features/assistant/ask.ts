// Una domanda all'assistente: costruisce la richiesta, chiama il fornitore con la chiave dell'utente (rispettando il tetto
// di spesa), legge la risposta. Non lancia: ogni esito è un valore da mostrare.
import { formatCost, isAiError } from "@/core/ai";
import { buildAssistantRequest, cleanQuestionText, parseAssistantResponse, type AssistantOutcome } from "@/core/views";
import { callAi, type CallArgs } from "../ai/call";
import { describeAiError } from "../ai/messages";
import { activeModel, loadAiSettings } from "../ai/settings";

export const MIN_QUESTION_CHARS = 3;

export type AskResult =
  | {
      kind: "answer";
      question: string;
      outcome: AssistantOutcome;
      /** «0,012 USD», o null se il listino non conosce il modello. */
      cost: string | null;
      /** I token contati sono una stima prudente: il fornitore non li ha dichiarati. */
      usageEstimated: boolean;
    }
  | {
      kind: "error";
      message: string;
      /** Manca la chiave o il tetto di spesa è raggiunto: conviene andare alle impostazioni. */
      needsSettings: boolean;
      aborted: boolean;
    };

export interface AskArgs extends Omit<CallArgs, "request"> {
  question: string;
}

export async function askAssistant(args: AskArgs): Promise<AskResult> {
  const { question: raw, ...rest } = args;
  const question = cleanQuestionText(raw);
  if (question.length < MIN_QUESTION_CHARS) {
    return { kind: "error", message: "Scrivi la tua domanda con qualche parola in più.", needsSettings: false, aborted: false };
  }
  try {
    const result = await callAi({ ...rest, request: buildAssistantRequest({ question }) });
    const outcome = parseAssistantResponse(result.response.text, { truncated: result.response.truncated });
    return {
      kind: "answer",
      question,
      outcome,
      cost: result.cost === null ? null : formatCost(result.cost, result.currency),
      usageEstimated: result.usageEstimated,
    };
  } catch (error) {
    if (!isAiError(error)) {
      return { kind: "error", message: "Qualcosa non ha funzionato. Riprova.", needsSettings: false, aborted: false };
    }
    let provider: Parameters<typeof describeAiError>[1]["provider"] = "anthropic";
    let model: string | undefined;
    try {
      const settings = await loadAiSettings(args.store, args.now?.());
      provider = settings.provider;
      model = activeModel(settings);
    } catch {
      // il messaggio generico basta
    }
    return {
      kind: "error",
      message: describeAiError(error, { provider, ...(model !== undefined ? { model } : {}) }),
      needsSettings: error.kind === "missing_key" || error.kind === "budget" || error.kind === "rejected_key",
      aborted: error.kind === "aborted",
    };
  }
}
