import { RECIPE_LIMITS } from "./types";

const num = (s: string | undefined): number => (s === undefined ? 0 : parseFloat(s.replace(",", ".")));

function valid(minutes: number): number | undefined {
  if (!Number.isFinite(minutes)) return undefined;
  const m = Math.round(minutes);
  return m > 0 && m <= RECIPE_LIMITS.minutesMax ? m : undefined;
}

const ISO_RE =
  /^P(?:(\d+(?:[.,]\d+)?)Y)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)W)?(?:(\d+(?:[.,]\d+)?)D)?(?:T(?:(\d+(?:[.,]\d+)?)H)?(?:(\d+(?:[.,]\d+)?)M)?(?:(\d+(?:[.,]\d+)?)S)?)?$/i;

/**
 * Durata in testo italiano o inglese ("1 ora e 30 minuti", "1h30", "20 min", "mezz'ora"), in minuti.
 * Restituisce `undefined` se non riconosce nulla di sicuro.
 */
export function parseDurationText(input: string): number | undefined {
  const s = input.toLowerCase().replace(/\s+/g, " ").trim();
  if (s === "" || s.length > 80) return undefined;
  if (/mezz'?\s?ora|mezza\s+ora/.test(s)) return 30;
  if (/\b(?:un'|un\s)ora\b/.test(s) && !/\d/.test(s)) return 60;
  let total = 0;
  let found = false;
  const hours = /(\d+(?:[.,]\d+)?)\s*(?:h|hrs?|hours?|ore|ora)(?![a-zà-ù])(?:\s*(?:e|and)?\s*(\d{1,2})(?!\d|\s*(?:h|ore|ora)))?/.exec(s);
  let rest = s;
  if (hours) {
    found = true;
    total += num(hours[1]) * 60;
    if (hours[2] !== undefined) total += num(hours[2]);
    rest = s.replace(hours[0], " ");
  }
  const mins = /(\d+(?:[.,]\d+)?)\s*(?:minuti|minuto|min|mins|minutes?|m|')(?![a-zà-ù])/.exec(rest);
  if (mins) {
    found = true;
    total += num(mins[1]);
  }
  return found ? valid(total) : undefined;
}

/**
 * Durata ISO 8601 (`PT1H30M`, `P0DT45M`, `PT90M`) in minuti. Anni e mesi non hanno una durata
 * fissa e non sono accettati. Se il formato non è ISO prova la lettura del testo libero.
 */
export function parseIsoDuration(input: unknown): number | undefined {
  if (typeof input === "number" && Number.isFinite(input)) return valid(input);
  if (typeof input !== "string") return undefined;
  const s = input.trim();
  if (s === "" || s.length > 80) return undefined;
  const m = ISO_RE.exec(s);
  if (m && /\d/.test(s)) {
    // `P…M` prima della `T` sarebbero mesi: l'espressione sopra li cattura nel gruppo 2.
    if (m[1] !== undefined || m[2] !== undefined) return undefined;
    return valid(
      num(m[3]) * 7 * 1440 + num(m[4]) * 1440 + num(m[5]) * 60 + num(m[6]) + num(m[7]) / 60,
    );
  }
  if (/^p/i.test(s)) return undefined;
  return parseDurationText(s);
}

// Tutte le ripetizioni sono limitate: sul testo non fidato il tempo deve restare lineare.
const STEP_DURATION_RE =
  /(?:\bper\b|\bcirca\b|\bca\.?|\bancora\b|\bfor\b|\babout\b)\s{1,3}(\d{1,5}(?:[.,]\d{1,3})?)\s{0,3}(minuti|minuto|min|ore|ora|minutes?|hours?|hrs?)\b/i;
const ANY_DURATION_RE = /\d{1,5}(?:[.,]\d{1,3})?\s{0,3}(?:minuti|minuto|min|ore|ora|minutes?|hours?|hrs?)\b/gi;

/**
 * Durata di un passo, solo se il testo ne dice una sola e senza ambiguità ("cuocere per 10 minuti").
 * Con più durate o intervalli ("10-15 minuti") non si inventa nulla.
 */
export function stepDurationFromText(text: string): number | undefined {
  if (text.length > 3000) return undefined;
  const all = text.match(ANY_DURATION_RE);
  if (!all || all.length !== 1) return undefined;
  const m = STEP_DURATION_RE.exec(text);
  if (!m) return undefined;
  if (/\d\s{0,3}(?:-|–|—|\bo\b|\ba\b)\s{0,3}\d{1,5}(?:[.,]\d{1,3})?\s{0,3}(?:minuti|min|ore|ora|minutes?|hours?)/i.test(text)) {
    return undefined;
  }
  return parseDurationText(`${m[1]} ${m[2]}`);
}
