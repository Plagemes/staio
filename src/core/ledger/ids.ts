// Generatore di id: tempo (ordinabile) + contatore + casualità.

export type IdGenerator = () => string;

export interface IdGeneratorOptions {
  /** Millisecondi dall'epoca. Default: Date.now. */
  now?: () => number;
  /** Numero in [0, 1). Default: crypto.getRandomValues se disponibile, altrimenti Math.random. */
  random?: () => number;
}

const TIME_CHARS = 10;
const COUNTER_CHARS = 3;
const RANDOM_CHARS = 8;
const COUNTER_LIMIT = 36 ** COUNTER_CHARS;

function encode(n: number, width: number): string {
  return n.toString(36).padStart(width, "0");
}

function defaultRandom(): number {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    return c.getRandomValues(new Uint32Array(1))[0] / 2 ** 32;
  }
  return Math.random();
}

/**
 * Crea un generatore i cui id sono ordinabili come stringhe nell'ordine di generazione
 * (il tempo non torna mai indietro e un contatore separa gli id dello stesso millisecondo).
 * Tra dispositivi diversi l'ordine segue il tempo, con la parte casuale a evitare collisioni.
 */
export function createIdGenerator(options: IdGeneratorOptions = {}): IdGenerator {
  const now = options.now ?? Date.now;
  const random = options.random ?? defaultRandom;
  let lastTime = -1;
  let counter = 0;
  return () => {
    let time = Math.max(Math.floor(now()), lastTime, 0);
    if (time === lastTime) {
      counter += 1;
      if (counter >= COUNTER_LIMIT) {
        time += 1;
        counter = 0;
      }
    } else {
      counter = 0;
    }
    lastTime = time;
    let suffix = "";
    for (let i = 0; i < RANDOM_CHARS; i++) {
      suffix += encode(Math.min(35, Math.floor(random() * 36)), 1);
    }
    return encode(time, TIME_CHARS) + encode(counter, COUNTER_CHARS) + suffix;
  };
}

const defaultGenerator = createIdGenerator();

/** Generatore predefinito, usabile per id di eventi e di lotti. */
export function generateId(): string {
  return defaultGenerator();
}
