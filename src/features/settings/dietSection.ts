// Le tre righe richiuse di Alimentazione sotto gli allergeni, e il parametro `?sezione=` che ne apre una. Logica pura.

export const DIET_SECTIONS = ["obiettivi", "pasti", "conferme"] as const;

export type DietSection = (typeof DIET_SECTIONS)[number];

/** `?sezione=conferme` → `"conferme"`; qualunque altra cosa (o niente) → `null`: nessuna riga aperta. */
export function parseDietSection(value: string | null | undefined): DietSection | null {
  return DIET_SECTIONS.find((s) => s === value) ?? null;
}
