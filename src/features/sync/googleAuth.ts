// Accesso a Google Drive con Google Identity Services (flusso a token, senza server nostro).
// Lo script di Google si carica solo quando l'utente tocca un pulsante; il token resta in una
// variabile di questo modulo, mai su disco, e chiudendo l'app si perde.
import { TransportError } from "@/core/sync";
import { DRIVE_SCOPE, type TokenProvider } from "@/data/sync";

const GIS_SRC = "https://accounts.google.com/gsi/client";

interface TokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
}

interface GoogleOauth2 {
  initTokenClient(config: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
    error_callback?: (error: { type?: string }) => void;
  }): TokenClient;
  hasGrantedAllScopes(response: TokenResponse, ...scopes: string[]): boolean;
  revoke(token: string, done?: () => void): void;
}

type GoogleWindow = { google?: { accounts?: { oauth2?: GoogleOauth2 } } };

/** Identificativo del client OAuth, fissato al momento della build. Assente: Drive non è configurato. */
export function driveClientId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  return id && id.trim() ? id.trim() : undefined;
}

let loading: Promise<GoogleOauth2> | null = null;
let token: { value: string; expiresAt: number } | null = null;
const listeners = new Set<() => void>();

function setToken(next: typeof token): void {
  const changed = (next === null) !== (token === null);
  token = next;
  if (changed) for (const l of listeners) l();
}

/** Per `useSyncExternalStore`: avvisa quando ci si collega o scollega. */
export function subscribeDriveConnection(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Collegato in questa sessione (il token può essere scaduto: si rinnova al primo uso). */
export function driveConnected(): boolean {
  return token !== null;
}

function oauth2(): GoogleOauth2 | undefined {
  return (window as unknown as GoogleWindow).google?.accounts?.oauth2;
}

/** Carica lo script di Google una sola volta. Da chiamare in risposta a un gesto dell'utente. */
export function loadGoogleIdentity(): Promise<GoogleOauth2> {
  const ready = typeof window !== "undefined" ? oauth2() : undefined;
  if (ready) return Promise.resolve(ready);
  if (loading) return loading;
  loading = new Promise<GoogleOauth2>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => {
      const api = oauth2();
      if (api) resolve(api);
      else reject(new TransportError("forbidden", "gis_missing"));
    };
    script.onerror = () => {
      loading = null;
      script.remove();
      reject(new TransportError("offline", "gis_load_failed"));
    };
    document.head.append(script);
  });
  return loading;
}

/** Chiede un token per il solo ambito drive.appdata. Apre la finestra di Google se serve. */
export async function requestDriveToken(prompt: "" | "consent" = ""): Promise<string> {
  const clientId = driveClientId();
  if (!clientId) throw new TransportError("forbidden", "not_configured");
  const api = await loadGoogleIdentity();
  return new Promise<string>((resolve, reject) => {
    const client = api.initTokenClient({
      client_id: clientId,
      scope: DRIVE_SCOPE,
      callback: (response) => {
        if (response.error || !response.access_token) return reject(new TransportError("unauthorized", response.error ?? "denied"));
        if (!api.hasGrantedAllScopes(response, DRIVE_SCOPE)) return reject(new TransportError("forbidden", "scope_not_granted"));
        const seconds = Number(response.expires_in ?? 3600);
        setToken({ value: response.access_token, expiresAt: Date.now() + Math.max(60, seconds - 60) * 1000 });
        resolve(response.access_token);
      },
      error_callback: (error) => reject(new TransportError("unauthorized", error.type ?? "popup_closed")),
    });
    client.requestAccessToken({ prompt });
  });
}

export function hasDriveToken(): boolean {
  return token !== null && token.expiresAt > Date.now();
}

/** Per il trasporto: il token in memoria, oppure uno nuovo se scaduto o rifiutato. */
export const driveTokenProvider: TokenProvider = async ({ refresh }) => {
  if (!refresh && token && token.expiresAt > Date.now()) return token.value;
  setToken(null);
  return requestDriveToken("");
};

/** Scollega: revoca il permesso e dimentica il token. */
export function forgetDriveToken(): void {
  const current = token?.value;
  setToken(null);
  if (current) oauth2()?.revoke(current);
}
