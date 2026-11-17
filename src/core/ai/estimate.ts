// Stime prudenti dell'uso, per quando il fornitore non dice quanto ha contato (risposta senza token, richiesta interrotta dopo l'invio).
// Sono volutamente per eccesso: meglio fermarsi un po' prima del tetto che oltrepassarlo senza accorgersene.
import type { AiRequest, AiUsage } from "./types";

/** Un'immagine costa almeno questo, qualunque sia la sua dimensione. */
const IMAGE_FLOOR_TOKENS = 1600;
/** Token per carattere base64 di un'immagine: abbondante rispetto ai fornitori noti. */
const IMAGE_BASE64_CHARS_PER_TOKEN = 250;

/** Token in ingresso della richiesta, per eccesso: un token ogni tre caratteri di testo e una stima abbondante per ogni immagine. */
export function estimateInputTokens(request: AiRequest): number {
  const textTokens = Math.ceil((request.instructions.length + request.text.length) / 3);
  const imageTokens = request.images.reduce(
    (sum, image) => sum + Math.max(IMAGE_FLOOR_TOKENS, Math.ceil(image.dataBase64.length / IMAGE_BASE64_CHARS_PER_TOKEN)),
    0,
  );
  return textTokens + imageTokens;
}

/** Uso prudente: l'ingresso inviato e il massimo di uscita richiesto, come se il modello avesse scritto fino al limite. */
export function estimateUsage(request: AiRequest): AiUsage {
  return { inputTokens: estimateInputTokens(request), outputTokens: Math.max(0, Math.floor(request.maxOutputTokens)) };
}
