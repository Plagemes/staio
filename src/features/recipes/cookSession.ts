"use client";

// La cottura in corso, tenuta nelle impostazioni di questo telefono: passo e timer si ritrovano dopo una telefonata,
// una ricarica o la chiusura dell'app. Non è un evento del registro e non è una «memoria»: scade da sola.
// Chi la usa dal di fuori (Oggi) legge solo `useCookSession`, `isSessionAlive`, `cookResumeHref` e `cookProgressText`.
import { removeSetting } from "@/data";
import { getSetting, setSetting, useSetting } from "../localSettings";
import { useMemo } from "react";
import { useNow } from "../useNow";
import { formatClock, isRunning, remaining, type CookState, type Timer } from "./cookMode";
import { SUBSTITUTION_PARAM } from "./substitutes";

export const COOK_SESSION_KEY = "recipes.cookSession";
/** Dall'ultimo cambio di passo o di timer: dopo, la sessione non esiste più (le impostazioni si copiano su un altro telefono). */
export const COOK_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

export interface CookSession {
  v: 1;
  recipeId: string;
  servings: number;
  /** Il parametro `sost` così com'è: `indice:nome`, uno per riga. */
  subs: string;
  state: CookState;
  /** Impronta delle liste dichiarate quando è iniziata (vedi `declaredKeyOf`). */
  declaredKey: string;
  /** Il telefono su cui si cucina: su un altro telefono il passaggio «Prima di iniziare» non è stato visto. */
  deviceId: string;
  startedAt: string;
  updatedAt: string;
}

const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Le liste dichiarate come un solo testo: gli accenti, le maiuscole, l'ordine e i doppioni non contano. */
export function declaredKeyOf(lists: { allergens: readonly string[]; excludedFoods: readonly string[] }): string {
  const part = (items: readonly string[]) =>
    [...new Set(items.map(fold).filter((x) => x !== ""))]
      .sort()
      .join(",");
  return `${part(lists.allergens)}|${part(lists.excludedFoods)}`;
}

/** Un'impronta breve e non leggibile (cyrb53): nella sessione non resta in chiaro la lista degli allergeni. Non è un'impronta di sicurezza. */
function hashText(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** Ciò che il controllo ha detto per questa cottura, come l'ha visto la persona in «Prima di iniziare». */
export interface OutcomeInput {
  declared: { allergens: readonly string[]; excludedFoods: readonly string[] };
  incomplete: boolean;
  verdict: string;
  contains: readonly string[];
  uncertain: readonly string[];
  /** Le conferme date (chiave e testo, con la data). */
  confirmed: readonly { key: string; text: string }[];
  /** Per ingrediente: indice, esito e testo accanto al nome. */
  flags: readonly { index: number; verdict: string; text: string }[];
  /** Gli ingredienti come si cucinano (con le sostituzioni) e il numero dei passi: se la ricetta cambia, l'impronta cambia. */
  ingredients: readonly string[];
  steps: number;
}

/**
 * L'impronta dell'esito che la persona ha visto: liste dichiarate, conferme, verdetto, ingredienti segnalati e ricetta.
 * Se cambia una qualsiasi di queste cose il passaggio «Prima di iniziare» si rimostra. Si salva come hash.
 */
export function cookFingerprint(input: OutcomeInput): string {
  const text = JSON.stringify([
    declaredKeyOf(input.declared),
    input.incomplete,
    input.verdict,
    [...input.contains].sort(),
    [...input.uncertain].sort(),
    [...input.confirmed].map((c) => [c.key, c.text]).sort(),
    [...input.flags].sort((a, b) => a.index - b.index).map((f) => [f.index, f.verdict, f.text]),
    input.ingredients,
    input.steps,
  ]);
  return `h1:${hashText(text)}`;
}

/**
 * L'esito non è ancora quello definitivo: il controllo non è letto, oppure ci sono sostituzioni scelte e i sostituti o la
 * dispensa non sono ancora letti (gli ingredienti sarebbero quelli scritti, non quelli che si cucinano). Finché è così non
 * c'è impronta e niente si confronta né si salva.
 */
export function isOutcomePending(args: { safetyLoading: boolean; chosenCount: number; substitutesLoading: boolean; pantryRead: boolean }): boolean {
  return args.safetyLoading || (args.chosenCount > 0 && (args.substitutesLoading || !args.pantryRead));
}

export interface AckedOutcome {
  /** L'impronta che la persona ha visto. */
  key: string;
  /** Visto adesso, in questa apertura: con il controllo incompleto non basta quello di una volta. */
  byUser: boolean;
}

/**
 * Il passaggio «Prima di iniziare» non serve solo se non c'è niente di dichiarato, oppure se la persona ha visto proprio
 * questo esito (stessa impronta) e, con il controllo incompleto, l'ha visto in questa apertura.
 */
export function isPassageSeen(args: { nothingDeclared: boolean; currentKey: string | null; incomplete: boolean; ack: AckedOutcome | null }): boolean {
  if (args.nothingDeclared) return true;
  const { ack, currentKey } = args;
  return ack !== null && currentKey !== null && ack.key === currentKey && (!args.incomplete || ack.byUser);
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min: number, max: number): v is number => typeof v === "number" && Number.isInteger(v) && v >= min && v <= max;
const isInstant = (v: unknown): v is string => typeof v === "string" && Number.isFinite(Date.parse(v));

function readTimer(raw: unknown): Timer | undefined {
  if (!isRecord(raw)) return undefined;
  const { totalMs, endsAt, remainingMs } = raw;
  if (typeof totalMs !== "number" || !Number.isFinite(totalMs) || totalMs <= 0) return undefined;
  if (typeof remainingMs !== "number" || !Number.isFinite(remainingMs) || remainingMs < 0) return undefined;
  if (endsAt !== null && (typeof endsAt !== "number" || !Number.isFinite(endsAt))) return undefined;
  return { totalMs, endsAt, remainingMs };
}

function readState(raw: unknown): CookState | undefined {
  if (!isRecord(raw)) return undefined;
  const { index, stepCount, timers } = raw;
  if (!isInt(stepCount, 1, 300) || !isInt(index, 0, 299) || index >= stepCount || !isRecord(timers)) return undefined;
  const out: Record<number, Timer> = {};
  for (const [key, value] of Object.entries(timers)) {
    const i = Number(key);
    const timer = readTimer(value);
    if (!Number.isInteger(i) || i < 0 || i >= stepCount || !timer) return undefined;
    out[i] = timer;
  }
  return { index, stepCount, timers: out };
}

export function isSessionAlive(s: Pick<CookSession, "updatedAt">, nowMs: number): boolean {
  const at = Date.parse(s.updatedAt);
  return Number.isFinite(at) && nowMs - at <= COOK_SESSION_MAX_AGE_MS;
}

/** La sessione salvata, se ha una forma valida e non è scaduta; altrimenti `undefined`. Non lancia mai. */
export function readCookSession(raw: unknown, nowMs: number): CookSession | undefined {
  if (!isRecord(raw) || raw.v !== 1) return undefined;
  const { recipeId, servings, subs, declaredKey, deviceId, startedAt, updatedAt } = raw;
  if (typeof recipeId !== "string" || recipeId === "") return undefined;
  if (typeof servings !== "number" || !Number.isFinite(servings) || servings <= 0 || servings > 1000) return undefined;
  if (typeof subs !== "string" || typeof declaredKey !== "string" || typeof deviceId !== "string") return undefined;
  if (!isInstant(startedAt) || !isInstant(updatedAt)) return undefined;
  const state = readState(raw.state);
  if (!state) return undefined;
  const session: CookSession = { v: 1, recipeId, servings, subs, state, declaredKey, deviceId, startedAt, updatedAt };
  return isSessionAlive(session, nowMs) ? session : undefined;
}

/** `/app/ricette/cucina?id=&porzioni=&sost=`: dove si riprende. */
export function cookResumeHref(s: Pick<CookSession, "recipeId" | "servings" | "subs">): string {
  const params = new URLSearchParams({ id: s.recipeId, porzioni: String(s.servings) });
  for (const sub of s.subs.split("\n")) if (sub !== "") params.append(SUBSTITUTION_PARAM, sub);
  return `/app/ricette/cucina?${params.toString()}`;
}

/** Il tempo che manca al timer acceso che finisce prima, se c'è. */
function nextTimer(state: CookState, nowMs: number): number | undefined {
  const running = Object.values(state.timers).filter(isRunning);
  if (running.length === 0) return undefined;
  return Math.min(...running.map((t) => remaining(t, nowMs)));
}

/** «passo 3 di 7»; con un timer acceso «passo 3 di 7 · timer 4:12», o «timer finito». */
export function cookProgressText(s: Pick<CookSession, "state">, nowMs: number = Date.now()): string {
  const base = `passo ${s.state.index + 1} di ${s.state.stepCount}`;
  const left = nextTimer(s.state, nowMs);
  if (left === undefined) return base;
  return left <= 0 ? `${base} · timer finito` : `${base} · timer ${formatClock(left)}`;
}

/** Per Oggi: la sessione viva, se c'è. `ready` è falso finché non è letta. */
export function useCookSession(): { session: CookSession | undefined; ready: boolean } {
  const stored = useSetting<unknown>(COOK_SESSION_KEY, (v): v is unknown => typeof v !== "symbol", undefined);
  const now = useNow();
  const session = useMemo(() => (now === null ? undefined : readCookSession(stored.value, Date.parse(now))), [stored.value, now]);
  return { session, ready: stored.ready && now !== null };
}

/** Una lettura sola, per chi parte con la sessione e poi la scrive lui. */
export async function loadCookSession(nowMs: number = Date.now()): Promise<CookSession | undefined> {
  try {
    return readCookSession(await getSetting<unknown>(COOK_SESSION_KEY), nowMs);
  } catch {
    return undefined;
  }
}

export async function saveCookSession(session: CookSession): Promise<void> {
  try {
    await setSetting(COOK_SESSION_KEY, session);
  } catch {
    // la cottura va avanti anche se il telefono non la ricorda
  }
}

export async function clearCookSession(): Promise<void> {
  try {
    await removeSetting(COOK_SESSION_KEY);
  } catch {
    // niente da togliere
  }
}

/** Toglie la sessione solo se è di questa ricetta: la cottura di un'altra ricetta non finisce perché se ne registra una. */
export async function clearCookSessionOf(recipeId: string): Promise<void> {
  const stored = await loadCookSession();
  if (stored && stored.recipeId === recipeId) await clearCookSession();
}

/** Rimette com'era una sessione appena tolta («Annulla» di «Cucina chiusa.»). */
export async function restoreCookSession(session: CookSession): Promise<void> {
  await saveCookSession(session);
}
