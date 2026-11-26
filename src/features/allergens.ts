"use client";

// Allergeni ed esclusioni: l'unica lettura per tutta l'app e l'unica scrittura (eventi `allergenDeclaration`).
// La lettura unisce gli eventi con i due posti di prima (impostazione del ricettario di questo telefono e ultima
// struttura del piano): per tutta questa versione nessuna voce dichiarata prima va persa. Se un posto non si legge,
// lo stato lo dice (`complete: false`) e le schermate scrivono «Controllo incompleto».
import { useCallback, useMemo } from "react";
import {
  cleanVoiceText,
  declaredTexts,
  deriveDeclarations,
  foldVoice,
  planDeclarationChanges,
  type DeclarationChange,
  type DeclarationList,
  type DeclarationOrigin,
  type DeclarationRefusal,
  type DeclaredState,
  type LegacyDeclarations,
} from "@/core/allergens";
import type { AnyEvent } from "@/core/events";
import { appendEvents, getAllEvents, getDeviceId, getSetting, setSetting, useEventLog, useSetting } from "@/data";
import { AUTOMATIC_NOTE } from "./migrations";
import { declarationsView, isRecord, legacyOf, readPrefsDeclarations } from "./declarationsRead";
import { useNotice } from "./notice";
import { RECIPE_PREFS_KEY } from "./recipes/prefs";

export type { DeclaredState, DeclaredVoice, DeclarationList } from "@/core/allergens";
export { declarationsView, legacyOf, readPrefsDeclarations };

/** Dove si cambiano allergeni ed esclusioni. */
export const DIET_HREF = "/app/impostazioni/alimentazione";

/** La frase quando un posto delle dichiarazioni non si legge: il controllo gira con ciò che si legge, e lo dice. */
export const INCOMPLETE_DECLARATIONS = "Controllo incompleto: non riesco a leggere tutti gli allergeni che hai indicato. Controllali in Alimentazione.";

/** La stessa cosa detta dentro Alimentazione. */
export const INCOMPLETE_DECLARATIONS_HERE =
  "Controllo incompleto: una parte degli allergeni e degli alimenti esclusi che avevi scritto prima non si legge. Quelli qui sotto contano: se ne manca qualcuno, aggiungilo.";

/** Allergeni ed esclusioni dichiarati. `state` è `undefined` finché il registro non è letto. */
export function useDietDeclarations(): { state: DeclaredState | undefined; ready: boolean; error?: unknown } {
  const log = useEventLog();
  const prefs = useSetting<unknown>(RECIPE_PREFS_KEY);
  const prefsFailed = prefs.error !== undefined;
  const state = useMemo(
    () => (log.data && !prefs.loading ? deriveDeclarations(log.data, legacyOf(log.data, prefs.data, prefsFailed)) : undefined),
    [log.data, prefs.loading, prefs.data, prefsFailed],
  );
  return { state, ready: state !== undefined, ...(log.error !== undefined ? { error: log.error } : {}) };
}

async function readLegacy(events: readonly unknown[]): Promise<LegacyDeclarations> {
  try {
    return legacyOf(events, await getSetting<unknown>(RECIPE_PREFS_KEY));
  } catch {
    return legacyOf(events, undefined, true);
  }
}

/** La stessa lettura, dall'archivio: per chi deve rileggere prima di scrivere. */
export async function readDietDeclarations(): Promise<DeclaredState> {
  const events = await getAllEvents();
  return deriveDeclarations(events, await readLegacy(events));
}

/**
 * Allergeni ed esclusioni da portare avanti in una struttura del piano nuova (i telefoni non aggiornati li leggono lì).
 * `undefined` se l'ultima struttura non si legge: una struttura nuova la nasconderebbe, e con lei le sue voci.
 */
export async function declaredForStructure(): Promise<{ allergens: string[]; excludedFoods: string[] } | undefined> {
  const events = await getAllEvents();
  const legacy = await readLegacy(events);
  if (legacy.planStructure === "unreadable") return undefined;
  return declaredTexts(deriveDeclarations(events, legacy));
}

/** I soli testi, per i controlli. */
export function declaredLists(state: Pick<DeclaredState, "allergens" | "excludedFoods">): { allergens: string[]; excludedFoods: string[] } {
  return declaredTexts(state);
}

/** «latte, funghi» per le righe di riepilogo; vuoto se non c'è niente. */
export function declaredSummary(state: Pick<DeclaredState, "allergens" | "excludedFoods">): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [...state.allergens, ...state.excludedFoods]) {
    const key = foldVoice(v.text);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v.text);
  }
  return out.join(", ");
}

const REFUSALS: Record<DeclarationRefusal, string> = {
  empty: "",
  too_long: "Scrivi un nome più corto.",
  invalid_text: "Il testo ha caratteri che non riesco a salvare: riscrivilo.",
  duplicate: "C'è già.",
  missing: "Questa voce non c'è più.",
  too_many: "Hai già 40 voci: togline una prima di aggiungerne altre.",
  plan_unabsorbable: "Non riesco a toglierla: viene dal piano, dove c'è una voce troppo lunga da riportare qui.",
  invalid: "Non sono riuscito a salvare. Riprova.",
};

const ADDED_TO: Record<DeclarationList, string> = { allergens: "Aggiunto agli allergeni", excludedFoods: "Aggiunto agli alimenti esclusi" };
const REMOVED_FROM: Record<DeclarationList, string> = { allergens: "Tolto dagli allergeni", excludedFoods: "Tolto dagli alimenti esclusi" };

/** La chiave con cui la lettura riconosce una voce del ricettario: lo stesso testo ripulito e normalizzato. */
const prefsKey = (text: string): string => foldVoice(cleanVoiceText(text));

/**
 * L'impostazione del ricettario senza le voci indicate, riconosciute come le riconosce la lettura (spazi, caratteri di
 * controllo, maiuscole, accenti); il resto resta com'è. `dropped`: i testi grezzi tolti, per rimetterli.
 */
export function prefsWithout(
  raw: Record<string, unknown>,
  removals: Record<DeclarationList, readonly string[]>,
): { next: Record<string, unknown>; dropped: Record<DeclarationList, string[]> } {
  const next: Record<string, unknown> = { ...raw };
  const dropped: Record<DeclarationList, string[]> = { allergens: [], excludedFoods: [] };
  for (const list of ["allergens", "excludedFoods"] as const) {
    const keys = new Set(removals[list].map(prefsKey));
    const current = raw[list];
    // un testo solo al posto dell'elenco la lettura lo conta come una voce: si toglie allo stesso modo
    if (typeof current === "string") {
      if (keys.has(prefsKey(current))) {
        dropped[list].push(current);
        next[list] = [];
      }
      continue;
    }
    if (!Array.isArray(current)) continue;
    next[list] = current.filter((x) => {
      const hit = typeof x === "string" && keys.has(prefsKey(x));
      if (hit) dropped[list].push(x as string);
      return !hit;
    });
  }
  return { next, dropped };
}

/** Toglie dall'impostazione del ricettario le voci indicate, lasciando intatto il resto. Restituisce come rimetterle. */
async function dropFromPrefs(removals: Record<DeclarationList, string[]>): Promise<(() => Promise<void>) | undefined> {
  if (removals.allergens.length + removals.excludedFoods.length === 0) return undefined;
  const raw = await getSetting<unknown>(RECIPE_PREFS_KEY);
  if (!isRecord(raw)) return undefined;
  const { next, dropped } = prefsWithout(raw, removals);
  await setSetting(RECIPE_PREFS_KEY, next);
  // rimette le voci tolte nell'impostazione com'è adesso (attrezzatura e il resto possono essere cambiati nel frattempo)
  return async () => {
    const now = await getSetting<unknown>(RECIPE_PREFS_KEY);
    const base: Record<string, unknown> = isRecord(now) ? { ...now } : {};
    for (const list of ["allergens", "excludedFoods"] as const) {
      const cur = Array.isArray(base[list]) ? (base[list] as unknown[]) : [];
      const have = new Set(cur.flatMap((x) => (typeof x === "string" ? [prefsKey(x)] : [])));
      base[list] = [...cur, ...dropped[list].filter((x) => !have.has(prefsKey(x)))];
    }
    await setSetting(RECIPE_PREFS_KEY, base);
  };
}

export interface DeclarationWrite {
  ok: boolean;
  /** Il testo da mostrare accanto al campo; vuoto se non c'è niente da dire. */
  message: string;
  events?: AnyEvent[];
  restorePrefs?: () => Promise<void>;
}

/**
 * Un'azione dell'utente su allergeni ed esclusioni: rilegge registro e posti di prima, scrive tutti gli eventi in una
 * sola volta, poi toglie dall'impostazione del ricettario le voci tolte. Non mostra avvisi: lo fa chi chiama.
 */
export async function writeDeclarationChanges(
  changes: readonly DeclarationChange[],
  origin?: DeclarationOrigin,
): Promise<DeclarationWrite> {
  try {
    const events = await getAllEvents();
    const legacy = await readLegacy(events);
    const plan = planDeclarationChanges(events, legacy, changes, {
      deviceId: await getDeviceId(),
      automaticNote: AUTOMATIC_NOTE,
      ...(origin ? { origin } : {}),
    });
    if (!plan.ok) return { ok: false, message: REFUSALS[plan.reason] };
    // le voci solo del ricettario diventano prima aggiunte, scritte a parte: l'azione dell'utente le ritira, e annullarla
    // (dall'avviso o da «Ultime azioni») le fa tornare
    if (plan.prelude.length > 0) {
      const adopted = await appendEvents(plan.prelude);
      if (adopted.rejected.length > 0) return { ok: false, message: REFUSALS.invalid };
    }
    if (plan.events.length > 0) {
      const written = await appendEvents(plan.events);
      if (written.added === 0 || written.rejected.length > 0) return { ok: false, message: REFUSALS.invalid };
    }
    let restorePrefs: (() => Promise<void>) | undefined;
    try {
      restorePrefs = await dropFromPrefs(plan.prefsRemovals);
    } catch {
      // gli eventi sono scritti: la voce rimasta nel ricettario di questo telefono continua a contare (direzione severa)
    }
    return { ok: true, message: "", ...(plan.events.length > 0 ? { events: plan.events } : {}), ...(restorePrefs ? { restorePrefs } : {}) };
  } catch {
    return { ok: false, message: "Non sono riuscito a salvare sul telefono. Riprova." };
  }
}

export interface DeclarationActions {
  /** Aggiunge una voce. Restituisce il testo da mostrare accanto al campo, o `null` se è andata. */
  add: (list: DeclarationList, text: string) => Promise<string | null>;
  /** Toglie una voce, subito: l'avviso con «Annulla» è la rete. */
  remove: (list: DeclarationList, text: string) => Promise<string | null>;
}

export function useDeclarationActions(): DeclarationActions {
  const notice = useNotice();
  const add = useCallback<DeclarationActions["add"]>(
    async (list, text) => {
      const result = await writeDeclarationChanges([{ action: "add", list, text }]);
      if (!result.ok) return result.message;
      notice.show({ message: `${ADDED_TO[list]}: ${text.replace(/\s+/g, " ").trim()}.`, undo: result.events });
      return null;
    },
    [notice],
  );
  const remove = useCallback<DeclarationActions["remove"]>(
    async (list, text) => {
      const result = await writeDeclarationChanges([{ action: "remove", list, text }]);
      if (!result.ok) return result.message;
      notice.show({
        message: `${REMOVED_FROM[list]}: ${text}.`,
        undo: result.events,
        ...(result.restorePrefs ? { onUndo: result.restorePrefs } : {}),
      });
      return null;
    },
    [notice],
  );
  return useMemo(() => ({ add, remove }), [add, remove]);
}
