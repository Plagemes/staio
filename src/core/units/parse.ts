import type { Quantity, Result, Unit } from "./types";

export type ParseErrorCode = "empty" | "no_quantity" | "invalid_number";

export interface ParseError {
  code: ParseErrorCode;
  message: string;
}

export interface ParsedQuantity {
  quantity: Quantity;
  /** Testo residuo dopo quantità e unità ("6 uova" -> "uova"; "di" iniziale rimosso). */
  rest: string;
}

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  mezzo: 0.5,
  mezza: 0.5,
  un: 1,
  uno: 1,
  una: 1,
  due: 2,
  tre: 3,
  quattro: 4,
  cinque: 5,
  sei: 6,
  sette: 7,
  otto: 8,
  nove: 9,
  dieci: 10,
};

const ALIASES: Readonly<Record<string, Unit>> = {
  g: "g",
  gr: "g",
  grammo: "g",
  grammi: "g",
  kg: "kg",
  chilo: "kg",
  chili: "kg",
  kilo: "kg",
  kili: "kg",
  chilogrammo: "kg",
  chilogrammi: "kg",
  hg: "hg",
  etto: "hg",
  etti: "hg",
  ettogrammo: "hg",
  ettogrammi: "hg",
  mg: "mg",
  milligrammo: "mg",
  milligrammi: "mg",
  ml: "ml",
  millilitro: "ml",
  millilitri: "ml",
  cl: "cl",
  centilitro: "cl",
  centilitri: "cl",
  dl: "dl",
  decilitro: "dl",
  decilitri: "dl",
  l: "l",
  lt: "l",
  litro: "l",
  litri: "l",
  pz: "pz",
  pezzo: "pz",
  pezzi: "pz",
  cucchiaio: "cucchiaio",
  cucchiai: "cucchiaio",
  cucchiaino: "cucchiaino",
  cucchiaini: "cucchiaino",
  tazza: "tazza",
  tazze: "tazza",
  bicchiere: "bicchiere",
  bicchieri: "bicchiere",
  pizzico: "pizzico",
  pizzichi: "pizzico",
  confezione: "confezione",
  confezioni: "confezione",
  conf: "confezione",
};

const LETTERS = "a-zàèéìòùç";

function fail(code: ParseErrorCode, message: string): Result<ParsedQuantity, ParseError> {
  return { ok: false, error: { code, message } };
}

/**
 * Interpreta una quantità italiana in testa alla stringa. Il punto è trattato come
 * separatore decimale. Un numero senza unità riconosciuta vale come pezzi.
 */
export function parseQuantity(input: string): Result<ParsedQuantity, ParseError> {
  const s = input.trim().toLowerCase().replace(/\s+/g, " ");
  if (s === "") return fail("empty", "Testo vuoto.");

  let value: number;
  let after: string;
  const m = /^(\d+(?:[.,]\d+)?)(?:\s*\/\s*(\d+))?/.exec(s);
  if (m) {
    value = parseFloat((m[1] as string).replace(",", "."));
    if (m[2] !== undefined) {
      const den = Number(m[2]);
      if (den === 0) return fail("invalid_number", "Denominatore zero.");
      value /= den;
    }
    after = s.slice(m[0].length);
  } else {
    const w = new RegExp(`^([${LETTERS}]+)(?![${LETTERS}'])`).exec(s);
    const word = w?.[1];
    if (!w || word === undefined || !(word in WORD_NUMBERS)) {
      return fail("no_quantity", "Nessuna quantità riconoscibile.");
    }
    value = WORD_NUMBERS[word] as number;
    after = s.slice(w[0].length);
  }
  if (!Number.isFinite(value)) return fail("invalid_number", "Numero non valido.");

  after = after.trim();
  const t = new RegExp(`^([${LETTERS}]+)\\.?(?![${LETTERS}'])`).exec(after);
  const unit = t?.[1] !== undefined ? ALIASES[t[1]] : undefined;
  if (t && unit) {
    const rest = after
      .slice(t[0].length)
      .trim()
      .replace(/^(?:di\s+|d')\s*/, "");
    return { ok: true, value: { quantity: { value, unit }, rest } };
  }
  return { ok: true, value: { quantity: { value, unit: "pz" }, rest: after } };
}
