export type CameraProblem =
  /** Pagina non servita in HTTPS (o localhost): il browser non concede la fotocamera. */
  | "insecure"
  /** Il browser non offre l'accesso alla fotocamera. */
  | "unsupported"
  | "denied"
  | "absent"
  /** Fotocamera occupata da un'altra app. */
  | "busy"
  | "failed";

export const CAMERA_MESSAGES: Record<CameraProblem, string> = {
  insecure:
    "La fotocamera si può usare solo su una pagina sicura (indirizzo che comincia con https). Qui non è disponibile: scrivi le cifre del codice.",
  unsupported: "Questo browser non permette di usare la fotocamera dalla pagina. Scrivi le cifre del codice.",
  denied:
    "L'accesso alla fotocamera è stato negato. Puoi consentirlo dalle impostazioni del browser per questo sito, oppure scrivere le cifre del codice.",
  absent: "Non trovo una fotocamera su questo dispositivo. Scrivi le cifre del codice.",
  busy: "La fotocamera è in uso da un'altra app. Chiudila e riprova, oppure scrivi le cifre del codice.",
  failed: "Non sono riuscito ad aprire la fotocamera. Riprova, oppure scrivi le cifre del codice.",
};

/** Controlla ciò che si può sapere prima di chiedere il permesso. */
export function cameraAvailability(): CameraProblem | null {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") return "unsupported";
  return null;
}

export function classifyCameraError(error: unknown): CameraProblem {
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return "denied";
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return "absent";
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return "busy";
    default:
      return "failed";
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop());
}

/** Fotocamera posteriore se c'è; altrimenti quella che il dispositivo offre. */
export function openRearCamera(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
  });
}
