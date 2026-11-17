// Interprete della risposta del modello per la data di scadenza in foto. Non lancia mai.
// Il modello trascrive il testo stampato; è questo codice a decidere che data è. Regole fisse:
// - un formato ambiguo (03/04/26) non si scioglie da soli: si danno tutte le letture possibili e si chiede quale;
// - più date nella foto: si chiede quale;
// - un lotto, un codice o una data di produzione non sono una scadenza: si scartano, e si dice che cosa si è scartato;
// - solo mese e anno: ultimo giorno del mese, e lo si dice;
// - una data passata si segnala, non si scarta;
// - una risposta illeggibile non dà nessuna data.
import { extractPayload, problem, type ReadProblem } from "./labelShared";
import { readConfidence, DEFAULT_CONFIDENCE } from "./pantryScan";
import { isObj, pick, readText } from "./receiptParse";
import { cleanText, readTextList } from "./mealPhraseShared";

export type ExpiryKind = "use_by" | "best_before" | "unclear";
export type DiscardReason = "lot" | "other_date" | "no_year" | "unreadable";

/** Sotto questa certezza la lettura dei caratteri si segnala come incerta. */
export const EXPIRY_MIN_CONFIDENCE = 0.5;
/** Oltre questi anni da oggi una scadenza è insolita: si segnala. */
export const FAR_FUTURE_YEARS = 10;
const MAX_ENTRIES = 6;
/** Un anno a due cifre si completa con 20xx; tra le letture possibili restano quelle in questa finestra attorno a oggi. */
const WINDOW_BEFORE = 5;
const WINDOW_AFTER = 15;

export interface ExpiryOption {
  id: string;
  /** `YYYY-MM-DD`. */
  date: string;
  kind: ExpiryKind;
  /** Com'è stampata sulla confezione. */
  printed: string;
  /** In parole, per far scegliere: «3 aprile 2026», «aprile 2026». */
  readAs: string;
  /** Sull'etichetta c'erano solo mese e anno: il giorno è l'ultimo del mese. */
  monthOnly: boolean;
  /** L'anno non è stampato: è il prossimo in cui cade quel giorno. Una lettura possibile, da far scegliere. */
  inferredYear: boolean;
  /** Una data letta dall'etichetta stampata. */
  certainty: "label";
  confidence: number;
  /** Avvisi che riguardano questa data (passata, solo mese, lettura incerta). */
  problems: ReadProblem[];
}

export interface Discarded {
  printed: string;
  reason: DiscardReason;
  message: string;
}

export interface ExpiryReading {
  options: ExpiryOption[];
  /** Cosa chiedere all'utente se le opzioni sono più di una: più date, più modi di leggerla, o entrambe. */
  question?: "dates" | "format" | "both";
  discarded: Discarded[];
  problems: ReadProblem[];
}

// ---------------------------------------------------------------- calendario

const MONTHS_IT = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];
const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const dayNumber = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export function describeDate(iso: string, monthOnly = false): string {
  const [y, m, d] = iso.split("-").map(Number);
  return monthOnly ? `${MONTHS_IT[m - 1]} ${y}` : `${d} ${MONTHS_IT[m - 1]} ${y}`;
}

// ---------------------------------------------------------------- interpretazione del testo stampato

interface Interp {
  date: string;
  monthOnly: boolean;
  inferredYear?: true;
}
type Interpreted = { ok: true; options: Interp[] } | { ok: false; reason: DiscardReason };

const PREFIX =
  /^(?:(?:DA CONSUMARSI|DA CONSUMARE|CONSUMARSI|PREFERIBILMENTE|ENTRO IL|ENTRO|SCADENZA|SCAD|EXPIRY|EXP|USE BY|BEST BEFORE|BBE|BB|TMC|DDM|MHD|LE|IL)\b[\s.:;,-]*)+/;
const LOT = /^(?:LOTTO|LOTTE|LOT|BATCH|L)[\s.:-]*\d/;

const MONTH_WORDS: Record<string, number> = {
  GEN: 1, JAN: 1, FEB: 2, FEV: 2, MAR: 3, APR: 4, AVR: 4, MAG: 5, MAY: 5, MAI: 5, GIU: 6, JUN: 6,
  LUG: 7, JUL: 7, AGO: 8, AUG: 8, AOU: 8, SET: 9, SEP: 9, OTT: 10, OCT: 10, NOV: 11, DIC: 12, DEC: 12,
};

function monthFromWord(word: string): number | undefined {
  if (word.startsWith("JUIN")) return 6;
  if (word.startsWith("JUIL")) return 7;
  return MONTH_WORDS[word.slice(0, 3)];
}

const fullYear = (digits: string) => (digits.length === 2 ? 2000 + Number(digits) : Number(digits));

function candidate(y: number, m: number, d: number): Interp | null {
  if (!(y >= 1990 && y <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= daysIn(y, m))) return null;
  return { date: isoOf(y, m, d), monthOnly: false };
}

function unique(list: readonly (Interp | null)[]): Interp[] {
  const out: Interp[] = [];
  for (const c of list) if (c && !out.some((o) => o.date === c.date && o.monthOnly === c.monthOnly)) out.push(c);
  return out;
}

/** Tutte le letture possibili di un testo di data, per l'anno di `today`. */
export function interpretDateText(raw: string, today: string): Interpreted {
  const s0 = raw
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (s0 === "") return { ok: false, reason: "unreadable" };
  if (LOT.test(s0)) return { ok: false, reason: "lot" };
  const s = s0.replace(PREFIX, "").trim().replace(/[.,;:]+$/, "");
  if (s === "") return { ok: false, reason: "unreadable" };

  const todayYear = Number(today.slice(0, 4));
  const inWindow = (y: number) => y >= todayYear - WINDOW_BEFORE && y <= todayYear + WINDOW_AFTER;
  const done = (options: Interp[]): Interpreted => (options.length > 0 ? { ok: true, options } : { ok: false, reason: "unreadable" });

  // sei cifre di fila: potrebbe essere un lotto, non si indovina
  if (/^\d{6}$/.test(s)) return { ok: false, reason: "lot" };

  if (/^\d{8}$/.test(s)) {
    const dmy = candidate(Number(s.slice(4)), Number(s.slice(2, 4)), Number(s.slice(0, 2)));
    // «03122026» è il 3 dicembre o il 12 marzo: senza separatori non si sa, e si chiede
    const mdy = candidate(Number(s.slice(4)), Number(s.slice(0, 2)), Number(s.slice(2, 4)));
    const ymd = candidate(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6)));
    return done(unique([dmy, mdy, ymd && inWindow(Number(ymd.date.slice(0, 4))) ? ymd : null]));
  }

  const three = /^(\d{1,4})[\s./-]+(\d{1,2})[\s./-]+(\d{1,4})$/.exec(s);
  if (three) {
    const [, a, b, c] = three;
    const [na, nb, nc] = [Number(a), Number(b), Number(c)];
    if (a.length === 4 && c.length <= 2) return done(unique([candidate(na, nb, nc)]));
    if (a.length <= 2 && c.length === 4) return done(unique([candidate(nc, nb, na), candidate(nc, na, nb)]));
    if (a.length <= 2 && c.length <= 2) {
      const y = fullYear(c);
      const dmy = candidate(y, nb, na);
      const mdy = candidate(y, na, nb);
      const ymd = candidate(fullYear(a), nb, nc);
      const inside = unique([dmy, mdy, ymd]).filter((o) => inWindow(Number(o.date.slice(0, 4))));
      // se nessuna lettura sta nella finestra la data è lontana dall'oggi: si tengono giorno-mese-anno e mese-giorno-anno
      return done(inside.length > 0 ? inside : unique([dmy, mdy]));
    }
    return { ok: false, reason: "unreadable" };
  }

  const text = /^(?:(\d{1,2})[\s./-]*)?([A-Z]{3,10})\.?[\s./-]*(\d{4}|\d{2})$/.exec(s);
  if (text) {
    const month = monthFromWord(text[2]);
    if (month === undefined) return { ok: false, reason: /\d/.test(s) ? "lot" : "unreadable" };
    const year = fullYear(text[3]);
    if (text[1] === undefined && text[3].length === 2) {
      // «MAG 30»: maggio 2030, o il 30 maggio senza anno? Si danno le due letture e si chiede
      const n = Number(text[3]);
      const options: Interp[] = [];
      if (inWindow(year)) options.push({ date: isoOf(year, month, daysIn(year, month)), monthOnly: true });
      if (n >= 1 && n <= daysIn(2028, month)) {
        const next = [todayYear, todayYear + 1].map((y) => candidate(y, month, n)).find((c) => c !== null && c.date >= today);
        if (next) options.push({ date: next.date, monthOnly: false, inferredYear: true });
      }
      if (options.length > 0) return { ok: true, options };
    }
    if (text[1] === undefined) {
      return year >= 1990 && year <= 2100 ? { ok: true, options: [{ date: isoOf(year, month, daysIn(year, month)), monthOnly: true }] } : { ok: false, reason: "unreadable" };
    }
    return done(unique([candidate(year, month, Number(text[1]))]));
  }

  const two = /^(\d{1,2})[\s./-]+(\d{2}|\d{4})$/.exec(s);
  if (two) {
    const month = Number(two[1]);
    const year = fullYear(two[2]);
    // «04/11» può essere aprile 2011 o 4 novembre senza anno: se l'anno esce dalla finestra non si indovina
    if (month < 1 || month > 12 || (two[2].length === 2 && !inWindow(year)) || year < 1990 || year > 2100) return { ok: false, reason: "no_year" };
    return { ok: true, options: [{ date: isoOf(year, month, daysIn(year, month)), monthOnly: true }] };
  }

  // lettere e cifre che non formano una data: un codice
  return { ok: false, reason: /\d/.test(s) && /[A-Z]/.test(s) ? "lot" : "unreadable" };
}

// ---------------------------------------------------------------- tipo di data

export function readExpiryKind(value: unknown): ExpiryKind | "other" | undefined {
  const s = readText(value, 80)?.toLowerCase();
  if (s === undefined) return undefined;
  if (/\b(other|altro|altra|lot|lotto|prod|produzione|pack|packed|conf|confezionamento|imballaggio)/.test(s)) return "other";
  if (/(best|prefer|\btmc\b|\bddm\b|\bmhd\b|\bbbe\b|min\.? ?dur)/.test(s)) return "best_before";
  if (/(use[ _-]?by|consum|scad|\bexp)/.test(s)) return "use_by";
  if (/unclear|non chiaro|unknown/.test(s)) return "unclear";
  return undefined;
}

const DISCARD_MESSAGES: Record<DiscardReason, (printed: string) => string> = {
  lot: (p) => `Ho scartato «${p}»: sembra un lotto o un codice, non una data.`,
  other_date: (p) => `Ho scartato «${p}»: non è una scadenza (data di produzione o di confezionamento).`,
  no_year: (p) => `Ho scartato «${p}»: senza anno non so di che data si tratta.`,
  unreadable: (p) => `Ho scartato «${p}»: non riesco a leggerla come una data.`,
};

// ---------------------------------------------------------------- lettura

export function parseExpiryDates(text: string, options: { today: string; truncated?: boolean }): ExpiryReading {
  const reading: ExpiryReading = { options: [], discarded: [], problems: [] };
  const { today } = options;
  try {
    const found = extractPayload(text, ["dates", "date", "scadenze", "codes"]);
    if (!found) {
      reading.problems.push(problem("no_json", "warning", "Nella risposta non ho trovato una data leggibile."));
      if (options.truncated) reading.problems.push(problem("truncated", "warning", "La risposta si è interrotta prima della fine."));
      return reading;
    }
    if (found.salvaged) reading.problems.push(problem("salvaged", "info", "La risposta era incompleta: ho tenuto solo ciò che si leggeva."));
    else if (options.truncated) reading.problems.push(problem("truncated", "warning", "La risposta si è interrotta per il limite di lunghezza: una data può mancare."));

    const raw = pick(found.payload, "dates", "date", "scadenze");
    const entries = Array.isArray(raw) ? raw : isObj(raw) ? [raw] : [];
    let printedWithOptions = 0;
    let anyAmbiguous = false;

    for (const entry of entries.slice(0, MAX_ENTRIES)) {
      if (!isObj(entry)) continue;
      const printedRaw = readText(pick(entry, "text", "testo", "date", "data"), 40);
      if (printedRaw === undefined) continue;
      const printed = cleanText(printedRaw, 40);
      const discard = (reason: DiscardReason) => reading.discarded.push({ printed, reason, message: DISCARD_MESSAGES[reason](printed) });

      const declared = readExpiryKind(pick(entry, "type", "tipo", "kind"));
      if (declared === "other") {
        discard("other_date");
        continue;
      }
      const resolved = declared ?? readExpiryKind(pick(entry, "words", "parole", "label")) ?? "unclear";
      if (resolved === "other") {
        discard("other_date");
        continue;
      }
      const kind: ExpiryKind = resolved;
      const interpreted = interpretDateText(printed, today);
      if (!interpreted.ok) {
        discard(interpreted.reason);
        continue;
      }
      const confidence = readConfidence(pick(entry, "confidence", "certezza")) ?? DEFAULT_CONFIDENCE;
      printedWithOptions += 1;
      if (interpreted.options.length > 1) anyAmbiguous = true;
      for (const interp of interpreted.options) {
        const existing = reading.options.find((o) => o.date === interp.date);
        if (existing) {
          // la stessa data letta due volte (o stampata due volte) è una sola opzione
          if (existing.kind === "unclear" && kind !== "unclear") existing.kind = kind;
          continue;
        }
        reading.options.push({
          id: `d${reading.options.length + 1}`,
          date: interp.date,
          kind,
          printed,
          readAs: describeDate(interp.date, interp.monthOnly),
          monthOnly: interp.monthOnly,
          inferredYear: interp.inferredYear === true,
          certainty: "label",
          confidence,
          problems: [],
        });
      }
    }

    for (const code of readTextList(pick(found.payload, "codes", "lotti", "codici"), 4, 30)) {
      reading.discarded.push({ printed: code, reason: "lot", message: DISCARD_MESSAGES.lot(code) });
    }

    for (const o of reading.options) o.problems = optionProblems(o, today);
    if (reading.options.length === 0) {
      reading.problems.push(problem("no_date", "warning", "Non ho trovato nella foto una data di scadenza che si legga con sicurezza. Prova con una foto più vicina e dritta, o scrivila tu."));
    } else if (reading.options.length > 1) {
      reading.question = printedWithOptions > 1 ? (anyAmbiguous ? "both" : "dates") : "format";
    }
  } catch {
    reading.options = [];
    reading.problems.push(problem("no_json", "warning", "Non sono riuscito a interpretare la risposta."));
  }
  return reading;
}

function optionProblems(o: ExpiryOption, today: string): ReadProblem[] {
  const out: ReadProblem[] = [];
  if (o.confidence < EXPIRY_MIN_CONFIDENCE) {
    out.push(problem("low_confidence", "warning", "Lettura poco sicura: controlla le cifre sulla confezione."));
  }
  if (o.inferredYear) {
    out.push(problem("month_only", "warning", `Sulla confezione non c'è l'anno: se è il giorno, ho preso il prossimo in cui cade (${describeDate(o.date)}). Controlla.`));
  }
  if (o.monthOnly) {
    const base = `Sull'etichetta ci sono solo mese e anno: ho preso l'ultimo giorno del mese (${describeDate(o.date)}).`;
    out.push(
      o.kind === "best_before"
        ? problem("month_only", "info", base)
        : problem("month_only", "warning", `${base} Per un prodotto «da consumare entro» controlla il giorno sulla confezione.`),
    );
  }
  const diff = dayNumber(o.date) - dayNumber(today);
  if (diff < 0) {
    const ago = diff === -1 ? "ieri" : `${-diff} giorni fa`;
    out.push(problem("past", "warning", `La data (${describeDate(o.date, false)}) è già passata: è ${ago}. Controlla di aver letto bene l'anno.`));
  } else if (diff > FAR_FUTURE_YEARS * 366) {
    out.push(problem("far_future", "warning", `La data (${describeDate(o.date, false)}) è molto lontana: controlla l'anno.`));
  }
  return out;
}
