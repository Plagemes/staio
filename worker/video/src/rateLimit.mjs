// Limite di richieste per chiave (di solito l'indirizzo del client): finestra scorrevole, in memoria.

const MAX_KEYS = 10_000;

/**
 * @param {{ max: number, windowMs: number }} options
 */
export function createRateLimiter({ max, windowMs }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  function prune(now) {
    for (const [key, list] of hits) {
      const fresh = list.filter((t) => now - t < windowMs);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  }

  return {
    /** Registra una richiesta. @returns {{ allowed: true } | { allowed: false, retryAfterSec: number }} */
    take(key, now = Date.now()) {
      if (hits.size >= MAX_KEYS) prune(now);
      // se dopo la pulizia c'è ancora troppa gente, si rifiuta: meglio che far crescere la memoria
      if (hits.size >= MAX_KEYS && !hits.has(key)) return { allowed: false, retryAfterSec: Math.ceil(windowMs / 1000) };
      const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
      if (list.length >= max) {
        hits.set(key, list);
        return { allowed: false, retryAfterSec: Math.max(1, Math.ceil((list[0] + windowMs - now) / 1000)) };
      }
      list.push(now);
      hits.set(key, list);
      return { allowed: true };
    },
    size: () => hits.size,
  };
}

/** Quante richieste in corso contemporaneamente: oltre il tetto si risponde «occupato». */
export function createSlots(max) {
  let used = 0;
  return {
    acquire() {
      if (used >= max) return undefined;
      used += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        used -= 1;
      };
    },
    inUse: () => used,
  };
}
