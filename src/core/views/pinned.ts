// Le viste fissate in Oggi: solo la descrizione, mai i dati. Si rileggono sempre con il validatore, perché ciò che sta
// nell'archivio può essere stato scritto da una versione diversa, o a mano.
import type { ViewSpec } from "./spec";
import { plainText, validateView } from "./validate";

export const PINNED_SETTING_KEY = "assistant.pinned";
export const MAX_PINNED = 12;
export const PINNED_NAME_CHARS = 60;
export const QUESTION_CHARS = 300;

/** Il titolo con cui si conserva una vista fissata: quello scritto dall'AI non si tiene, perché resterebbe senza attribuzione. */
export const PINNED_TITLE = "Vista fissata";

export interface PinnedView {
  id: string;
  /** Il nome che l'utente vede; si può cambiare. Parte dalla sua domanda (troncata), mai dal titolo dell'AI. */
  name: string;
  /** La domanda con cui è nata, se c'era. */
  question?: string;
  /** Istante ISO UTC. */
  pinnedAt: string;
  spec: ViewSpec;
}

export interface PinnedStore {
  version: 1;
  views: PinnedView[];
}

/** Un nome scelto dall'utente: testo semplice, non vuoto, accorciato. */
export function cleanName(text: string): string | undefined {
  const clean = plainText(text).slice(0, PINNED_NAME_CHARS).trim();
  return clean === "" ? undefined : clean;
}

/** La domanda dell'utente, come testo semplice e accorciato. */
export function cleanQuestion(text: string): string | undefined {
  const clean = plainText(text).slice(0, QUESTION_CHARS).trim();
  return clean === "" ? undefined : clean;
}

/**
 * La vista senza le note dell'assistente: sono testo libero non verificato e, accanto a numeri che si aggiornano,
 * resterebbero a dire cose che non sono più vere. Senza altri blocchi, nulla da fissare.
 */
export function withoutNotes(spec: ViewSpec): ViewSpec | undefined {
  const blocks = spec.blocks.filter((b) => b.type !== "text");
  return blocks.length > 0 ? { ...spec, blocks } : undefined;
}

const defaultName = (question: string | undefined): string => (question !== undefined ? cleanName(question) : undefined) ?? PINNED_TITLE;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Le viste fissate lette dall'archivio. Scarta ciò che non è valido; non lancia. */
export function normalizePinned(raw: unknown): PinnedView[] {
  try {
    const list = isObj(raw) && Array.isArray(raw.views) ? raw.views : [];
    const seen = new Set<string>();
    const out: PinnedView[] = [];
    for (const item of list) {
      if (out.length >= MAX_PINNED) break;
      if (!isObj(item) || typeof item.id !== "string" || item.id === "" || item.id.length > 80 || seen.has(item.id)) continue;
      const checked = validateView(item.spec);
      const noted = checked.ok ? withoutNotes(checked.view) : undefined;
      if (!noted || !checked.ok) continue;
      const spec: ViewSpec = { ...noted, title: PINNED_TITLE };
      // un nome uguale al titolo scritto dall'AI (salvato da una versione precedente) non è una scelta dell'utente
      const chosen = typeof item.name === "string" ? cleanName(item.name) : undefined;
      const name = chosen !== undefined && chosen !== checked.view.title ? chosen : undefined;
      const question = typeof item.question === "string" ? cleanQuestion(item.question) : undefined;
      seen.add(item.id);
      out.push({
        id: item.id,
        name: name ?? defaultName(question),
        ...(question !== undefined ? { question } : {}),
        pinnedAt: typeof item.pinnedAt === "string" ? item.pinnedAt : "",
        spec,
      });
    }
    return out;
  } catch {
    return [];
  }
}

export const toStore = (views: readonly PinnedView[]): PinnedStore => ({ version: 1, views: [...views] });

export type PinResult = { ok: true; views: PinnedView[] } | { ok: false; reason: "full" | "already_pinned" | "invalid" };

export function pinView(
  views: readonly PinnedView[],
  input: { id: string; spec: ViewSpec; question?: string; now: string; name?: string },
): PinResult {
  const checked = validateView(input.spec);
  const noted = checked.ok ? withoutNotes(checked.view) : undefined;
  if (!noted) return { ok: false, reason: "invalid" };
  const spec: ViewSpec = { ...noted, title: PINNED_TITLE };
  if (views.length >= MAX_PINNED) return { ok: false, reason: "full" };
  const same = JSON.stringify(spec);
  if (views.some((v) => JSON.stringify(v.spec) === same)) return { ok: false, reason: "already_pinned" };
  const question = input.question !== undefined ? cleanQuestion(input.question) : undefined;
  const entry: PinnedView = {
    id: input.id,
    name: (input.name !== undefined ? cleanName(input.name) : undefined) ?? defaultName(question),
    ...(question !== undefined ? { question } : {}),
    pinnedAt: input.now,
    spec,
  };
  return { ok: true, views: [...views, entry] };
}

/** Rinomina; un nome vuoto non cambia nulla. */
export function renamePinned(views: readonly PinnedView[], id: string, name: string): PinnedView[] {
  const clean = cleanName(name);
  if (clean === undefined) return [...views];
  return views.map((v) => (v.id === id ? { ...v, name: clean } : v));
}

export const removePinned = (views: readonly PinnedView[], id: string): PinnedView[] => views.filter((v) => v.id !== id);
