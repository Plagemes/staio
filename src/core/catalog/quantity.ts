import type { BaseUnit, PackageQuantity } from "./types";

interface UnitInfo {
  unit: BaseUnit;
  factor: number;
}

const UNITS: Record<string, UnitInfo> = {
  mg: { unit: "g", factor: 0.001 },
  g: { unit: "g", factor: 1 },
  gr: { unit: "g", factor: 1 },
  gram: { unit: "g", factor: 1 },
  grams: { unit: "g", factor: 1 },
  grammi: { unit: "g", factor: 1 },
  kg: { unit: "g", factor: 1000 },
  kilogram: { unit: "g", factor: 1000 },
  kilograms: { unit: "g", factor: 1000 },
  ml: { unit: "ml", factor: 1 },
  cl: { unit: "ml", factor: 10 },
  dl: { unit: "ml", factor: 100 },
  l: { unit: "ml", factor: 1000 },
  lt: { unit: "ml", factor: 1000 },
  litro: { unit: "ml", factor: 1000 },
  litri: { unit: "ml", factor: 1000 },
  liter: { unit: "ml", factor: 1000 },
  liters: { unit: "ml", factor: 1000 },
  litre: { unit: "ml", factor: 1000 },
  litres: { unit: "ml", factor: 1000 },
  pz: { unit: "pz", factor: 1 },
  pezzi: { unit: "pz", factor: 1 },
  pcs: { unit: "pz", factor: 1 },
  piece: { unit: "pz", factor: 1 },
  pieces: { unit: "pz", factor: 1 },
  unit: { unit: "pz", factor: 1 },
  units: { unit: "pz", factor: 1 },
};

const UNIT_PATTERN =
  "kilograms?|kg|mg|grammi|grams?|gr|g|ml|cl|dl|litri|litro|liters?|litres?|lt|l|pezzi|pz|pcs|pieces?|units?";
const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
const MULTI = new RegExp(String.raw`(\d+)\s*[x×*]\s*(${NUMBER})\s*(${UNIT_PATTERN})(?![a-z])`, "i");
const SINGLE = new RegExp(String.raw`(${NUMBER})\s*(${UNIT_PATTERN})(?![a-z])`, "i");

const round = (n: number) => Math.round(n * 1000) / 1000;
const toNumber = (s: string) => Number(s.replace(",", "."));

/**
 * Legge la quantità dalla scritta dell'etichetta ("500 g", "1 l", "33 cl", "6 x 125 g").
 * Se la scritta non è interpretabile restano solo il testo e nessun valore.
 */
export function parsePackageQuantity(text: string): PackageQuantity | undefined {
  const raw = text.trim();
  if (raw === "") return undefined;

  const multi = MULTI.exec(raw);
  const single = SINGLE.exec(raw);
  // vince la lettura che inizia prima: "250 g (2 x 125 g)" resta 250 g
  if (multi && (!single || multi.index <= single.index)) {
    const count = Number(multi[1]);
    const info = UNITS[(multi[3] as string).toLowerCase()];
    const size = toNumber(multi[2] as string);
    if (info && count > 0 && size > 0) {
      return { text: raw, value: round(count * size * info.factor), unit: info.unit, count };
    }
  }
  if (single) {
    const info = UNITS[(single[2] as string).toLowerCase()];
    const value = toNumber(single[1] as string);
    if (info && value > 0) return { text: raw, value: round(value * info.factor), unit: info.unit };
  }
  return { text: raw };
}

/** Quantità come testo per il modulo di cattura: "500 g", "1,5 kg", "330 ml", "1 l". */
export function quantityText(quantity: PackageQuantity | undefined): string | undefined {
  if (!quantity || quantity.value === undefined || quantity.unit === undefined) return undefined;
  let { value } = quantity;
  let unit: string = quantity.unit;
  if (unit === "g" && value >= 1000) {
    value /= 1000;
    unit = "kg";
  } else if (unit === "ml" && value >= 1000) {
    value /= 1000;
    unit = "l";
  }
  return `${String(round(value)).replace(".", ",")} ${unit}`;
}
