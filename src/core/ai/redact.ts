// La chiave non deve finire in messaggi d'errore, registri o copie: ogni testo che arriva dal fornitore passa di qui.

const MASK = "[chiave nascosta]";
const MAX_DETAIL = 300;

/** Chiavi che i fornitori scrivono (anche mascherate) nei messaggi di errore: sk-..., sk-ant-..., sk-proj-****abcd. */
const KEY_SHAPES: readonly RegExp[] = [/\bsk-[A-Za-z0-9_\-*•.]{4,}/g, /\bBearer\s+[^\s"']+/gi];

/** Toglie dal testo le chiavi note e ogni forma che somigli a una chiave, poi lo accorcia. */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    const s = secret.trim();
    if (s.length >= 6) out = out.split(s).join(MASK);
  }
  for (const shape of KEY_SHAPES) out = out.replace(shape, MASK);
  out = out.replace(/\s+/g, " ").trim();
  return out.length > MAX_DETAIL ? `${out.slice(0, MAX_DETAIL)}…` : out;
}
