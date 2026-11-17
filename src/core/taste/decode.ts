import type { TasteData, TasteFood } from "./types";

/**
 * Forma compatta del file dei dati (`data/flavorgraph.json`): un alimento per riga come
 * `[chiave, nome, idStaio[], alias?]` e, nello stesso ordine, i suoi vicini come
 * `[indice, punteggio per cento, valore d'ordine per cento]`, già in ordine.
 */
export interface CompactTasteData {
  source: "flavorgraph";
  version: string;
  foods: readonly (readonly [string, string, readonly string[]] | readonly [string, string, readonly string[], readonly string[]])[];
  /** Come ordinare i vicini: dichiarato nel file, per memoria. */
  method?: string;
  neighbors: readonly (readonly (readonly [number, number, number])[])[];
}

/** Dalla forma compatta ai dati usati dal resto del nucleo. I valori per cento diventano da 0 a 1. */
export function decodeTasteData(compact: CompactTasteData): TasteData {
  const foods: TasteFood[] = compact.foods.map((f) => ({
    key: f[0],
    name: f[1],
    foodIds: f[2],
    ...(f[3] && f[3].length > 0 ? { aliases: f[3] } : {}),
  }));
  const neighbors: Record<string, [string, number, number][]> = {};
  compact.neighbors.forEach((list, i) => {
    const key = foods[i]?.key;
    if (key === undefined) return;
    neighbors[key] = list.flatMap(([j, pct, order]) => {
      const other = foods[j]?.key;
      return other === undefined ? [] : [[other, pct / 100, order / 100] as [string, number, number]];
    });
  });
  return { source: compact.source, version: compact.version, foods, neighbors };
}
