// Dati che la pagina del codice a barre passa alla Cattura tramite l'indirizzo. Tutti facoltativi, tutti verificati.
import { isFoodCategory } from "./lots";

export interface CaptureParams {
  name?: string;
  /** Testo come "500 g": lo interpreta il modulo. */
  quantityText?: string;
  /** Chiave di categoria del motore delle scadenze, già verificata. */
  category?: string;
  barcode?: string;
  brand?: string;
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
  return params;
}
