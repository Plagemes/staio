// Modalità cucina: un passo alla volta, timer per i passi con durata, ingredienti del passo. Logica pura:
// il tempo arriva sempre come parametro (millisecondi), mai dall'orologio.
import { nameTokens } from "@/core/nutrition";
import type { RecipeIngredient, RecipeStep } from "@/core/recipes";

export interface Timer {
  /** Durata totale, in millisecondi. */
  totalMs: number;
  /** Se in corso, l'istante (ms) in cui finisce. */
  endsAt: number | null;
  /** Quanto resta quando è fermo. */
  remainingMs: number;
}

export interface CookState {
  index: number;
  stepCount: number;
  /** Per indice di passo. */
  timers: Record<number, Timer>;
}

export function startCook(stepCount: number): CookState {
  return { index: 0, stepCount, timers: {} };
}

export const isFirst = (s: CookState): boolean => s.index <= 0;
export const isLast = (s: CookState): boolean => s.index >= s.stepCount - 1;

/** Si sposta di `delta` passi senza uscire dall'intervallo. I timer in corso restano in corso. */
export function move(s: CookState, delta: number): CookState {
  const index = Math.min(Math.max(s.index + delta, 0), Math.max(s.stepCount - 1, 0));
  return index === s.index ? s : { ...s, index };
}

export function goTo(s: CookState, index: number): CookState {
  return move(s, index - s.index);
}

export function remaining(t: Timer, nowMs: number): number {
  return t.endsAt === null ? t.remainingMs : Math.max(0, t.endsAt - nowMs);
}

export const isRunning = (t: Timer): boolean => t.endsAt !== null;
export const isFinished = (t: Timer, nowMs: number): boolean => remaining(t, nowMs) <= 0;

/** Avvia il timer del passo (o lo riprende se era fermo). Senza durata non fa nulla. */
export function startTimer(s: CookState, index: number, durationMinutes: number | undefined, nowMs: number): CookState {
  const existing = s.timers[index];
  if (existing && isRunning(existing)) return s;
  if (existing && existing.remainingMs > 0) {
    return { ...s, timers: { ...s.timers, [index]: { ...existing, endsAt: nowMs + existing.remainingMs } } };
  }
  if (durationMinutes === undefined || !(durationMinutes > 0)) return s;
  const totalMs = Math.round(durationMinutes * 60_000);
  return { ...s, timers: { ...s.timers, [index]: { totalMs, endsAt: nowMs + totalMs, remainingMs: totalMs } } };
}

export function pauseTimer(s: CookState, index: number, nowMs: number): CookState {
  const t = s.timers[index];
  if (!t || !isRunning(t)) return s;
  return { ...s, timers: { ...s.timers, [index]: { ...t, endsAt: null, remainingMs: remaining(t, nowMs) } } };
}

export function resetTimer(s: CookState, index: number): CookState {
  if (!s.timers[index]) return s;
  const rest = { ...s.timers };
  delete rest[index];
  return { ...s, timers: rest };
}

/** Passi con un timer finito, che l'utente non ha ancora guardato. */
export function finishedSteps(s: CookState, nowMs: number): number[] {
  return Object.entries(s.timers)
    .filter(([, t]) => isRunning(t) && isFinished(t, nowMs))
    .map(([i]) => Number(i))
    .sort((a, b) => a - b);
}

/** "7:05" o "1:02:30". */
export function formatClock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/**
 * Ingredienti nominati da un passo. Un ingrediente è nominato se tutte le sue parole compaiono nel passo, oppure,
 * per i nomi di più parole, se compare la prima (in italiano è il nome: «passata di pomodoro», «pomodori pelati»).
 * È un aiuto a colpo d'occhio: può sbagliare per eccesso, mai nasconde un ingrediente.
 */
export function ingredientsForStep(step: Pick<RecipeStep, "text">, ingredients: readonly RecipeIngredient[]): number[] {
  const words = new Set(nameTokens(step.text));
  const out: number[] = [];
  ingredients.forEach((ing, i) => {
    const tokens = nameTokens(ing.name);
    if (tokens.length === 0) return;
    if (tokens.every((t) => words.has(t)) || (tokens.length >= 2 && words.has(tokens[0] as string))) out.push(i);
  });
  return out;
}
