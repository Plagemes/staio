// Misure per ridurre una foto prima dell'invio. Il disegno sul canvas sta altrove (src/features/ai/image.ts).

export interface FitLimits {
  /** Lato più lungo ammesso, in pixel. */
  maxSide: number;
  /** Area massima, in pixel: uno scontrino lungo e stretto ha bisogno di altezza, non di larghezza. */
  maxPixels: number;
}

/** Dimensioni ridotte (mai ingrandite) per stare nei limiti, con le stesse proporzioni. */
export function fitWithin(width: number, height: number, limits: FitLimits): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const bySide = Math.min(1, limits.maxSide / Math.max(width, height));
  const byArea = Math.min(1, Math.sqrt(limits.maxPixels / (width * height)));
  const scale = Math.min(bySide, byArea);
  if (scale === 1) return { width: Math.round(width), height: Math.round(height) };
  // per difetto, così i limiti non vengono superati dall'arrotondamento
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}
