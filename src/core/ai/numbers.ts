// Numeri come li scrivono le risposte dei modelli e gli scontrini: "1,29", "1.234,56", "0,30-", "€ 3,50".

/** Legge un numero decimale in forma italiana o inglese. Restituisce undefined se non è un numero. */
export function parseDecimal(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  let s = value
    .replace(/€|\beur(o)?\b/gi, "")
    .replace(/[\s  ]/g, "")
    .replace(/[−–]/g, "-");
  if (s === "") return undefined;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  } else if (s.endsWith("-")) {
    // gli scontrini scrivono spesso "0,30-"
    negative = true;
    s = s.slice(0, -1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return undefined;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  let normalized: string;
  if (lastComma >= 0 && lastDot >= 0) {
    // il separatore che sta per ultimo è quello dei decimali
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? "." : ",";
    normalized = s.split(thousands).join("").replace(decimal, ".");
  } else if (lastComma >= 0) {
    // più virgole: sono migliaia ("1,234,567"); una sola: decimali
    normalized = s.indexOf(",") === lastComma ? s.replace(",", ".") : s.split(",").join("");
  } else if (lastDot >= 0) {
    normalized = s.indexOf(".") === lastDot ? s : s.split(".").join("");
  } else {
    normalized = s;
  }
  const n = Number(normalized);
  if (!Number.isFinite(n)) return undefined;
  return negative ? -n : n;
}

/** Euro (anche con decimali) in centesimi interi. */
export function eurosToCents(euros: number): number | undefined {
  if (!Number.isFinite(euros)) return undefined;
  const cents = Math.round(Number((euros * 100).toFixed(6)));
  return Number.isSafeInteger(cents) ? cents : undefined;
}

/**
 * Importo in centesimi da un campo che dovrebbe già essere in centesimi interi.
 * Un intero è preso com'è; un valore con decimali o scritto con la virgola
 * ("1,29", 1.29) è chiaramente in euro e viene convertito.
 */
export function readCentsField(value: unknown): number | undefined {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return undefined;
    return Number.isInteger(value) ? value : eurosToCents(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^[+\-−]?\d+$/.test(trimmed)) return Number(trimmed.replace("−", "-"));
    const euros = parseDecimal(trimmed);
    return euros === undefined ? undefined : eurosToCents(euros);
  }
  return undefined;
}

/** Importo in centesimi da un campo che è in euro (anche 129 vuol dire 129 euro). */
export function readEuroField(value: unknown): number | undefined {
  const euros = parseDecimal(value);
  return euros === undefined ? undefined : eurosToCents(euros);
}
