// Indirizzo di base di un servizio compatibile con l'API di OpenAI. La chiave viene mandata lì: niente HTTP in chiaro
// se non verso il proprio computer.

export type BaseUrlResult = { ok: true; url: string } | { ok: false; error: "empty" | "invalid" | "insecure" | "credentials" };

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname.endsWith(".localhost");
}

/** Origine (schema, dominio e porta) a cui andrà la chiave, o undefined se l'indirizzo non è valido. */
export function originOf(text: string): string | undefined {
  const result = normalizeBaseUrl(text);
  return result.ok ? new URL(result.url).origin : undefined;
}

/** Normalizza l'indirizzo (senza barra finale, senza parametri) o spiega perché non va. */
export function normalizeBaseUrl(text: string): BaseUrlResult {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: false, error: "empty" };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, error: "invalid" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, error: "invalid" };
  if (parsed.username !== "" || parsed.password !== "") return { ok: false, error: "credentials" };
  if (parsed.protocol === "http:" && !isLocalHost(parsed.hostname)) return { ok: false, error: "insecure" };
  const path = parsed.pathname.replace(/\/+$/, "");
  return { ok: true, url: `${parsed.origin}${path}` };
}
