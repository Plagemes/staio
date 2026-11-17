// Registro: solo eventi e codici, mai un indirizzo, un contenuto, un token o un indirizzo di rete.
// Si scrivono soltanto i campi di questo elenco, qualunque cosa venga passata.

const FIELDS = ["event", "status", "code", "ms"];

/** La riga che si scrive: solo i campi ammessi, e solo se numeri o parole semplici. */
export function logLine(fields, at = new Date()) {
  const clean = { t: at.toISOString() };
  for (const key of FIELDS) {
    const value = fields[key];
    if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === "string" && /^[a-z_]{1,40}$/.test(value)) clean[key] = value;
  }
  return JSON.stringify(clean);
}

export function logEvent(fields) {
  process.stdout.write(`${logLine(fields)}\n`);
}
