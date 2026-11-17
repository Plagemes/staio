// Validazione dell'indirizzo del video. Solo https, solo i domini dell'elenco (e i loro sottodomini), verificati
// sull'host che il parser ricava davvero: mai con confronti sulla stringa intera.

export const ALLOWED_DOMAINS = Object.freeze(["instagram.com", "tiktok.com", "youtube.com", "youtu.be"]);
export const MAX_URL_CHARS = 2048;

/** Spazi, caratteri di controllo e barra rovesciata (che alcuni parser trattano come «/»). */
const FORBIDDEN_CHARS = /[\u0000- \u007f\\]/;

/** Host normalizzato: minuscolo, senza il punto finale. */
export function normalizeHost(hostname) {
  return String(hostname).toLowerCase().replace(/\.$/, "");
}

/** Vero se l'host è uno dei domini o un loro sottodominio («vm.tiktok.com»), mai un dominio solo simile. */
export function hostAllowed(hostname, domains = ALLOWED_DOMAINS) {
  const host = normalizeHost(hostname);
  if (host === "" || !host.includes(".")) return false;
  // indirizzi numerici e IPv6 non sono mai ammessi
  if (host.includes(":") || host.startsWith("[") || /^[0-9.]+$/.test(host)) return false;
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

/**
 * @param {unknown} input
 * @returns {{ ok: true, url: string, host: string } | { ok: false, code: "invalid_url" | "domain_not_allowed" }}
 */
export function validateVideoUrl(input, domains = ALLOWED_DOMAINS) {
  if (typeof input !== "string") return { ok: false, code: "invalid_url" };
  const text = input.trim();
  if (text === "" || text.length > MAX_URL_CHARS || FORBIDDEN_CHARS.test(text)) return { ok: false, code: "invalid_url" };
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (parsed.protocol !== "https:") return { ok: false, code: "invalid_url" };
  if (parsed.username !== "" || parsed.password !== "") return { ok: false, code: "invalid_url" };
  // https ha la porta 443: il parser la toglie, qualunque altra porta è rifiutata
  if (parsed.port !== "") return { ok: false, code: "invalid_url" };
  if (!hostAllowed(parsed.hostname, domains)) return { ok: false, code: "domain_not_allowed" };
  parsed.hash = "";
  return { ok: true, url: parsed.href, host: normalizeHost(parsed.hostname) };
}
