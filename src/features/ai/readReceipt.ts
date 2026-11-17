// Lettura di uno scontrino da una o più foto: richiesta, chiamata, interpretazione, controllo del totale.
import {
  buildReceiptRequest,
  checkReceiptTotals,
  parseReceiptResponse,
  type AiImage,
  type AiUsage,
  type ReceiptReading,
  type TotalsCheck,
} from "@/core/ai";
import { callAi, type CallArgs } from "./call";
import type { ProviderId } from "./providers/types";

export interface ReadReceiptArgs extends Omit<CallArgs, "request"> {
  images: readonly AiImage[];
  /** Data di oggi `YYYY-MM-DD`. */
  today: string;
}

export interface ReceiptReadResult {
  reading: ReceiptReading;
  check: TotalsCheck;
  /** Token contati per questa lettura (stima prudente se il fornitore non li ha dichiarati). */
  usage: AiUsage;
  usageEstimated: boolean;
  provider: ProviderId;
  model: string;
  cost: number | null;
  currency: string;
  truncated: boolean;
}

/** Lancia un `AiError` se la chiamata fallisce; un testo illeggibile non è un errore: arriva come problemi nella lettura. */
export async function readReceipt(args: ReadReceiptArgs): Promise<ReceiptReadResult> {
  const { images, today, ...rest } = args;
  const { response, provider, model, cost, currency, usage, usageEstimated } = await callAi({ ...rest, request: buildReceiptRequest({ images, today }) });
  const reading = parseReceiptResponse(response.text, { truncated: response.truncated });
  return {
    reading,
    check: checkReceiptTotals(reading),
    usage,
    usageEstimated,
    provider,
    model,
    cost,
    currency,
    truncated: response.truncated,
  };
}
