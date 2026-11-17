// Limite di richieste in memoria, per chiamante. Codice solo server.
//
// ATTENZIONE: su un servizio senza stato (funzioni serverless) ogni istanza ha la sua memoria, che
// si azzera a ogni avvio: questo è solo una prima difesa contro l'abuso casuale, non un limite
// garantito. Un limite vero richiede un archivio condiviso (o il firewall della piattaforma).

export interface RateLimiterOptions {
  /** Richieste ammesse per finestra. */
  limit: number;
  windowMs: number;
  /** Numero massimo di chiamanti tenuti in memoria. */
  maxKeys?: number;
  now?: () => number;
}

export interface RateDecision {
  allowed: boolean;
  remaining: number;
  /** Secondi da attendere prima di riprovare (zero se ammesso). */
  retryAfterSeconds: number;
}

export interface RateLimiter {
  check(key: string): RateDecision;
  /** Numero di chiamanti attualmente in memoria. */
  size(): number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs } = options;
  const maxKeys = options.maxKeys ?? 5000;
  const now = options.now ?? Date.now;
  const windows = new Map<string, { count: number; resetAt: number }>();

  const purge = (t: number): void => {
    for (const [k, w] of windows) if (w.resetAt <= t) windows.delete(k);
  };

  return {
    check(key: string): RateDecision {
      const t = now();
      let w = windows.get(key);
      if (w && w.resetAt <= t) {
        windows.delete(key);
        w = undefined;
      }
      if (!w) {
        if (windows.size >= maxKeys) {
          purge(t);
          // Ancora pieno: si sacrifica il chiamante più vecchio, così la memoria resta limitata.
          while (windows.size >= maxKeys) {
            const oldest = windows.keys().next();
            if (oldest.done) break;
            windows.delete(oldest.value);
          }
        }
        w = { count: 0, resetAt: t + windowMs };
        windows.set(key, w);
      }
      if (w.count >= limit) {
        return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((w.resetAt - t) / 1000)) };
      }
      w.count++;
      return { allowed: true, remaining: limit - w.count, retryAfterSeconds: 0 };
    },
    size: () => windows.size,
  };
}
