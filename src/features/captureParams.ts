// Dati che la pagina del codice a barre passa alla Cattura tramite l'indirizzo. Tutti facoltativi, tutti verificati.
import { usableDaysAfterOpening } from "@/core/expiry";
import { isFoodCategory } from "./lots";

export interface CaptureParams {
  name?: string;
  /** Testo come "500 g": lo interpreta il modulo. */
  quantityText?: string;
  /** Chiave di categoria del motore delle scadenze, già verificata. */
  category?: string;
  barcode?: string;
  brand?: string;
  /** Giorni dopo l'apertura scritti sull'etichetta del prodotto: valgono solo finché il codice a barre resta collegato. */
  daysAfterOpening?: number;
}

const clean = (value: string | null | undefined, max: number): string | undefined => {
  const text = (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  return text === "" ? undefined : text;
};

/** Legge `nome`, `quantita`, `categoria`, `barcode` e `marca`; ignora ciò che non è valido. */
export function readCaptureParams(get: (key: string) => string | null | undefined): CaptureParams {
  const params: CaptureParams = {};
  const name = clean(get("nome"), 120);
  if (name) params.name = name;
  const quantityText = clean(get("quantita"), 40);
  if (quantityText) params.quantityText = quantityText;
  const category = clean(get("categoria"), 40);
  if (category && isFoodCategory(category)) params.category = category;
  const barcode = clean(get("barcode"), 20);
  if (barcode && /^\d{8,14}$/.test(barcode)) params.barcode = barcode;
  const brand = clean(get("marca"), 60);
  if (brand) params.brand = brand;
  const days = Number(clean(get("apertura"), 5));
  if (params.barcode && usableDaysAfterOpening(days) !== undefined) params.daysAfterOpening = days;
  return params;
}

/** Unisce due letture dei parametri: dove la prima ha un valore vince, altrimenti vale la seconda. */
export function mergeCaptureParams(primary: CaptureParams, fallback: CaptureParams): CaptureParams {
  return { ...fallback, ...primary };
}

/** Chiave stabile dei parametri: serve a sapere se sono gli stessi già usati. */
export function captureParamsKey(params: CaptureParams): string {
  return JSON.stringify([params.name, params.quantityText, params.category, params.barcode, params.brand, params.daysAfterOpening]);
}

/**
 * Ciò che l'utente ha scritto o scelto nel modulo. Un campo assente non è stato toccato e segue i parametri
 * dell'indirizzo, anche se arrivano dopo il primo disegno della pagina; un campo presente non si sovrascrive mai.
 * `null` su codice e marca vuol dire «scollegati».
 */
export interface CaptureEdits {
  name?: string;
  quantityText?: string;
  category?: string;
  barcode?: string | null;
  brand?: string | null;
}

export interface ResolvedCaptureFields {
  name: string;
  quantityText: string;
  /** `undefined`: nessuna scelta né parametro, la categoria si propone dal nome. */
  category: string | undefined;
  barcode: string | undefined;
  brand: string | undefined;
  daysAfterOpening: number | undefined;
}

export function resolveCaptureFields(params: CaptureParams, edits: CaptureEdits): ResolvedCaptureFields {
  return {
    name: edits.name ?? params.name ?? "",
    quantityText: edits.quantityText ?? params.quantityText ?? "",
    category: edits.category ?? params.category,
    barcode: edits.barcode === undefined ? params.barcode : (edits.barcode ?? undefined),
    brand: edits.brand === undefined ? params.brand : (edits.brand ?? undefined),
    // senza codice a barre il dato non ha più un prodotto a cui riferirsi
    daysAfterOpening: edits.barcode === null ? undefined : params.daysAfterOpening,
  };
}
