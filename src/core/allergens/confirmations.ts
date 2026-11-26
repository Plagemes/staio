// Eventi delle conferme dell'utente sugli ingredienti «non verificabili» e stato derivato.
//
// Due azioni, append-only come il resto del registro:
//  - `confirm`: «ho letto l'etichetta, per me va bene» per UN ingrediente (la sua chiave, vedi `confirmationKey`), con gli
//    allergeni e le esclusioni dichiarati in quel momento;
//  - `revoke`: ritira la conferma di quella chiave.
// La revoca CITA gli id delle conferme che ritira (tutte quelle valide per la chiave note a chi revoca): una conferma
// citata da una revoca non vale più, qualunque sia l'orologio dei due dispositivi. In più una revoca ritira le conferme
// della stessa chiave che non conosceva, se hanno recordedAt precedente o uguale al suo (l'ultima volontà era revocare),
// anche quando cita solo id inesistenti. Per questo chi conferma scrive recordedAt almeno un millisecondo dopo l'ultima
// revoca nota (`notBefore`): una riconferma voluta vale anche con l'orologio indietro. A parità di istante la revoca
// vince. Una conferma nuova, dopo la revoca, vale di nuovo. Il risultato dipende solo dall'insieme degli eventi, non
// dall'ordine né dai duplicati (unione idempotente e commutativa). Un `void` annulla un evento di conferma o di revoca
// come per ogni altra famiglia: annullare una revoca rimette le conferme che ritirava.
//
// La conferma è una dichiarazione dell'utente: l'app non ha verificato niente e non rileva tracce né contaminazioni.
// Si può dare solo a un ingrediente che il motore giudica `uncertain`: per un `contains` si rifiuta.

import {
  SCHEMA_VERSION,
  generateId,
  validateEnvelope,
  type Certainty,
  type EventBase,
  type IdGenerator,
  type Source,
  type ValidationError,
} from "../ledger";
import { readOwnedLog } from "../plan/log";
import { confirmationKey, foldedExclusions, type ConfirmationMap, type ConfirmationRecord } from "./confirmationKey";
import { allergenLabels, assessItem, itemMatchesExclusion, type ItemAssessment, type ItemSubject } from "./engine";
import { foldText } from "./normalize";

export const CONFIRMATION_EVENT_TYPES = ["allergenConfirmation"] as const;

export const CONFIRMATION_LIMITS = {
  maxKeyLength: 2000,
  maxTextLength: 500,
  maxListLength: 100,
} as const;

export interface AllergenConfirmationEvent extends EventBase {
  type: "allergenConfirmation";
  action: "confirm" | "revoke";
  /** La chiave dell'ingrediente (`confirmationKey`). */
  key: string;
  /** Il nome dell'ingrediente, per mostrarlo nell'elenco. */
  ingredient: string;
  /** Con `confirm`: gli allergeni dichiarati allora, come etichette del motore. Almeno uno. */
  allergens?: string[];
  /** Con `confirm`: le esclusioni dichiarate allora, normalizzate. */
  excludedFoods?: string[];
  /** Con `revoke`: gli id delle conferme ritirate. Assente nelle revoche scritte prima: allora conta l'orologio. */
  revokes?: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function isConfirmationEvent(e: unknown): e is AllergenConfirmationEvent {
  try {
    return isRecord(e) && e.type === "allergenConfirmation";
  } catch {
    return false;
  }
}

/** Errori dell'evento (lista vuota se valido): busta comune più campi propri. Non lancia mai. */
export function validateConfirmationEvent(event: unknown): ValidationError[] {
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
    if (event.type !== undefined && event.type !== "allergenConfirmation") add("type", "invalid_value");
    const text = (key: string, max: number): void => {
      const v = event[key];
      if (v === undefined) add(key, "required");
      else if (typeof v !== "string" || v.trim() === "") add(key, "invalid_type");
      else if (v.length > max) add(key, "invalid_value");
    };
    text("key", CONFIRMATION_LIMITS.maxKeyLength);
    text("ingredient", CONFIRMATION_LIMITS.maxTextLength);
    const action = event.action;
    if (action === undefined) add("action", "required");
    else if (action !== "confirm" && action !== "revoke") add("action", "invalid_value");

    const list = (key: "allergens" | "excludedFoods", required: boolean): void => {
      const v = event[key];
      if (v === undefined) {
        if (required) add(key, "required");
        return;
      }
      if (!Array.isArray(v)) return add(key, "invalid_type");
      if (v.length > CONFIRMATION_LIMITS.maxListLength) add(key, "invalid_value");
      if (required && v.length === 0) add(key, "required");
      v.forEach((x: unknown, i) => {
        if (typeof x !== "string" || x.trim() === "") add(`${key}.${i}`, "invalid_type");
        else if (x.length > CONFIRMATION_LIMITS.maxTextLength) add(`${key}.${i}`, "invalid_value");
      });
    };
    if (action === "revoke") {
      if (event.allergens !== undefined) add("allergens", "not_allowed");
      if (event.excludedFoods !== undefined) add("excludedFoods", "not_allowed");
      const rv = event.revokes;
      if (rv !== undefined) {
        if (!Array.isArray(rv)) add("revokes", "invalid_type");
        else {
          if (rv.length === 0) add("revokes", "required");
          if (rv.length > CONFIRMATION_LIMITS.maxListLength) add("revokes", "invalid_value");
          rv.forEach((x: unknown, i) => {
            if (typeof x !== "string" || x.trim() === "") add(`revokes.${i}`, "invalid_type");
          });
        }
      }
    } else {
      if (event.revokes !== undefined) add("revokes", "not_allowed");
      list("allergens", action === "confirm");
      list("excludedFoods", false);
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

export interface ConfirmationEventOptions {
  deviceId: string;
  idGenerator?: IdGenerator;
  /** Istante corrente ISO UTC. Default: orologio di sistema. */
  now?: () => string;
  /** Quando il fatto è avvenuto. Default: adesso. */
  at?: string;
  /** Default `measured`: è una scelta dell'utente, non una misura. */
  certainty?: Certainty;
  /** Default `manual`. */
  source?: Source;
  note?: string;
  /**
   * Con `confirm`: l'istante dell'ultima revoca nota per questa chiave (`ConfirmationsState.revokedAt`). La conferma scrive
   * `recordedAt` almeno un millisecondo dopo, così una riconferma voluta non è ritirata da una revoca con l'orologio avanti.
   */
  notBefore?: string;
}

function build(fields: Record<string, unknown>, options: ConfirmationEventOptions): AllergenConfirmationEvent | undefined {
  const now = (options.now ?? (() => new Date().toISOString()))();
  const floor = options.notBefore === undefined ? Number.NaN : Date.parse(options.notBefore) + 1;
  const recordedAt = floor > Date.parse(now) ? new Date(floor).toISOString() : now;
  const event: Record<string, unknown> = {
    id: (options.idGenerator ?? generateId)(),
    type: "allergenConfirmation",
    at: options.at ?? now,
    recordedAt,
    deviceId: options.deviceId,
    schemaVersion: SCHEMA_VERSION,
    certainty: options.certainty ?? "measured",
    source: options.source ?? "manual",
    ...fields,
  };
  if (options.note !== undefined) event.note = options.note;
  return validateConfirmationEvent(event).length === 0 ? (event as unknown as AllergenConfirmationEvent) : undefined;
}

/** Che cosa dichiara l'utente adesso: allergeni ed esclusioni. */
export interface DeclaredCriteria {
  allergens: readonly string[];
  excludedFoods: readonly string[];
}

export type ConfirmationRefusal =
  /** Niente allergeni dichiarati: non c'è nulla da confermare. */
  | "nothing_declared"
  /** Il motore trova l'allergene o l'alimento escluso (o lo dichiara l'etichetta): la conferma non si dà. */
  | "contains"
  /** Il motore non ha dubbi su questo ingrediente: la conferma non serve. */
  | "not_uncertain"
  /** Il nome non ha lettere né cifre. */
  | "no_name"
  /** Il testo ha parole con caratteri di alfabeti diversi («lаtte» con la «а» cirillica): va riscritto. */
  | "mixed_script"
  | "invalid";

/**
 * Se l'ingrediente si può confermare: solo se, senza conferme, il motore dà `uncertain`. Con `contains` (anche solo per un
 * allergene, o per un'esclusione) o con `clear` no. È la stessa regola che il motore applica quando legge le conferme.
 */
export function confirmability(
  item: ItemSubject,
  criteria: DeclaredCriteria,
): { ok: true; assessment: ItemAssessment } | { ok: false; reason: Exclude<ConfirmationRefusal, "invalid"> } {
  const allergens = criteria.allergens.filter((a) => foldText(a) !== "");
  if (allergens.length === 0) return { ok: false, reason: "nothing_declared" };
  if (confirmationKey(item) === "") return { ok: false, reason: "no_name" };
  if (criteria.excludedFoods.some((e) => foldText(e) !== "" && itemMatchesExclusion(item, e) !== undefined)) {
    return { ok: false, reason: "contains" };
  }
  const assessment = assessItem(item, allergens);
  if (assessment.verdict === "contains") return { ok: false, reason: "contains" };
  if (assessment.findings.some((f) => f.reason === "mixed_script")) return { ok: false, reason: "mixed_script" };
  if (assessment.verdict === "clear") return { ok: false, reason: "not_uncertain" };
  return { ok: true, assessment };
}

/**
 * L'evento di conferma per un ingrediente, o il motivo per cui non si può dare. Un ingrediente che il motore giudica
 * `contains` non si conferma, mai.
 */
export function confirmIngredient(
  item: ItemSubject,
  criteria: DeclaredCriteria,
  options: ConfirmationEventOptions,
): { ok: true; event: AllergenConfirmationEvent } | { ok: false; reason: ConfirmationRefusal } {
  const can = confirmability(item, criteria);
  if (!can.ok) return can;
  const event = build(
    {
      action: "confirm",
      key: confirmationKey(item),
      ingredient: item.name.trim(),
      allergens: allergenLabels(criteria.allergens),
      excludedFoods: foldedExclusions(criteria.excludedFoods),
    },
    options,
  );
  return event ? { ok: true, event } : { ok: false, reason: "invalid" };
}

/**
 * L'evento che ritira la conferma di una chiave. `revokes` sono gli id delle conferme che ritira (`ConfirmationRecord.eventIds`):
 * con quelli la revoca vale qualunque sia l'orologio dei dispositivi. Senza, conta l'orologio (formato precedente).
 * `undefined` se i dati non sono validi.
 */
export function revokeConfirmation(
  key: string,
  ingredient: string,
  options: ConfirmationEventOptions,
  revokes?: readonly string[],
): AllergenConfirmationEvent | undefined {
  return build({ action: "revoke", key, ingredient, ...(revokes !== undefined ? { revokes: [...revokes] } : {}) }, options);
}

/** Dopo il ripristino di una copia: quante conferme di allergeni contiene e dove guardarle. `undefined` se zero. */
export function restoredConfirmationsNotice(count: number): string | undefined {
  if (!(count > 0)) return undefined;
  return count === 1
    ? "Questa copia contiene 1 conferma di allergeni data in precedenza: controllala in Impostazioni › Alimentazione."
    : `Questa copia contiene ${count} conferme di allergeni date in precedenza: controllale in Impostazioni › Alimentazione.`;
}

// ---------------------------------------------------------------------------------------------
// Derivazione

export type ConfirmationAnomalyCode = "invalid_event" | "id_conflict" | "void_target_missing" | "void_cycle";

export interface ConfirmationAnomaly {
  code: ConfirmationAnomalyCode;
  eventId?: string;
  targetEventId?: string;
  errors?: ValidationError[];
}

export interface ConfirmationsState {
  /** Le conferme attive, dalla più recente; a pari istante per chiave. */
  active: ConfirmationRecord[];
  /** Le stesse per chiave: è ciò che il motore legge. */
  byKey: ConfirmationMap;
  /** Chiavi senza conferme valide e con almeno una revoca. */
  revokedKeys: string[];
  /** Per chiave, l'istante dell'ultima revoca valida: chi riconferma lo passa come `notBefore`. */
  revokedAt: ReadonlyMap<string, string>;
  anomalies: ConfirmationAnomaly[];
  voidedEventIds: string[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Ordine crescente: istante, poi la revoca dopo la conferma (a parità vince la revoca), poi id. */
function ascending(a: AllergenConfirmationEvent, b: AllergenConfirmationEvent): number {
  const ta = Date.parse(a.recordedAt);
  const tb = Date.parse(b.recordedAt);
  if (ta !== tb) return ta < tb ? -1 : 1;
  if (a.action !== b.action) return a.action === "revoke" ? 1 : -1;
  return cmp(a.id, b.id);
}

/**
 * Le conferme attive dal registro intero. Non dipende dall'ordine né dai duplicati. Gli eventi di altre famiglie sono
 * ignorati; i `void` valgono. Non lancia mai.
 */
export function deriveConfirmations(events: Iterable<unknown>): ConfirmationsState {
  const log = readOwnedLog<AllergenConfirmationEvent & { id: string }>(events, {
    isOwn: isConfirmationEvent as (e: unknown) => e is AllergenConfirmationEvent & { id: string },
    validate: validateConfirmationEvent,
  });
  const anomalies: ConfirmationAnomaly[] = [];
  for (const i of log.invalid) {
    anomalies.push({ code: "invalid_event", ...(i.eventId !== undefined ? { eventId: i.eventId } : {}), errors: i.errors });
  }
  for (const id of log.conflictIds) anomalies.push({ code: "id_conflict", eventId: id });
  for (const f of log.voidFindings) anomalies.push({ code: f.code, eventId: f.eventId, targetEventId: f.targetEventId });

  const groups = new Map<string, AllergenConfirmationEvent[]>();
  for (const e of log.live) {
    const list = groups.get(e.key);
    if (list) list.push(e);
    else groups.set(e.key, [e]);
  }
  const active: ConfirmationRecord[] = [];
  const revokedKeys: string[] = [];
  const revokedAt = new Map<string, string>();
  for (const [key, list] of groups) {
    const revokes = list.filter((e) => e.action === "revoke");
    // le conferme citate da una revoca valida non contano più, qualunque sia l'orologio
    const cited = new Set<string>();
    for (const e of revokes) for (const id of e.revokes ?? []) cited.add(id);
    // una revoca ritira anche le conferme che non conosceva, se non sono più recenti di lei (a parità vince la revoca)
    let lastRevoke = Number.NEGATIVE_INFINITY;
    for (const e of revokes) {
      const t = Date.parse(e.recordedAt);
      if (t > lastRevoke) {
        lastRevoke = t;
        revokedAt.set(key, e.recordedAt);
      }
    }
    const alive = list
      .filter((e) => e.action === "confirm" && !cited.has(e.id) && Date.parse(e.recordedAt) > lastRevoke)
      .sort(ascending);
    const last = alive[alive.length - 1];
    if (last === undefined) {
      if (revokes.length > 0) revokedKeys.push(key);
      continue;
    }
    active.push({
      key,
      ingredient: last.ingredient,
      allergens: [...new Set(last.allergens ?? [])].sort(),
      excludedFoods: [...new Set(last.excludedFoods ?? [])].sort(),
      confirmedAt: last.recordedAt,
      eventId: last.id,
      eventIds: alive.map((e) => e.id).sort(),
      deviceId: last.deviceId,
    });
  }
  active.sort((a, b) => cmp(b.confirmedAt, a.confirmedAt) || cmp(a.key, b.key));
  revokedKeys.sort(cmp);
  const key = (a: ConfirmationAnomaly): string => `${a.code}|${a.eventId ?? ""}|${a.targetEventId ?? ""}`;
  anomalies.sort((a, b) => cmp(key(a), key(b)));
  return {
    active,
    byKey: new Map(active.map((r) => [r.key, r])),
    revokedKeys,
    revokedAt,
    anomalies,
    voidedEventIds: [...log.voided].sort(cmp),
  };
}
