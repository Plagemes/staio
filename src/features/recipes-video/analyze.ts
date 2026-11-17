// Analisi di un video sul dispositivo: didascalia, parlato e fotogrammi vanno al fornitore scelto dall'utente con la sua
// chiave, tramite `callAi` (che controlla la chiave, il tetto di spesa e conta l'uso). Non passa da nessun altro servizio.
import { buildVideoRecipeRequest } from "@/core/ai/videoRecipe";
import { parseVideoRecipe, type VideoRecipeReading } from "@/core/ai/videoRecipeParse";
import type { ExtractedVideo } from "@/core/ai/videoRecipeService";
import { callAi, type CallArgs } from "../ai/call";

export interface ReadVideoArgs extends Omit<CallArgs, "request"> {
  video: Pick<ExtractedVideo, "caption" | "transcript" | "frames" | "durationSec">;
}

export interface VideoReadResult {
  reading: VideoRecipeReading;
  cost: number | null;
  currency: string;
  usageEstimated: boolean;
  truncated: boolean;
  /** Il modello che ha risposto, come lo dichiara il fornitore. */
  model: string;
}

/** Lancia un `AiError` se la chiamata fallisce; un testo illeggibile non è un errore: arriva come problemi nella lettura. */
export async function readVideo(args: ReadVideoArgs): Promise<VideoReadResult> {
  const { video, ...rest } = args;
  const request = buildVideoRecipeRequest({
    caption: video.caption,
    ...(video.transcript ? { transcript: video.transcript } : {}),
    frames: video.frames,
    durationSec: video.durationSec,
  });
  const result = await callAi({ ...rest, request });
  return {
    reading: parseVideoRecipe(result.response.text, { truncated: result.response.truncated }),
    cost: result.cost,
    currency: result.currency,
    usageEstimated: result.usageEstimated,
    truncated: result.response.truncated,
    model: result.response.model,
  };
}
