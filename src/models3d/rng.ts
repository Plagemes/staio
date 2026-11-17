/** Generatore casuale deterministico ricavato da una stringa (stesso seme, stessa sequenza). */

export interface Rng {
  /** Numero in [0, 1). */
  next(): number;
  /** Numero in [min, max). */
  range(min: number, max: number): number;
  /** Numero in [-1, 1). */
  signed(): number;
  /** Intero in [min, max], estremi inclusi. */
  int(min: number, max: number): number;
}

/** Hash a 32 bit di una stringa (xmur3). */
export function hashSeed(input: string): number {
  let h = 1779033703 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/** mulberry32 inizializzato dall'hash della stringa. */
export function createRng(seed: string | number): Rng {
  let a = hashSeed(String(seed));
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + (max - min) * next(),
    signed: () => next() * 2 - 1,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
  };
}
