// CORS limitato a una sola origine, quella dell'app. Senza origine configurata nessun browser può leggere le risposte.

/** Origine valida: schema e dominio (e porta), senza percorso. http solo per localhost. */
export function parseOrigin(value) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    return undefined;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return undefined;
  if (url.username !== "" || url.password !== "" || (url.pathname !== "/" && url.pathname !== "") || url.search !== "" || url.hash !== "") return undefined;
  return url.origin;
}

/**
 * Le richieste con `Origin` diverso da quello ammesso non si servono. Senza `Origin` (strumenti da riga di comando)
 * si passa: il token resta l'unica difesa.
 */
export function originAllowed(origin, allowed) {
  if (origin === undefined) return true;
  return allowed !== undefined && origin === allowed;
}

/** Intestazioni CORS per la risposta. @param {boolean} preflight */
export function corsHeaders(origin, allowed, preflight = false) {
  const headers = { vary: "Origin" };
  if (allowed !== undefined && origin === allowed) {
    headers["access-control-allow-origin"] = allowed;
    if (preflight) {
      headers["access-control-allow-methods"] = "POST, GET, OPTIONS";
      headers["access-control-allow-headers"] = "authorization, content-type";
      headers["access-control-max-age"] = "600";
    }
  }
  return headers;
}
