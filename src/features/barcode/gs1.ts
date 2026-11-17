// Lettura di un codice GS1 (DataMatrix, GS1-128): (01) GTIN, (17) scadenza, (15) preferibilmente entro. Funzione pura.
import { checkDigitFor } from "@/core/catalog";

export interface Gs1Reading {
  /** GTIN a 14 cifre, con la cifra di controllo verificata. */
  gtin?: string;
  /** `YYYY-MM-DD`. (17) vale «da consumare entro», (15) «preferibilmente entro»; se ci sono entrambe vince (17). */
  expiry?: { date: string; kind: "use_by" | "best_before" };
}

const FNC1 = "\u001d";

/** Lunghezza fissa degli identificatori che servono a saltare quelli che non interessano. */
const FIXED: Readonly<Record<string, number>> = {
  "00": 18,
  "01": 14,
  "02": 14,
  "11": 6,
  "12": 6,
  "13": 6,
  "15": 6,
  "16": 6,
  "17": 6,
  "20": 2,
};
/** Identificatori di lunghezza variabile: finiscono al separatore FNC1 (GS) o alla fine. */
const VARIABLE = new Set(["10", "21", "22", "30", "37", "90", "91", "92", "93", "94", "95", "96", "97", "98", "99"]);

const daysIn = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/** AAMMGG in `YYYY-MM-DD`; giorno 00 vuol dire fine mese; null se non è una data. */
export function parseGs1Date(value: string): string | null {
  if (!/^\d{6}$/.test(value)) return null;
  const year = 2000 + Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  let day = Number(value.slice(4, 6));
  if (month < 1 || month > 12) return null;
  const last = daysIn(year, month);
  if (day === 0) day = last;
  if (day > last) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function fromParentheses(raw: string): Array<[string, string]> | null {
  const pairs: Array<[string, string]> = [];
  const re = /\((\d{2,4})\)([^(]*)/gy;
  let consumed = 0;
  for (let m = re.exec(raw); m; m = re.exec(raw)) {
    pairs.push([m[1], m[2].replace(new RegExp(FNC1, "g"), "")]);
    consumed = re.lastIndex;
  }
  return pairs.length > 0 && consumed === raw.length ? pairs : null;
}

function fromElementString(raw: string): Array<[string, string]> | null {
  const pairs: Array<[string, string]> = [];
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === FNC1) {
      i += 1;
      continue;
    }
    const ai = raw.slice(i, i + 2);
    const fixed = FIXED[ai];
    if (fixed !== undefined) {
      const value = raw.slice(i + 2, i + 2 + fixed);
      if (value.length < fixed) return null;
      pairs.push([ai, value]);
      i += 2 + fixed;
    } else if (VARIABLE.has(ai)) {
      const end = raw.indexOf(FNC1, i + 2);
      const stop = end === -1 ? raw.length : end;
      pairs.push([ai, raw.slice(i + 2, stop)]);
      i = stop;
    } else return null;
  }
  return pairs.length > 0 ? pairs : null;
}

/**
 * Legge un codice GS1, con le parentesi «(01)…(17)…» o senza, con o senza separatori FNC1 e identificatore di simbologia
 * («]d2», «]C1»). Restituisce null se non è un codice GS1 o non contiene né GTIN né una data valida: un normale
 * EAN-13 non lo è.
 */
export function parseGs1(input: string): Gs1Reading | null {
  let raw = input.trim().replace(/^\][A-Za-z]\d/, "");
  if (raw === "") return null;
  // senza parentesi un GS1 comincia per forza con un identificatore noto: un EAN di sole cifre non va scambiato
  if (!raw.startsWith("(") && !/^(01|02|00|10|11|13|15|17)/.test(raw)) return null;
  if (!raw.startsWith("(") && /^\d+$/.test(raw) && ![16, 18].includes(raw.length) && raw.length < 16) return null;
  raw = raw.replace(/\s+/g, "");

  const pairs = raw.startsWith("(") ? fromParentheses(raw) : fromElementString(raw);
  if (!pairs) return null;

  const reading: Gs1Reading = {};
  let use: string | null = null;
  let best: string | null = null;
  for (const [ai, value] of pairs) {
    if (ai === "01" && /^\d{14}$/.test(value) && checkDigitFor(value.slice(0, 13)) === Number(value[13])) reading.gtin = value;
    else if (ai === "17") use = parseGs1Date(value);
    else if (ai === "15") best = parseGs1Date(value);
  }
  if (use) reading.expiry = { date: use, kind: "use_by" };
  else if (best) reading.expiry = { date: best, kind: "best_before" };
  return reading.gtin || reading.expiry ? reading : null;
}

/** Il codice a barre di vendita (EAN-13) di un GTIN-14: tolta la cifra indicatore zero; altrimenti null. */
export function gtinToRetailCode(gtin: string): string | null {
  return /^0\d{13}$/.test(gtin) ? gtin.slice(1) : null;
}
