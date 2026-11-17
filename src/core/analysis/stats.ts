// Statistica di base per le analisi personali: nessuna dipendenza, nessuna costante a memoria.
// La distribuzione t è calcolata con le formule esatte per gradi di libertà interi
// (Abramowitz e Stegun, 26.7.3 e 26.7.4) e invertita per bisezione.

/** Oltre questo numero di gradi di libertà la t è praticamente la normale: si tronca (differenza < 0,3%). */
const MAX_DF = 500;

export const mean = (xs: readonly number[]): number => {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
};

/** Varianza campionaria (denominatore n-1); 0 con meno di due valori. */
export function sampleVariance(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let s = 0;
  for (const x of xs) s += (x - m) * (x - m);
  return s / (xs.length - 1);
}

export const sampleSd = (xs: readonly number[]): number => Math.sqrt(sampleVariance(xs));

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Evita residui come 0.30000000000000004 nei risultati. */
export const round = (n: number, digits = 6): number => {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

function normalizeDf(df: number): number {
  if (!Number.isFinite(df)) return MAX_DF;
  return Math.max(1, Math.min(MAX_DF, Math.floor(df)));
}

/** P(|T| < t) per una t di Student con `df` gradi di libertà (intero, 1..500). */
function centralProbability(t: number, dfIn: number): number {
  const df = normalizeDf(dfIn);
  const abs = Math.abs(t);
  if (abs === Infinity) return 1;
  const theta = Math.atan(abs / Math.sqrt(df));
  const sin = Math.sin(theta);
  const cos = Math.cos(theta);
  const c2 = cos * cos;
  if (df === 1) return (2 * theta) / Math.PI;
  let sum = 1;
  let term = 1;
  if (df % 2 === 1) {
    for (let j = 2; j <= df - 3; j += 2) {
      term *= (j / (j + 1)) * c2;
      sum += term;
    }
    return Math.min(1, (2 / Math.PI) * (theta + sin * cos * sum));
  }
  for (let j = 1; j <= df - 3; j += 2) {
    term *= (j / (j + 1)) * c2;
    sum += term;
  }
  return Math.min(1, sin * sum);
}

/** Valore p a due code per una statistica t. */
export function twoSidedP(t: number, df: number): number {
  if (Number.isNaN(t)) return 1;
  return Math.max(0, 1 - centralProbability(t, df));
}

/** Valore critico t per un intervallo bilaterale al livello `confidence` (per esempio 0,95). */
export function tCritical(confidence: number, df: number): number {
  const target = Math.min(Math.max(confidence, 0.5), 0.999999);
  let lo = 0;
  let hi = 1e6;
  for (let i = 0; i < 60 && hi - lo > 1e-9; i++) {
    const mid = (lo + hi) / 2;
    if (centralProbability(mid, df) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Coppie di giorni adiacenti minime per fidarsi della stima dell'autocorrelazione; sotto, vale zero. */
const MIN_AUTOCORRELATION_PAIRS = 3;

export interface Autocorrelation {
  /** Autocorrelazione di ordine 1, limitata a [0, 0,9] (una correlazione negativa non gonfia nulla). */
  rho: number;
  /** Coppie di giorni adiacenti nel calendario su cui è calcolata. Con meno di 3, `rho` vale 0. */
  pairs: number;
  /** Fattore di gonfiaggio della varianza della media o della pendenza: (1+rho)/(1-rho). */
  inflation: number;
}

/**
 * Autocorrelazione di ordine 1 di una serie giornaliera, calcolata SOLO su coppie di giorni
 * adiacenti nel calendario (`x` differisce di 1): un buco nella serie non crea coppie false.
 * Gli scarti sono rispetto alla media dei valori dati (per i residui di una retta sono già nulli).
 */
export function lag1Autocorrelation(points: readonly { x: number; e: number }[]): Autocorrelation {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const n = pts.length;
  const m = n > 0 ? mean(pts.map((p) => p.e)) : 0;
  let sumSq = 0;
  for (const p of pts) sumSq += (p.e - m) * (p.e - m);
  let cross = 0;
  let pairs = 0;
  for (let i = 0; i + 1 < n; i++) {
    if (pts[i + 1].x - pts[i].x === 1) {
      cross += (pts[i].e - m) * (pts[i + 1].e - m);
      pairs++;
    }
  }
  let rho = 0;
  if (pairs >= MIN_AUTOCORRELATION_PAIRS && sumSq > 0) {
    rho = Math.min(0.9, Math.max(0, cross / pairs / (sumSq / n)));
  }
  return { rho, pairs, inflation: (1 + rho) / (1 - rho) };
}

export interface LinearFit {
  n: number;
  slope: number;
  intercept: number;
  xMean: number;
  yMean: number;
  sxx: number;
  /** Deviazione standard dei residui (n-2 gradi di libertà). */
  residualSd: number;
  /** Autocorrelazione dei residui di ordine 1, limitata a [0, 0,9], su coppie di giorni adiacenti. */
  autocorrelation: number;
  /** Coppie di giorni adiacenti usate per stimarla. */
  autocorrelationPairs: number;
  /** Fattore di gonfiaggio della varianza della stima per residui correlati: (1+r)/(1-r). */
  inflation: number;
  /** Numero di osservazioni equivalenti indipendenti: n / inflation. */
  effectiveN: number;
  /** Errore standard della pendenza, già gonfiato. */
  slopeSe: number;
  /** Gradi di libertà usati per gli intervalli (da effectiveN). */
  df: number;
}

/**
 * Retta ai minimi quadrati (`x` in giorni di calendario). I residui di serie giornaliere (peso) non
 * sono indipendenti: si stima la loro autocorrelazione di ordine 1 sulle sole coppie di giorni
 * adiacenti (`lag1Autocorrelation`) e si gonfia la varianza delle stime di conseguenza
 * (approssimazione AR(1)), così una serie rumorosa o a onde dà un intervallo più largo.
 * `undefined` con meno di 3 punti o con x tutte uguali.
 */
export function linearFit(points: readonly { x: number; y: number }[]): LinearFit | undefined {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const n = pts.length;
  if (n < 3) return undefined;
  const xMean = mean(pts.map((p) => p.x));
  const yMean = mean(pts.map((p) => p.y));
  let sxx = 0;
  let sxy = 0;
  for (const p of pts) {
    sxx += (p.x - xMean) * (p.x - xMean);
    sxy += (p.x - xMean) * (p.y - yMean);
  }
  if (sxx === 0) return undefined;
  const slope = sxy / sxx;
  const intercept = yMean - slope * xMean;
  const residuals = pts.map((p) => p.y - (intercept + slope * p.x));
  let sse = 0;
  for (const e of residuals) sse += e * e;
  const residualSd = Math.sqrt(sse / (n - 2));
  const ac = lag1Autocorrelation(pts.map((p, i) => ({ x: p.x, e: residuals[i] })));
  const rho = ac.rho;
  const inflation = ac.inflation;
  const effectiveN = n / inflation;
  return {
    n,
    slope,
    intercept,
    xMean,
    yMean,
    sxx,
    residualSd,
    autocorrelation: rho,
    autocorrelationPairs: ac.pairs,
    inflation,
    effectiveN,
    slopeSe: (residualSd / Math.sqrt(sxx)) * Math.sqrt(inflation),
    df: Math.max(1, Math.floor(effectiveN - 2)),
  };
}

/** Valore atteso della retta in `x`. */
export const fitValue = (fit: LinearFit, x: number): number => fit.intercept + fit.slope * x;

/** Errore standard del valore atteso (la tendenza) in `x`. */
export function fitMeanSe(fit: LinearFit, x: number): number {
  const lever = 1 / fit.n + ((x - fit.xMean) * (x - fit.xMean)) / fit.sxx;
  return fit.residualSd * Math.sqrt(fit.inflation * lever);
}

/** Errore standard di una singola lettura futura in `x`: tendenza più oscillazione quotidiana. */
export function fitPredictionSe(fit: LinearFit, x: number): number {
  const lever = 1 / fit.n + ((x - fit.xMean) * (x - fit.xMean)) / fit.sxx;
  return fit.residualSd * Math.sqrt(1 + fit.inflation * lever);
}

export interface WelchResult {
  nA: number;
  nB: number;
  meanA: number;
  meanB: number;
  sdA: number;
  sdB: number;
  /** meanA - meanB. */
  difference: number;
  se: number;
  df: number;
  t: number;
  p: number;
  low: number;
  high: number;
  /** Differenza standardizzata (d di Cohen con deviazione standard combinata), limitata a ±10. */
  standardized: number;
}

const MAX_STANDARDIZED = 10;

/** Confronto tra due medie con varianze diverse (Welch). `undefined` con meno di 2 valori per gruppo. */
export function welch(
  a: readonly number[],
  b: readonly number[],
  confidence = 0.95,
  /**
   * Numerosità efficace dei due gruppi (≤ n) quando i valori non sono indipendenti, per esempio
   * serie giornaliere autocorrelate: l'errore standard e i gradi di libertà usano questi valori.
   */
  effective?: { a: number; b: number },
): WelchResult | undefined {
  if (a.length < 2 || b.length < 2) return undefined;
  const effA = Math.min(a.length, Math.max(2, effective?.a ?? a.length));
  const effB = Math.min(b.length, Math.max(2, effective?.b ?? b.length));
  const meanA = mean(a);
  const meanB = mean(b);
  const varA = sampleVariance(a);
  const varB = sampleVariance(b);
  const vA = varA / effA;
  const vB = varB / effB;
  const difference = meanA - meanB;
  const se = Math.sqrt(vA + vB);
  const dfRaw =
    se === 0 ? effA + effB - 2 : (vA + vB) ** 2 / (vA ** 2 / (effA - 1) + vB ** 2 / (effB - 1));
  const df = Math.max(1, Math.floor(dfRaw));
  let t = 0;
  let p = 1;
  let low = difference;
  let high = difference;
  if (se > 0) {
    t = difference / se;
    p = twoSidedP(t, df);
    const crit = tCritical(confidence, df);
    low = difference - crit * se;
    high = difference + crit * se;
  } else if (difference !== 0) {
    t = difference > 0 ? Infinity : -Infinity;
    p = 0;
  }
  const pooled = Math.sqrt(
    ((a.length - 1) * varA + (b.length - 1) * varB) / (a.length + b.length - 2),
  );
  const standardized =
    pooled > 0
      ? Math.max(-MAX_STANDARDIZED, Math.min(MAX_STANDARDIZED, difference / pooled))
      : difference === 0
        ? 0
        : Math.sign(difference) * MAX_STANDARDIZED;
  return {
    nA: a.length,
    nB: b.length,
    meanA,
    meanB,
    sdA: Math.sqrt(varA),
    sdB: Math.sqrt(varB),
    difference,
    se,
    df,
    t,
    p,
    low,
    high,
    standardized,
  };
}

/**
 * Correzione di Holm per confronti multipli (controlla la probabilità di almeno un falso positivo
 * su tutta la famiglia di confronti). Restituisce i valori p corretti nell'ordine di ingresso.
 */
export function holmAdjust(pValues: readonly number[]): number[] {
  const m = pValues.length;
  const order = pValues.map((p, i) => ({ p, i })).sort((x, y) => x.p - y.p || x.i - y.i);
  const adjusted = new Array<number>(m).fill(1);
  let running = 0;
  order.forEach((item, rank) => {
    running = Math.max(running, Math.min(1, (m - rank) * item.p));
    adjusted[item.i] = running;
  });
  return adjusted;
}

/** Seme numerico stabile da un testo (FNV-1a a 32 bit): lo stesso confronto usa sempre lo stesso seme. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Generatore pseudo-casuale deterministico (mulberry32). */
export function seededGenerator(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function welchStatistic(sumA: number, sumSqA: number, nA: number, sumB: number, sumSqB: number, nB: number): number {
  const mA = sumA / nA;
  const mB = sumB / nB;
  const vA = Math.max(0, (sumSqA - nA * mA * mA) / (nA - 1));
  const vB = Math.max(0, (sumSqB - nB * mB * mB) / (nB - 1));
  const se = Math.sqrt(vA / nA + vB / nB);
  if (se < 1e-12) return Math.abs(mA - mB) < 1e-12 ? 0 : Infinity;
  return Math.abs(mA - mB) / se;
}

export interface PermutationResult {
  /** Valore p = (eccedenze + 1) / (permutazioni + 1); assente se il conteggio si è fermato prima. */
  p?: number;
  exceedances: number;
  permutations: number;
  /** Ci si è fermati perché le eccedenze avevano già superato `maxExceedances`. */
  stoppedEarly: boolean;
}

/**
 * Prova di permutazione sulla statistica t di Welch (in valore assoluto): si rimescolano le
 * etichette "con/senza" tra i giorni con l'esito e si conta quante volte la statistica uguaglia o
 * supera quella osservata. È esatta se i giorni sono scambiabili e non assume alcuna forma della
 * distribuzione, quindi vale anche per punteggi discreti da 1 a 5 e gruppi piccoli. Il seme è fisso:
 * stesso confronto, stesso risultato.
 */
export function permutationTest(
  a: readonly number[],
  b: readonly number[],
  permutations: number,
  maxExceedances: number,
  seed: number,
): PermutationResult {
  const nA = a.length;
  const nB = b.length;
  const pool = Float64Array.from([...a, ...b]);
  const n = pool.length;
  let total = 0;
  let totalSq = 0;
  let obsA = 0;
  let obsSqA = 0;
  for (let i = 0; i < n; i++) {
    total += pool[i];
    totalSq += pool[i] * pool[i];
    if (i < nA) {
      obsA += pool[i];
      obsSqA += pool[i] * pool[i];
    }
  }
  const observed = welchStatistic(obsA, obsSqA, nA, total - obsA, totalSq - obsSqA, nB);
  const random = seededGenerator(seed);
  let exceedances = 0;
  for (let k = 0; k < permutations; k++) {
    let sumA = 0;
    let sumSqA = 0;
    for (let i = 0; i < nA; i++) {
      const j = i + Math.floor(random() * (n - i));
      const tmp = pool[i];
      pool[i] = pool[j];
      pool[j] = tmp;
      sumA += pool[i];
      sumSqA += pool[i] * pool[i];
    }
    const t = welchStatistic(sumA, sumSqA, nA, total - sumA, totalSq - sumSqA, nB);
    if (t >= observed - 1e-9) {
      exceedances++;
      if (exceedances > maxExceedances) {
        return { exceedances, permutations: k + 1, stoppedEarly: true };
      }
    }
  }
  return { p: (exceedances + 1) / (permutations + 1), exceedances, permutations, stoppedEarly: false };
}
