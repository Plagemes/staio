// Pezzi dentro una confezione: testi e scelte di quantità. Funzioni pure, usabili anche dalla registrazione del pasto.
import { piecesLeft, piecesOf, type Lot, type Quantity } from "@/core/ledger";
import { formatQuantity } from "@/core/units";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Come si chiama un pezzo, ricavato dal nome del prodotto; undefined se non si riconosce («pezzo»). */
const PIECE_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bpiadin\w*/, "piadina"],
  [/\btortilla\w*/, "tortilla"],
  [/\bwrap\w*/, "wrap"],
  [/\bpancakes?\b/, "pancake"],
  [/\b(panini|panino)\b/, "panino"],
  [/\b(hamburger|burger)\b/, "hamburger"],
  [/\b(fette|fetta)\b/, "fetta"],
  [/\b(cornetti|cornetto|croissant)\b/, "cornetto"],
  [/\b(brioche)\b/, "brioche"],
  [/\b(muffin)\b/, "muffin"],
  [/\b(crepes|crepe)\b/, "crepe"],
  [/\b(budini|budino)\b/, "budino"],
  [/\b(barrette|barretta)\b/, "barretta"],
];

export function pieceNameFor(productName: string | undefined): string | undefined {
  if (!productName) return undefined;
  const text = fold(productName);
  for (const [pattern, name] of PIECE_NAMES) if (pattern.test(text)) return name;
  return undefined;
}

/** Plurale semplice: -a diventa -e, -o diventa -i, -e diventa -i; le parole che finiscono in consonante o in vocale accentata non cambiano. */
export function pluralIt(word: string): string {
  if (/[^aeiou]$/i.test(word)) return word;
  if (/a$/i.test(word)) return word.replace(/a$/i, "e");
  if (/[oe]$/i.test(word)) return word.replace(/[oe]$/i, "i");
  return word;
}

const num = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

/** «2 pezzi da 100 g» a confezione piena; dopo un consumo solo i pezzi rimasti («1 pezzo», «mezzo pezzo»). */
export function piecesText(lots: readonly Lot[]): string | undefined {
  const first = lots[0];
  if (!first) return undefined;
  const view = piecesOf(first);
  if (!view) return undefined;
  const stima = view.agrees ? "" : " (stima)";
  if (lots.length > 1 || first.remaining === first.initial) {
    const total = lots.reduce((n, l) => n + (piecesOf(l)?.count ?? 0), 0);
    return `${total} pezzi da ${formatQuantity({ value: view.each, unit: first.unit })}${stima}`;
  }
  const left = piecesLeft(first);
  if (left === undefined) return undefined;
  if (left === 0.5) return `mezzo pezzo${stima}`;
  if (left === 1) return `1 pezzo${stima}`;
  return `${Number.isInteger(left) ? left : `circa ${num(left)}`} pezzi${stima}`;
}

export interface PieceChoice {
  id: string;
  /** «1 piadina = 100 g». */
  label: string;
  /** Testo breve per un pulsante: «Un pezzo», «Mezzo pezzo». */
  short: string;
  quantity: Quantity;
  /** Una frazione di pezzo è una stima. */
  estimated: boolean;
}

/**
 * Le quantità che si possono consumare di un lotto fatto di pezzi: 1 piadina, 2 piadine, mezza piadina, ciascuna con
 * la sua grammatura. Vuoto se il lotto non ha pezzi. Mai più di quanto resta.
 */
export function pieceChoices(lot: Lot): PieceChoice[] {
  const view = piecesOf(lot);
  if (!view) return [];
  const name = view.name ?? "pezzo";
  const feminine = /a$/i.test(name);
  const out: PieceChoice[] = [];
  const room = (q: number) => q <= lot.remaining + 1e-9;
  const each = view.each;
  const whole = Math.floor(lot.remaining / each + 1e-9);
  for (let k = 1; k <= Math.min(whole, 3); k++) {
    const quantity = { value: Math.round(k * each * 1000) / 1000, unit: lot.unit };
    out.push({
      id: `pieces-${k}`,
      label: `${k} ${k === 1 ? name : pluralIt(name)} = ${formatQuantity(quantity)}`,
      short: k === 1 ? (feminine ? "Una" : "Un") + (name === "pezzo" ? " pezzo" : ` ${name}`) : `${k} ${pluralIt(name)}`,
      quantity,
      estimated: false,
    });
  }
  const half = { value: Math.round((each / 2) * 1000) / 1000, unit: lot.unit };
  if (room(half.value)) {
    out.push({
      id: "pieces-half",
      label: `${feminine ? "mezza" : "mezzo"} ${name} = ${formatQuantity(half)}`,
      short: `${feminine ? "Mezza" : "Mezzo"} ${name}`,
      quantity: half,
      estimated: true,
    });
  }
  return out;
}
