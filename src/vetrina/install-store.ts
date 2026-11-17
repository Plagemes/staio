/**
 * Stato dell'installazione dell'app web. `beforeinstallprompt` può scattare prima che la pagina sia idratata,
 * perciò l'ascolto parte quando il modulo viene caricato e i componenti si limitano a leggere lo stato.
 */

export interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface InstallState {
  /** Evento del browser, presente solo dove l'installazione con un tocco è disponibile. */
  prompt: BeforeInstallPromptEvent | null;
  /** L'installazione è avvenuta durante questa visita. */
  installed: boolean;
}

export const SERVER_INSTALL_STATE: InstallState = { prompt: null, installed: false };

let state: InstallState = SERVER_INSTALL_STATE;
const listeners = new Set<() => void>();

function update(next: InstallState) {
  state = next;
  listeners.forEach((listener) => listener());
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    update({ ...state, prompt: event as BeforeInstallPromptEvent });
  });
  window.addEventListener("appinstalled", () => update({ prompt: null, installed: true }));
}

export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInstallState(): InstallState {
  return state;
}

export type InstallOutcome = "accepted" | "dismissed" | "unavailable";

/** Mostra la finestra di installazione del browser. L'evento si usa una volta sola. */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = state.prompt;
  if (!event) return "unavailable";
  update({ ...state, prompt: null });
  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome;
  } catch {
    return "unavailable";
  }
}

/** true se la pagina è aperta come app installata (Android e computer, oppure Safari su iPhone e iPad). */
export function subscribeStandalone(listener: () => void): () => void {
  const query = window.matchMedia("(display-mode: standalone)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function getStandalone(): boolean {
  const legacy = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return legacy || window.matchMedia("(display-mode: standalone)").matches;
}

export type Platform = "ios" | "android" | "desktop" | "unknown";

export function getPlatform(): Platform {
  const ua = navigator.userAgent;
  // iPadOS si presenta come un Mac: lo distingue lo schermo a tocco
  const iPadOnMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  if (/iPhone|iPad|iPod/.test(ua) || iPadOnMac) return "ios";
  if (/Android/.test(ua)) return "android";
  return "desktop";
}

export function subscribeNothing(): () => void {
  return () => {};
}
