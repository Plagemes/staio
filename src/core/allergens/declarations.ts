// Che cosa l'utente dichiara di non mangiare: allergeni e alimenti esclusi, in un solo archivio fatto di eventi.
//
// Un insieme con aggiunte e tolte esplicite (non «vale l'ultimo»): un'aggiunta (`add`) vale finché nessuna tolta
// (`remove`) non annullata la cita in `revokes`. Due telefoni che aggiungono insieme si sommano; una tolta ritira solo le
// aggiunte che conosceva. Il risultato dipende solo dall'insieme degli eventi, non dall'ordine, dai duplicati né
// dall'orologio dei dispositivi. Un `void` annulla un'aggiunta o una tolta come per ogni altra famiglia.
//
// Per tutta questa versione si leggono ancora i due posti di prima, in unione: l'impostazione locale del ricettario
// (`recipePrefs`) e l'ultima struttura del piano (`planStructure`). Una struttura conta finché nessun evento vivo la cita
// in `absorbs` («le sue voci sono già state prese»): una struttura scritta dopo da un telefono non aggiornato ha un id
// nuovo e conta di nuovo. Se un posto non si legge, le voci degli altri valgono e lo stato dice che è incompleto: mai
// «nessuna dichiarazione» al posto di «non riesco a leggere».
//
// Il testo dell'utente resta com'è scritto (spazi a parte): il confronto senza maiuscole né accenti serve solo a
// riconoscere i doppioni. Le due liste restano separate: una voce presente in entrambe conta in entrambe.

import {
  SCHEMA_VERSION,
  generateId,
  validateEnvelope,
  type EventBase,
  type IdGenerator,
  type ValidationError,
} from "../ledger";
import { newerThan, readOwnedLog } from "../plan/log";
import type { PlanStructureEvent } from "../plan/types";
import { validatePlanEvent } from "../plan/validate";

export const DECLARATION_EVENT_TYPES = ["allergenDeclaration"] as const;

export const DECLARATION_LISTS = ["allergens", "excludedFoods"] as const;
export type DeclarationList = (typeof DECLARATION_LISTS)[number];

export const DECLARATION_ORIGINS = ["recipePrefs", "planStructure", "onboarding"] as const;
export type DeclarationOrigin = (typeof DECLARATION_ORIGINS)[number];

export const DECLARATION_LIMITS = {
  maxTextLength: 80,
  /**
   * Per le voci scritte prima nel ricettario o nel piano (senza limite di lunghezza) e per le tolte: una voce di prima
   * deve poter passare negli eventi e poter essere tolta.
   */
  maxLegacyTextLength: 10_000,
  maxIds: 100,
  /** Voci attive per lista oltre le quali non se ne aggiungono altre. */
  maxActive: 40,
} as const;

export interface AllergenDeclarationEvent extends EventBase {
  type: "allergenDeclaration";
  action: "add" | "remove";
  list: DeclarationList;
  /** Il testo dell'utente, com'è scritto (spazi singoli, senza spazi in testa e in coda). */
  text: string;
  /** Solo con `remove`: gli id delle aggiunte che toglie. */
  revokes?: string[];
  /** Id di strutture del piano le cui voci questa scrittura ha già preso. */
  absorbs?: string[];
  /** Solo con `add`: le aggiunte scritte dalla migrazione o dall'introduzione. */
  origin?: DeclarationOrigin;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const hasControl = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x20 || (c >= 0x7f && c <= 0x9f)) return true;
  }
  return false;
};

/** Spazi singoli, niente spazi in testa e in coda, caratteri di controllo come spazi: l'unica cosa che si cambia del testo. */
export function cleanVoiceText(text: string): string {
  let out = text;
  if (hasControl(text)) {
    out = "";
    for (const ch of text) out += hasControl(ch) ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Minuscolo, senza accenti né spazi doppi: solo per riconoscere i doppioni. */
export function foldVoice(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Perché un testo (già ripulito) non si può scrivere come voce. `undefined` se va bene. */
export function voiceTextProblem(
  text: string,
  maxLength: number = DECLARATION_LIMITS.maxTextLength,
): "empty" | "too_long" | "invalid_text" | undefined {
  if (text === "" || foldVoice(text) === "") return "empty";
  if (text.length > maxLength) return "too_long";
  if (hasControl(text)) return "invalid_text";
  return undefined;
}

export function isDeclarationEvent(e: unknown): e is AllergenDeclarationEvent {
  try {
    return isRecord(e) && e.type === "allergenDeclaration";
  } catch {
    return false;
  }
}

/** Errori dell'evento (lista vuota se valido): busta comune più campi propri. Non lancia mai. */
export function validateDeclarationEvent(event: unknown): ValidationError[] {
  let errors: ValidationError[];
  try {
    errors = [...validateEnvelope(event)];
  } catch {
    return [{ path: "", code: "unserializable" }];
  }
  if (!isRecord(event)) return errors;
  const add = (path: string, code: ValidationError["code"]): void => {
    errors.push({ path, code });
  };
  try {
    if (event.type !== undefined && event.type !== "allergenDeclaration") add("type", "invalid_value");
    const action = event.action;
    if (action === undefined) add("action", "required");
    else if (action !== "add" && action !== "remove") add("action", "invalid_value");
    const list = event.list;
    if (list === undefined) add("list", "required");
    else if (!(DECLARATION_LISTS as readonly unknown[]).includes(list)) add("list", "invalid_value");
    const text = event.text;
    if (text === undefined) add("text", "required");
    else if (typeof text !== "string") add("text", "invalid_type");
    else if (voiceTextProblem(cleanVoiceText(text)) === "empty") add("text", "invalid_type");
    else {
      const legacy = action === "remove" || event.origin === "recipePrefs" || event.origin === "planStructure";
      const max = legacy ? DECLARATION_LIMITS.maxLegacyTextLength : DECLARATION_LIMITS.maxTextLength;
      if (text.length > max || hasControl(text)) add("text", "invalid_value");
    }

    const ids = (key: "revokes" | "absorbs"): void => {
      const v = event[key];
      if (v === undefined) return;
      if (!Array.isArray(v)) return add(key, "invalid_type");
      if (v.length > DECLARATION_LIMITS.maxIds) add(key, "invalid_value");
      v.forEach((x: unknown, i) => {
        if (typeof x !== "string" || x.trim() === "") add(`${key}.${i}`, "invalid_type");
      });
    };
    ids("absorbs");
    if (action === "remove") {
      ids("revokes");
      if (event.origin !== undefined) add("origin", "not_allowed");
    } else {
      if (event.revokes !== undefined) add("revokes", "not_allowed");
      const origin = event.origin;
      if (origin !== undefined && !(DECLARATION_ORIGINS as readonly unknown[]).includes(origin)) add("origin", "invalid_value");
    }
  } catch {
    return [...errors, { path: "", code: "unserializable" }];
  }
  const seen = new Set<string>();
  return errors.filter((e) => {
    const k = `${e.path}\u0000${e.code}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export interface DeclarationEventOptions {
  deviceId: string;
  idGenerator?: IdGenerator;
  /** Istante corrente ISO UTC. Default: orologio di sistema. */
  now?: () => string;
  note?: string;
  /** Id delle strutture del piano di cui questa scrittura prende le voci. */
  absorbs?: readonly string[];
}

function build(fields: Record<string, unknown>, options: DeclarationEventOptions): AllergenDeclarationEvent | undefined {
  const now = (options.now ?? (() => new Date().toISOString()))();
  const event: Record<string, unknown> = {
    id: (options.idGenerator ?? generateId)(),
    type: "allergenDeclaration",
    at: now,
    recordedAt: now,
    deviceId: options.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: "measured",
    source: "manual",
    ...fields,
  };
  if (options.absorbs !== undefined && options.absorbs.length > 0) event.absorbs = [...options.absorbs];
  if (options.note !== undefined) event.note = options.note;
  return validateDeclarationEvent(event).length === 0 ? (event as unknown as AllergenDeclarationEvent) : undefined;
}

/** L'evento che aggiunge una voce. `undefined` se il testo non va (vuoto, troppo lungo, caratteri di controllo). */
export function declareVoice(
  list: DeclarationList,
  text: string,
  options: DeclarationEventOptions & { origin?: DeclarationOrigin },
): AllergenDeclarationEvent | undefined {
  return build({ action: "add", list, text: cleanVoiceText(text), ...(options.origin ? { origin: options.origin } : {}) }, options);
}

/** L'evento che toglie una voce: `revokes` sono gli id delle aggiunte vive di quella voce. */
export function removeVoice(
  list: DeclarationList,
  text: string,
  revokes: readonly string[],
  options: DeclarationEventOptions,
): AllergenDeclarationEvent | undefined {
  return build({ action: "remove", list, text: cleanVoiceText(text), ...(revokes.length > 0 ? { revokes: [...revokes] } : {}) }, options);
}

// ---------------------------------------------------------------------------------------------
// Lettura

export type DeclarationSource = "events" | "recipePrefs" | "planStructure";

export interface LegacyLists {
  allergens: readonly string[];
  excludedFoods: readonly string[];
  /** Una parte non si leggeva: le voci qui valgono, ma il controllo è incompleto. */
  partial?: boolean;
}

/** I due posti di prima, letti dal chiamante. `"unreadable"`: c'è qualcosa ma non si legge. */
export interface LegacyDeclarations {
  recipePrefs: LegacyLists | "unreadable" | undefined;
  /** L'ultima struttura del piano valida (`legacyPlanStructure`). */
  planStructure: (LegacyLists & { id: string }) | "unreadable" | undefined;
}

export interface DeclaredVoice {
  text: string;
  sources: DeclarationSource[];
  /** Gli id delle aggiunte vive di questa voce: chi la toglie li cita tutti. */
  addIds: string[];
}

export interface DeclaredState {
  allergens: DeclaredVoice[];
  excludedFoods: DeclaredVoice[];
  /** Falso se un posto non si legge: le voci lette valgono, ma il controllo è incompleto. */
  complete: boolean;
  /** `recordedAt` dell'ultima aggiunta o tolta valida. */
  changedAt?: string;
}

interface Analysis {
  state: DeclaredState;
  /** Per lista, chiave dei doppioni → voce. */
  maps: Record<DeclarationList, Map<string, DeclaredVoice>>;
  /** La struttura del piano che conta ancora (leggibile e non ancora presa da un evento vivo). */
  pendingPlan?: LegacyLists & { id: string };
}

function analyze(events: Iterable<unknown>, legacy: LegacyDeclarations): Analysis {
  const log = readOwnedLog<AllergenDeclarationEvent>(events, {
    isOwn: isDeclarationEvent,
    validate: validateDeclarationEvent,
  });
  const revoked = new Set<string>();
  const absorbed = new Set<string>();
  let changedAt: string | undefined;
  // una tolta ritira solo aggiunte della stessa lista e della stessa voce: un id che punta altrove non conta
  const voiceKey = (e: AllergenDeclarationEvent): string => `${e.list}\u0000${foldVoice(cleanVoiceText(e.text))}`;
  const addKeys = new Map<string, string>();
  for (const e of log.live) if (e.action === "add") addKeys.set(e.id, voiceKey(e));
  for (const e of log.live) {
    if (e.action === "remove") for (const id of e.revokes ?? []) if (addKeys.get(id) === voiceKey(e)) revoked.add(id);
    for (const id of e.absorbs ?? []) absorbed.add(id);
    const t = Date.parse(e.recordedAt);
    if (!Number.isNaN(t) && (changedAt === undefined || t > Date.parse(changedAt))) changedAt = e.recordedAt;
  }
  const maps: Analysis["maps"] = { allergens: new Map(), excludedFoods: new Map() };
  const put = (list: DeclarationList, raw: unknown, source: DeclarationSource, addId?: string): void => {
    if (typeof raw !== "string") return;
    const text = cleanVoiceText(raw);
    const key = foldVoice(text);
    if (key === "") return;
    const map = maps[list];
    let voice = map.get(key);
    if (!voice) {
      voice = { text, sources: [], addIds: [] };
      map.set(key, voice);
    }
    if (!voice.sources.includes(source)) voice.sources.push(source);
    if (addId !== undefined) voice.addIds.push(addId);
  };
  // `live` è in ordine canonico: il testo tenuto è quello dell'aggiunta più vecchia, qualunque sia l'ordine di arrivo
  for (const e of log.live) if (e.action === "add" && !revoked.has(e.id)) put(e.list, e.text, "events", e.id);
  const prefs = legacy.recipePrefs;
  if (prefs !== undefined && prefs !== "unreadable") {
    for (const list of DECLARATION_LISTS) for (const x of prefs[list]) put(list, x, "recipePrefs");
  }
  const plan = legacy.planStructure;
  const pendingPlan = plan !== undefined && plan !== "unreadable" && !absorbed.has(plan.id) ? plan : undefined;
  if (pendingPlan) for (const list of DECLARATION_LISTS) for (const x of pendingPlan[list]) put(list, x, "planStructure");
  for (const list of DECLARATION_LISTS) for (const v of maps[list].values()) v.addIds.sort();

  const state: DeclaredState = {
    allergens: [...maps.allergens.values()],
    excludedFoods: [...maps.excludedFoods.values()],
    complete:
      prefs !== "unreadable" &&
      plan !== "unreadable" &&
      prefs?.partial !== true &&
      plan?.partial !== true &&
      log.invalid.length === 0,
    ...(changedAt !== undefined ? { changedAt } : {}),
  };
  return { state, maps, ...(pendingPlan ? { pendingPlan } : {}) };
}

/**
 * Allergeni ed esclusioni dichiarati: eventi, più l'impostazione del ricettario, più l'ultima struttura del piano non
 * ancora presa. Non dipende dall'ordine né dai duplicati degli eventi. Non lancia mai.
 */
export function deriveDeclarations(events: Iterable<unknown>, legacy: LegacyDeclarations): DeclaredState {
  return analyze(events, legacy).state;
}

/** I soli testi, per i controlli. */
export function declaredTexts(state: Pick<DeclaredState, "allergens" | "excludedFoods">): { allergens: string[]; excludedFoods: string[] } {
  return { allergens: state.allergens.map((v) => v.text), excludedFoods: state.excludedFoods.map((v) => v.text) };
}

const isPlanStructure = (e: unknown): e is PlanStructureEvent => isRecord(e) && e.type === "planStructure";

/**
 * L'ultima struttura del piano dal registro, come la legge il piano (vale l'ultima valida per `recordedAt`, poi `id`).
 * Se una struttura più nuova non è valida, vale quella di prima ma con `partial`: il controllo è incompleto, e lo dice.
 * `"unreadable"` se non ce n'è nessuna valida e una non valida c'è.
 */
export function legacyPlanStructure(events: Iterable<unknown>): LegacyDeclarations["planStructure"] {
  const all = [...events];
  const log = readOwnedLog<PlanStructureEvent>(all, { isOwn: isPlanStructure, validate: validatePlanEvent });
  let best: PlanStructureEvent | undefined;
  for (const e of log.live) if (!best || newerThan(e, best)) best = e;
  const invalidIds = new Set(log.invalid.flatMap((i) => (i.eventId !== undefined ? [i.eventId] : [])));
  let partial = log.invalid.some((i) => i.eventId === undefined);
  for (const raw of invalidIds.size > 0 ? all : []) {
    if (!isPlanStructure(raw)) continue;
    const rec = raw as unknown as Record<string, unknown>;
    if (typeof rec.id !== "string" || !invalidIds.has(rec.id) || log.voided.has(rec.id)) continue;
    const t = typeof rec.recordedAt === "string" ? Date.parse(rec.recordedAt) : Number.NaN;
    const tb = best ? Date.parse(best.recordedAt) : Number.NaN;
    if (!best || Number.isNaN(t) || t > tb || (t === tb && rec.id > best.id)) partial = true;
  }
  if (!best) return partial ? "unreadable" : undefined;
  return {
    id: best.id,
    allergens: [...(best.allergens ?? [])],
    excludedFoods: [...(best.excludedFoods ?? [])],
    ...(partial ? { partial: true } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// Scrittura

export interface DeclarationChange {
  action: "add" | "remove";
  list: DeclarationList;
  text: string;
}

export type DeclarationRefusal =
  /** Niente da aggiungere. */
  | "empty"
  /** Più di 80 caratteri. */
  | "too_long"
  | "invalid_text"
  /** La voce c'è già. */
  | "duplicate"
  /** La voce non c'è (più). */
  | "missing"
  /** La lista ha già 40 voci. */
  | "too_many"
  /** La voce viene da una struttura del piano che non si riesce a trasformare in eventi. */
  | "plan_unabsorbable"
  | "invalid";

export type DeclarationPlan =
  | {
      ok: true;
      /**
       * Da scrivere prima, a parte, come scrittura automatica: le voci che stanno solo nel ricettario e che si tolgono
       * diventano aggiunte, così la tolta le ritira e «Annulla» (anche da «Ultime azioni») le fa tornare.
       */
      prelude: AllergenDeclarationEvent[];
      /** L'azione dell'utente. Vuota solo se l'unica cosa da fare è togliere dal ricettario una voce enorme. */
      events: AllergenDeclarationEvent[];
      /** Le voci da togliere anche dall'impostazione del ricettario di questo telefono, dopo la scrittura. */
      prefsRemovals: Record<DeclarationList, string[]>;
    }
  | { ok: false; reason: DeclarationRefusal };

const LEGACY_MAX = DECLARATION_LIMITS.maxLegacyTextLength;

const representable = (texts: readonly string[]): boolean =>
  texts.every((t) => voiceTextProblem(cleanVoiceText(t), LEGACY_MAX) === undefined || foldVoice(cleanVoiceText(t)) === "");

/**
 * Gli eventi di un'azione dell'utente (aggiunte e tolte), da scrivere in una sola volta. Si calcola sul registro e sui
 * posti di prima riletti adesso, mai sullo stato a schermo. Se la struttura del piano conta ancora, le sue voci non
 * ancora presenti diventano aggiunte nella stessa scrittura e la struttura si dichiara presa: così togliere una voce
 * del piano la toglie davvero. Le richieste che non cambiano niente (aggiungere ciò che c'è, togliere ciò che non c'è)
 * si saltano; se non resta niente, il motivo della prima.
 */
export function planDeclarationChanges(
  events: Iterable<unknown>,
  legacy: LegacyDeclarations,
  changes: readonly DeclarationChange[],
  options: DeclarationEventOptions & { origin?: DeclarationOrigin; automaticNote?: string },
): DeclarationPlan {
  const { maps, pendingPlan } = analyze(events, legacy);
  const planTaken = pendingPlan !== undefined && representable([...pendingPlan.allergens, ...pendingPlan.excludedFoods]);
  const adds: { list: DeclarationList; text: string; key: string }[] = [];
  const removes: { list: DeclarationList; voice: DeclaredVoice; key: string }[] = [];
  let firstRefusal: DeclarationRefusal | undefined;
  const refuse = (r: DeclarationRefusal): void => {
    firstRefusal ??= r;
  };
  for (const c of changes) {
    const text = cleanVoiceText(c.text);
    const key = foldVoice(text);
    if (c.action === "add") {
      const problem = voiceTextProblem(text);
      if (problem) {
        refuse(problem);
        continue;
      }
      const removing = removes.some((r) => r.list === c.list && r.key === key);
      if ((maps[c.list].has(key) && !removing) || adds.some((a) => a.list === c.list && a.key === key)) {
        refuse("duplicate");
        continue;
      }
      adds.push({ list: c.list, text, key });
    } else {
      const voice = maps[c.list].get(key);
      if (!voice || removes.some((r) => r.list === c.list && r.key === key)) {
        refuse("missing");
        continue;
      }
      // una struttura del piano con una voce che non entra negli eventi non si può prendere: le sue voci restano
      if (pendingPlan && !planTaken && voice.sources.includes("planStructure")) {
        refuse("plan_unabsorbable");
        continue;
      }
      removes.push({ list: c.list, voice, key });
    }
  }
  if (adds.length === 0 && removes.length === 0) return { ok: false, reason: firstRefusal ?? "invalid" };

  for (const list of DECLARATION_LISTS) {
    const before = maps[list].size;
    const after = before + adds.filter((a) => a.list === list).length - removes.filter((r) => r.list === list).length;
    if (after > DECLARATION_LIMITS.maxActive && after > before) return { ok: false, reason: "too_many" };
  }

  // la struttura del piano che conta ancora: le sue voci passano negli eventi, tranne quelle tolte adesso
  const planAdds: { list: DeclarationList; text: string }[] = [];
  const absorbs: string[] = pendingPlan && planTaken ? [pendingPlan.id] : [];
  if (pendingPlan && planTaken) {
    for (const list of DECLARATION_LISTS) {
      const seen = new Set<string>();
      for (const raw of pendingPlan[list]) {
        const text = cleanVoiceText(raw);
        const key = foldVoice(text);
        if (key === "" || seen.has(key)) continue;
        seen.add(key);
        if (maps[list].get(key)?.sources.includes("events")) continue;
        if (removes.some((r) => r.list === list && r.key === key)) continue;
        if (adds.some((a) => a.list === list && a.key === key)) continue;
        planAdds.push({ list, text });
      }
    }
  }

  const base: DeclarationEventOptions = {
    deviceId: options.deviceId,
    ...(options.idGenerator ? { idGenerator: options.idGenerator } : {}),
    ...(options.now ? { now: options.now } : {}),
  };
  const own: DeclarationEventOptions = { ...base, ...(options.note !== undefined ? { note: options.note } : {}) };
  const prelude: AllergenDeclarationEvent[] = [];
  const out: AllergenDeclarationEvent[] = [];
  // la struttura presa va sul primo evento dell'azione: annullare l'azione la fa tornare a contare
  const withAbsorbs = (): DeclarationEventOptions => (out.length === 0 && absorbs.length > 0 ? { ...own, absorbs } : own);
  for (const r of removes) {
    const ids = [...r.voice.addIds];
    if (ids.length === 0 && r.voice.sources.includes("recipePrefs")) {
      const adopted = declareVoice(r.list, r.voice.text, {
        ...base,
        ...(options.automaticNote !== undefined ? { note: options.automaticNote } : {}),
        origin: "recipePrefs",
      });
      if (adopted) {
        prelude.push(adopted);
        ids.push(adopted.id);
      }
    }
    // una voce enorme che sta solo nel ricettario: basta toglierla da lì
    if (ids.length === 0 && r.voice.sources.every((x) => x === "recipePrefs")) continue;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += DECLARATION_LIMITS.maxIds) chunks.push(ids.slice(i, i + DECLARATION_LIMITS.maxIds));
    if (chunks.length === 0) chunks.push([]);
    for (const chunk of chunks) {
      const e = removeVoice(r.list, r.voice.text, chunk, withAbsorbs());
      if (!e) return { ok: false, reason: "invalid" };
      out.push(e);
    }
  }
  for (const a of adds) {
    const e = declareVoice(a.list, a.text, { ...withAbsorbs(), ...(options.origin ? { origin: options.origin } : {}) });
    if (!e) return { ok: false, reason: "invalid" };
    out.push(e);
  }
  for (const p of planAdds) {
    const e = declareVoice(p.list, p.text, { ...withAbsorbs(), origin: "planStructure" });
    if (!e) return { ok: false, reason: "invalid" };
    out.push(e);
  }
  const prefsRemovals: Record<DeclarationList, string[]> = { allergens: [], excludedFoods: [] };
  for (const r of removes) if (r.voice.sources.includes("recipePrefs")) prefsRemovals[r.list].push(r.voice.text);
  return { ok: true, prelude, events: out, prefsRemovals };
}

/**
 * La migrazione dei posti di prima: un'aggiunta per ogni voce del ricettario e della struttura del piano che non è
 * già negli eventi, e la struttura dichiarata presa. Niente se un posto non si legge (nel dubbio non si scrive) o se
 * non c'è niente da portare: rifarla dà una lista vuota. Le voci che non si possono scrivere come eventi (troppo
 * lunghe) restano dove sono, e la struttura che le contiene non si dichiara presa: si continua a leggerla.
 */
export function adoptLegacyDeclarations(
  events: Iterable<unknown>,
  legacy: LegacyDeclarations,
  options: DeclarationEventOptions,
): AllergenDeclarationEvent[] {
  if (legacy.recipePrefs === "unreadable" || legacy.planStructure === "unreadable") return [];
  const { maps, pendingPlan } = analyze(events, legacy);
  const wanted: { list: DeclarationList; text: string; origin: DeclarationOrigin }[] = [];
  const taken: Record<DeclarationList, Set<string>> = { allergens: new Set(), excludedFoods: new Set() };
  const want = (list: DeclarationList, raw: string, origin: DeclarationOrigin): void => {
    const text = cleanVoiceText(raw);
    const key = foldVoice(text);
    if (key === "" || taken[list].has(key) || voiceTextProblem(text, LEGACY_MAX) !== undefined) return;
    if (maps[list].get(key)?.sources.includes("events")) return;
    taken[list].add(key);
    wanted.push({ list, text, origin });
  };
  const prefs = legacy.recipePrefs;
  if (prefs) for (const list of DECLARATION_LISTS) for (const x of prefs[list]) want(list, x, "recipePrefs");
  if (pendingPlan) for (const list of DECLARATION_LISTS) for (const x of pendingPlan[list]) want(list, x, "planStructure");
  if (wanted.length === 0) return [];
  const absorbs = pendingPlan && representable([...pendingPlan.allergens, ...pendingPlan.excludedFoods]) ? [pendingPlan.id] : [];
  const out: AllergenDeclarationEvent[] = [];
  for (const w of wanted) {
    const e = declareVoice(w.list, w.text, { ...options, absorbs: out.length === 0 ? absorbs : [], origin: w.origin });
    if (!e) return [];
    out.push(e);
  }
  return out;
}
