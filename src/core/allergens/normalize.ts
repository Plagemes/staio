// Normalizzazione del testo per il controllo degli allergeni: minuscole, niente accenti, niente punteggiatura,
// singolare e plurale ridotti alla stessa radice. Sbaglia di proposito verso l'eccesso: due parole diverse con la
// stessa radice danno un falso allarme, mai un allergene mancato.

/** Minuscole, senza accenti, apostrofi e punteggiatura diventano spazi. */
export function foldText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const words = (s: string): string[] => {
  const f = foldText(s);
  return f === "" ? [] : f.split(" ");
};

/** Articoli e preposizioni: non contano nelle espressioni di più parole («salsa di soia» = «salsa soia»). */
export const STOPWORDS: ReadonlySet<string> = new Set([
  "a", "ad", "al", "allo", "alla", "ai", "agli", "alle", "all",
  "di", "d", "del", "dello", "della", "dei", "degli", "delle", "dell",
  "da", "dal", "dallo", "dalla", "dai", "dagli", "dalle", "dall",
  "in", "nel", "nello", "nella", "nei", "negli", "nelle", "nell",
  "con", "per", "su", "sul", "sulla", "e", "ed", "o",
  "il", "lo", "la", "i", "gli", "le", "l", "un", "uno", "una",
  "of", "the", "and",
]);

/** Preposizioni ammesse dentro le eccezioni («burro di cacao», «latte d'avena»): niente «e», che unirebbe due cose. */
export const OF_WORDS: ReadonlySet<string> = new Set([
  "di", "d", "del", "dello", "della", "dei", "degli", "delle", "dell", "al", "alla", "all", "allo", "ai", "alle", "agli", "of",
]);

/**
 * Radice prudente di una parola italiana: toglie le vocali finali (singolare e plurale, maschile e femminile) e
 * l'«h» di «-chi/-ghi» («funghi» = «fungo», «pistacchi» = «pistacchio», «acciughe» = «acciuga»).
 */
export function stemWord(w: string): string {
  let s = w;
  while (s.length > 2 && /[aeiou]$/.test(s)) s = s.slice(0, -1);
  if (s.length > 2 && /[cg]h$/.test(s)) s = s.slice(0, -1);
  return s;
}

export interface Token {
  raw: string;
  stem: string;
  /** Posizioni delle parole da cui viene: una, o due per le parole unite («pan grattato» → «pangrattato»). */
  at: readonly number[];
}

export interface Segment {
  /** Solo le parole vere, nell'ordine. */
  words: readonly string[];
  /** Le parole e le coppie di parole vicine unite. */
  tokens: readonly Token[];
}

/** Il testo in frammenti (virgole, punti, parentesi, a capo), ciascuno in parole e coppie unite. */
export function segments(text: string): Segment[] {
  const out: Segment[] = [];
  for (const piece of text.split(/[.,;:!?()[\]{}\n\r\t/|•·]+/)) {
    const ws = words(piece);
    if (ws.length === 0) continue;
    const tokens: Token[] = ws.map((raw, i) => ({ raw, stem: stemWord(raw), at: [i] }));
    for (let i = 0; i + 1 < ws.length; i++) {
      const raw = `${ws[i]}${ws[i + 1]}`;
      tokens.push({ raw, stem: stemWord(raw), at: [i, i + 1] });
    }
    out.push({ words: ws, tokens });
  }
  return out;
}
