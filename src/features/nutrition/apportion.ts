// Righe che fanno esattamente il numero mostrato: chi tocca un totale per controllarlo somma le righe a schermo, non i
// valori veri. Gli arrotondamenti si ripartiscono con il metodo dei resti più grandi. Logica pura.

/** Il valore in unità intere della precisione mostrata, arrotondato come lo scrive `Intl.NumberFormat` (e `toFixed`). */
export function toUnits(value: number, digits: number): number {
  return Math.round(Number(value.toFixed(digits)) * 10 ** digits);
}

/**
 * Interi (in unità di `10^-digits`) vicini a `values` che sommano esattamente `target`. A ognuno va la parte intera;
 * le unità che mancano vanno ai resti più grandi, quelle in più si tolgono ai resti più piccoli. Un valore positivo
 * resta a zero solo se le unità non bastano: chi mostra la riga lo dice («meno di 0,1 g»).
 */
export function apportion(values: readonly number[], target: number, digits: number): number[] {
  const scale = 10 ** digits;
  const scaled = values.map((v) => (Number.isFinite(v) && v > 0 ? v * scale : 0));
  // la tolleranza evita che 2,9999999 diventi 2 con resto quasi 1
  const units = scaled.map((x) => Math.floor(x + 1e-9));
  const rest = scaled.map((x, i) => Math.max(0, x - units[i]));
  let diff = target - units.reduce((s, u) => s + u, 0);
  if (diff > 0) {
    // solo chi ha un valore riceve unità: una riga a zero resta zero
    const order = scaled.flatMap((x, i) => (x > 0 ? [i] : [])).sort((a, b) => rest[b] - rest[a] || scaled[b] - scaled[a] || a - b);
    if (order.length === 0) return units;
    for (let k = 0; diff > 0; k = (k + 1) % order.length, diff--) units[order[k]] += 1;
  } else if (diff < 0) {
    // si toglie prima a chi perde meno, e mai fino a far sparire una riga se se ne può fare a meno
    const order = values.map((_, i) => i).sort((a, b) => rest[a] - rest[b] || scaled[b] - scaled[a] || a - b);
    for (const floor of [2, 1]) {
      for (let changed = true; diff < 0 && changed; ) {
        changed = false;
        for (const i of order) {
          if (diff === 0) break;
          if (units[i] >= floor) {
            units[i] -= 1;
            diff += 1;
            changed = true;
          }
        }
      }
    }
  }
  return units;
}

/** Come si scrive una riga: il numero ripartito, o «meno di» la più piccola unità per un valore positivo rimasto a zero. */
export type ShownPart = { units: number; under: false } | { units: 0; under: true };

/**
 * Le righe di un totale mostrato con `digits` decimali: sommate, fanno il totale come è scritto. Restituisce le unità
 * del totale e di ogni riga.
 */
export function shownParts(values: readonly number[], total: number, digits: number): { total: number; parts: ShownPart[] } {
  const target = toUnits(total, digits);
  const units = apportion(values, target, digits);
  return {
    total: target,
    parts: units.map((u, i) => (u === 0 && values[i] > 0 ? { units: 0, under: true } : { units: u, under: false })),
  };
}

/**
 * Le righe di una media: la loro media, con i numeri come sono scritti, fa la media mostrata. La somma da ripartire è
 * la media mostrata per il numero di righe.
 */
export function shownForAverage(values: readonly number[], average: number, digits: number): { average: number; parts: ShownPart[] } {
  const avgUnits = toUnits(average, digits);
  const units = apportion(values, avgUnits * values.length, digits);
  return {
    average: avgUnits,
    parts: units.map((u, i) => (u === 0 && values[i] > 0 ? { units: 0, under: true } : { units: u, under: false })),
  };
}
