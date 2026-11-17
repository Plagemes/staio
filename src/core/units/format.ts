import { UNIT_INFO, clean, type Quantity, type Unit } from "./types";

export interface FormatOptions {
  /** Anteppone la tilde: valore stimato. */
  estimated?: boolean;
}

const PLURALS: Partial<Record<Unit, [string, string]>> = {
  cucchiaio: ["cucchiaio", "cucchiai"],
  cucchiaino: ["cucchiaino", "cucchiaini"],
  tazza: ["tazza", "tazze"],
  bicchiere: ["bicchiere", "bicchieri"],
  pizzico: ["pizzico", "pizzichi"],
  confezione: ["confezione", "confezioni"],
};

function round(n: number, decimals: number): number {
  const f = 10 ** decimals;
  const r = Math.round((clean(Math.abs(n)) + Number.EPSILON) * f) / f;
  return n < 0 && r !== 0 ? -r : r;
}

/** Numero con virgola decimale, senza zeri finali e senza separatore delle migliaia. */
function num(n: number, decimals: number): string {
  const r = round(n, decimals);
  let s = r.toFixed(decimals);
  if (s.includes(".")) s = s.replace(/\.?0+$/, "");
  return s.replace(".", ",");
}

function metricMass(g: number): string {
  const abs = Math.abs(g);
  if (abs > 0 && abs < 1) {
    const mg = round(g * 1000, 0);
    return Math.abs(mg) < 1000 ? `${num(mg, 0)} mg` : `${num(g, 0)} g`;
  }
  if (abs >= 1000) return `${num(g / 1000, 2)} kg`;
  const decimals = abs >= 10 ? 0 : 1;
  if (Math.abs(round(g, decimals)) >= 1000) return `${num(g / 1000, 2)} kg`;
  return `${num(g, decimals)} g`;
}

function metricVolume(ml: number): string {
  const abs = Math.abs(ml);
  if (abs >= 500) return `${num(ml / 1000, 2)} l`;
  return `${num(ml, abs >= 10 ? 0 : 1)} ml`;
}

/** Formatta in italiano scegliendo l'unità più leggibile ("1,5 kg", "0,6 l", "4 pz"). */
export function formatQuantity(q: Quantity, options: FormatOptions = {}): string {
  const prefix = options.estimated ? "~" : "";
  if (!Number.isFinite(q.value)) return `${prefix}?`;
  const info = UNIT_INFO[q.unit];
  const base = q.value * info.factor;
  let text: string;
  if (info.dimension === "mass") {
    text = metricMass(base);
  } else if (info.dimension === "volume" && PLURALS[q.unit] === undefined) {
    text = metricVolume(base);
  } else if (q.unit === "pz") {
    text = `${num(q.value, 2)} pz`;
  } else {
    const forms = PLURALS[q.unit] as [string, string];
    text = `${num(q.value, 2)} ${round(q.value, 2) === 1 ? forms[0] : forms[1]}`;
  }
  return prefix + text;
}
