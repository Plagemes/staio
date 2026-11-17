export type BarcodeFormat = "ean13" | "ean8" | "upca";

export type BarcodeProblem = "empty" | "not_digits" | "bad_length" | "bad_checksum";

export type BarcodeCheck =
  | { ok: true; code: string; format: BarcodeFormat }
  | { ok: false; reason: BarcodeProblem };

const FORMAT_BY_LENGTH: Record<number, BarcodeFormat> = { 8: "ean8", 12: "upca", 13: "ean13" };

/** Cifra di controllo GS1: pesi 3 e 1 alternati a partire dalla cifra a destra del controllo. */
export function checkDigitFor(body: string): number {
  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

/** Accetta cifre con spazi o trattini in mezzo; verifica lunghezza (8, 12, 13) e cifra di controllo. */
export function validateBarcode(input: string): BarcodeCheck {
  const code = input.replace(/[\s-]/g, "");
  if (code === "") return { ok: false, reason: "empty" };
  if (!/^\d+$/.test(code)) return { ok: false, reason: "not_digits" };
  const format = FORMAT_BY_LENGTH[code.length];
  if (!format) return { ok: false, reason: "bad_length" };
  if (checkDigitFor(code.slice(0, -1)) !== Number(code[code.length - 1])) return { ok: false, reason: "bad_checksum" };
  return { ok: true, code, format };
}

export function isValidBarcode(input: string): boolean {
  return validateBarcode(input).ok;
}

/** Forma a 13 cifre: un UPC-A è un EAN-13 con uno zero davanti; un EAN-8 resta com'è. */
export function toGtin13(code: string): string {
  return code.length === 12 ? `0${code}` : code;
}
