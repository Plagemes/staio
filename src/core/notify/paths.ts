// Percorsi interni: un avviso apre solo pagine dell'app, mai indirizzi di altri siti.

const FALLBACK = "/app";
const BASE = "https://app.invalid";

/**
 * Restituisce un percorso sicuro sotto /app (con eventuale query e ancora), oppure /app.
 * Rifiuta indirizzi assoluti, "//", barre rovesciate, caratteri di controllo e percorsi che
 * dopo la normalizzazione escono da /app.
 */
export function safeAppPath(input: unknown): string {
  if (typeof input !== "string" || input.length === 0 || input.length > 500) return FALLBACK;
  if (!input.startsWith("/") || input.startsWith("//")) return FALLBACK;
  if (input.includes("\\") || /[\u0000-\u001f\u007f]/.test(input)) return FALLBACK;
  let url: URL;
  try {
    url = new URL(input, BASE);
  } catch {
    return FALLBACK;
  }
  if (url.origin !== BASE) return FALLBACK;
  const p = url.pathname;
  if (p !== "/app" && !p.startsWith("/app/")) return FALLBACK;
  if (/%2e|%2f|%5c/i.test(p)) return FALLBACK;
  return p + url.search + url.hash;
}
