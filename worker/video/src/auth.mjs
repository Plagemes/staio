import { createHash, timingSafeEqual } from "node:crypto";

/** Il token dall'intestazione `Authorization: Bearer <token>`, o undefined. */
export function bearerToken(header) {
  if (typeof header !== "string") return undefined;
  const match = /^Bearer[ \t]+([\x21-\x7e]+)$/i.exec(header.trim());
  return match ? match[1] : undefined;
}

/**
 * Confronto a tempo costante: si confrontano gli hash (stessa lunghezza), così il tempo non dipende né dalla
 * lunghezza né da quanti caratteri iniziali coincidono.
 */
export function tokensEqual(given, expected) {
  if (typeof given !== "string" || typeof expected !== "string") return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Vero se l'intestazione porta il token atteso. */
export function isAuthorized(header, expected) {
  const given = bearerToken(header);
  // si confronta comunque, anche senza token: il tempo di risposta non dice se l'intestazione c'era
  const ok = tokensEqual(given ?? "", expected);
  return given !== undefined && ok;
}
