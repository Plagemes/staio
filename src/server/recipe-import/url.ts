// Controllo dell'indirizzo richiesto, prima di qualunque risoluzione o connessione.
// Codice solo server.

import { looksLikeIpLiteral } from "./ip";

export type UrlRejection =
  | "invalid_url"
  | "not_https"
  | "credentials"
  | "bad_port"
  | "blocked_host";

export type UrlCheck = { ok: true; url: URL; hostname: string } | { ok: false; code: UrlRejection };

export const MAX_URL_LENGTH = 2048;

/** Domini di primo livello e nomi riservati o interni: non sono raggiungibili da Internet. */
const BLOCKED_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "intranet",
  "lan",
  "home",
  "corp",
  "private",
  "home.arpa",
  "invalid",
  "test",
  "example",
  "onion",
  "arpa",
];

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/**
 * Accetta solo `https` sulla porta 443, senza credenziali nell'indirizzo, con un nome di dominio
 * pubblico: niente indirizzi numerici (in nessuna forma), niente nomi interni o a una sola etichetta.
 */
export function checkUrl(raw: unknown): UrlCheck {
  if (typeof raw !== "string") return { ok: false, code: "invalid_url" };
  const text = raw.trim();
  if (text === "" || text.length > MAX_URL_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) {
    return { ok: false, code: "invalid_url" };
  }
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, code: url.protocol === "http:" || /^[a-z][a-z0-9+.-]*:/i.test(text) ? "not_https" : "invalid_url" };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, code: "credentials" };
  if (url.port !== "" && url.port !== "443") return { ok: false, code: "bad_port" };

  let host = url.hostname.toLowerCase();
  if (host.endsWith(".")) host = host.slice(0, -1);
  if (host === "" || host.length > 253) return { ok: false, code: "invalid_url" };
  if (looksLikeIpLiteral(host)) return { ok: false, code: "blocked_host" };
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return { ok: false, code: "blocked_host" };
  const tld = labels[labels.length - 1] as string;
  if (/^\d+$/.test(tld)) return { ok: false, code: "blocked_host" };
  if (BLOCKED_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    return { ok: false, code: "blocked_host" };
  }
  url.hash = "";
  return { ok: true, url, hostname: host };
}
