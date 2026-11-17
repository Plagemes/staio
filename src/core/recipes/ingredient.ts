// Lettura prudente di una riga di ingredienti. Ciò che non si riconosce resta nel nome o nella nota:
// meglio una quantità assente che una quantità inventata.

import { parseQuantity, type Quantity } from "../units";

export interface ParsedIngredient {
  /** La riga come scritta (ripulita da elenchi puntati e spazi doppi). */
  raw: string;
  name: string;
  quantity?: Quantity;
  note?: string;
  /** Vero se si è riconosciuta una quantità o un "quanto basta". */
  recognized: boolean;
}

const UNICODE_FRACTIONS: Readonly<Record<string, string>> = {
  "½": "1/2",
  "⅓": "1/3",
  "⅔": "2/3",
  "¼": "1/4",
  "¾": "3/4",
  "⅕": "1/5",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};

const ENGLISH_UNITS: ReadonlyArray<{
  re: RegExp;
  make: (v: number) => Quantity;
}> = [
  { re: /^(?:tbsps?|tbs|tablespoons?)\b\.?/i, make: (v) => ({ value: v, unit: "cucchiaio" }) },
  { re: /^(?:tsps?|teaspoons?)\b\.?/i, make: (v) => ({ value: v, unit: "cucchiaino" }) },
  { re: /^(?:cups?)\b\.?/i, make: (v) => ({ value: v, unit: "tazza" }) },
  {
    re: /^(?:oz|ounces?)\b\.?/i,
    make: (v) => ({ value: Math.round(v * 28.3495 * 10) / 10, unit: "g" }),
  },
  {
    re: /^(?:lbs?|pounds?)\b\.?/i,
    make: (v) => ({ value: Math.round(v * 453.592), unit: "g" }),
  },
  { re: /^(?:pinch(?:es)?)\b\.?/i, make: (v) => ({ value: v, unit: "pizzico" }) },
  { re: /^(?:grams?|gr)\b\.?/i, make: (v) => ({ value: v, unit: "g" }) },
  { re: /^(?:kilograms?|kilos?)\b\.?/i, make: (v) => ({ value: v, unit: "kg" }) },
  { re: /^(?:milliliters?|millilitres?)\b\.?/i, make: (v) => ({ value: v, unit: "ml" }) },
  { re: /^(?:liters?|litres?)\b\.?/i, make: (v) => ({ value: v, unit: "l" }) },
];

const ENGLISH_COUNT = /^(cloves?|slices?|sprigs?|bunch(?:es)?|cans?|stalks?|leaves)\b\.?\s*(?:of\s+)?/i;

/** Nomi di conteggio ("2 spicchi di aglio"): restano come nota, la quantità è in pezzi. */
const COUNT_NOUNS =
  /^(spicchi[oa]?|fett[ae]|foglie|foglia|bustin[ae]|vasett[oi]|lattin[ae]|ramett[oi]|ciuff[oi]|mazzett[oi]|coste|costa|gamb[oi]|rotol[oi]|filett[oi]|scatol[ae]|barattol[oi]|panett[oi]|cubett[oi]|noce|noci|dado|dadi|manciat[ae]|testa|teste|cucchiaiat[ae])\s+(?:di|d')\s*/i;

const TO_TASTE =
  /(?:^|[\s,;(])(q\.?\s?b\.?|quanto basta|a piacere|to taste|as needed|as required)(?=$|[\s,;).])/i;

const KNOWN_TRAILING_UNIT =
  /^(\d+(?:[.,]\d+)?)\s*(g|gr|kg|hg|mg|ml|cl|dl|lt|l|grammi|etti|etto|litri|litro|cucchiai|cucchiaio|cucchiaini|cucchiaino|pz|pezzi|pezzo)\.?$/i;

const clean = (s: string): string => s.replace(/\s+/g, " ").trim();
const round4 = (n: number): number => Math.round(n * 10000) / 10000;

function numberFront(s: string): { value: number; rest: string; range?: [number, number] } | null {
  let m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)(?!\d)/.exec(s);
  let value: number;
  if (m && Number(m[3]) !== 0) {
    value = Number(m[1]) + Number(m[2]) / Number(m[3]);
  } else if ((m = /^(\d+)\s*\/\s*(\d+)(?!\d)/.exec(s)) && Number(m[2]) !== 0) {
    value = Number(m[1]) / Number(m[2]);
  } else if ((m = /^(\d+(?:[.,]\d+)?)/.exec(s))) {
    value = parseFloat((m[1] as string).replace(",", "."));
  } else return null;
  let rest = s.slice((m as RegExpExecArray)[0].length);
  let range: [number, number] | undefined;
  const r = /^\s*(?:-|–|—|to)\s*(\d+(?:[.,]\d+)?)(?!\s*\/)/i.exec(rest);
  if (r) {
    const hi = parseFloat((r[1] as string).replace(",", "."));
    if (hi > value) {
      range = [value, hi];
      rest = rest.slice(r[0].length);
    }
  }
  if (!Number.isFinite(value) || value <= 0) return null;
  return { value: round4(value), rest: rest.trim(), ...(range ? { range } : {}) };
}

interface Front {
  quantity: Quantity;
  rest: string;
  notes: string[];
}

function quantityFront(s: string): Front | null {
  const notes: string[] = [];
  const num = numberFront(s);
  if (num) {
    if (num.range) notes.push(`da ${num.range[0]} a ${num.range[1]}`);
    for (const e of ENGLISH_UNITS) {
      const m = e.re.exec(num.rest);
      if (m) {
        const rest = num.rest.slice(m[0].length).replace(/^of\s+/i, "");
        return { quantity: e.make(num.value), rest: clean(rest), notes };
      }
    }
    const c = ENGLISH_COUNT.exec(num.rest);
    if (c) {
      notes.push((c[1] as string).toLowerCase());
      return {
        quantity: { value: num.value, unit: "pz" },
        rest: clean(num.rest.slice(c[0].length)),
        notes,
      };
    }
    const parsed = parseQuantity(`${num.value} ${num.rest}`);
    if (!parsed.ok) return null;
    return { quantity: parsed.value.quantity, rest: clean(parsed.value.rest), notes };
  }
  if (/^un\s+po['’]?\s+di\b/i.test(s)) {
    return { quantity: { value: 1, unit: "pizzico" }, rest: clean(s.replace(/^un\s+po['’]?\s+di\s*/i, "")), notes: ["un po'"] };
  }
  if (/^(?:mezz[oa]|una?|uno|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s/i.test(s)) {
    const parsed = parseQuantity(s);
    if (!parsed.ok) return null;
    return { quantity: parsed.value.quantity, rest: clean(parsed.value.rest), notes };
  }
  return null;
}

/** Elimina elenchi puntati, caselle e spazi doppi. Restituisce una stringa vuota se non resta nulla. */
export function cleanLine(line: string): string {
  // Prima si accorcia e si compattano gli spazi: le espressioni seguenti lavorano su righe corte.
  let s = clean(line.slice(0, 2000).replace(/[   ]/g, " "));
  s = s.replace(/^\s*(?:\[[ xX]?\]|[-–—•*·▢☐□✓✔▪●○◦])+\s*/u, "");
  for (const [k, v] of Object.entries(UNICODE_FRACTIONS)) {
    s = s.replace(new RegExp(`(\\d)\\s*${k}`, "g"), `$1 ${v}`).replaceAll(k, v);
  }
  return clean(s).slice(0, 400);
}

/**
 * Interpreta una riga di ingredienti ("200 g di farina 00", "2 uova", "sale q.b.", "1 1/2 tazze di latte").
 * Non lancia mai; restituisce `null` per una riga vuota.
 */
export function parseIngredientLine(line: string): ParsedIngredient | null {
  try {
    const raw = cleanLine(typeof line === "string" ? line : "");
    if (raw === "") return null;
    let s = raw;
    const notes: string[] = [];
    let recognized = false;
    let quantity: Quantity | undefined;

    const tt = TO_TASTE.exec(s);
    if (tt) {
      const word = (tt[1] as string).toLowerCase();
      notes.push(word === "a piacere" ? "a piacere" : "q.b.");
      s = clean(s.replace(tt[1] as string, " ").replace(/\(\s*\)/g, " ").replace(/\s+([,;.])/g, "$1"));
      recognized = true;
    }

    const front = quantityFront(s);
    if (front) {
      quantity = front.quantity;
      notes.push(...front.notes);
      s = front.rest;
      recognized = true;
      const c = COUNT_NOUNS.exec(s);
      if (c) {
        notes.push((c[1] as string).toLowerCase());
        s = clean(s.slice(c[0].length));
      }
    } else {
      const sep = /^(.+?)(?::\s*|\s[-–—]\s+)(\d.*)$/.exec(s);
      const unitTail = /^(.+?)\s+(\d+(?:[.,]\d+)?\s*[a-zA-Z]+\.?)$/.exec(s);
      const tail = sep ?? (unitTail && KNOWN_TRAILING_UNIT.test(unitTail[2] as string) ? unitTail : null);
      if (tail) {
        const parsed = parseQuantity(tail[2] as string);
        if (parsed.ok && parsed.value.rest === "") {
          quantity = parsed.value.quantity;
          s = clean(tail[1] as string);
          recognized = true;
        }
      }
    }

    // Parentesi: restano come nota.
    s = s.replace(/\(([^()]*)\)/g, (_m, inner: string) => {
      if (clean(inner) !== "") notes.push(clean(inner));
      return " ";
    });
    s = clean(s);
    // Dopo la prima virgola: modo di preparazione ("burro, a temperatura ambiente").
    const comma = s.indexOf(",");
    if (comma > 0) {
      const after = clean(s.slice(comma + 1));
      if (after !== "") notes.push(after);
      s = clean(s.slice(0, comma));
    }
    s = clean(s.replace(/^(?:di|d')\s*/i, "").replace(/[.;:,\s]+$/, ""));

    if (s === "") {
      // Niente nome: si conserva la riga intera, senza quantità inventate.
      return { raw, name: raw.slice(0, 200), recognized: false };
    }
    const note = clean(notes.join("; "));
    return {
      raw,
      name: s.slice(0, 200),
      ...(quantity ? { quantity } : {}),
      ...(note !== "" ? { note: note.slice(0, 200) } : {}),
      recognized,
    };
  } catch {
    return null;
  }
}
