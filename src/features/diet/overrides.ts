// «Come conto questa voce», corretto dall'utente: gruppo e lavorazione per codice a barre (`b:`) o per nome
// normalizzato (`n:`). È l'interpretazione di un nome, come `foodOverrides`: sta nelle impostazioni, esce nella copia
// delle impostazioni, non passa da un telefono all'altro con la sincronizzazione. Si scrive rileggendo prima il valore.
import { DIET_GROUPS, PROCESSING_LEVELS, type ClassOverride, type ClassOverrides } from "@/core/diet";
import { getSetting, removeSetting, setSetting } from "@/data";

export const CLASS_OVERRIDES_KEY = "quality.classOverrides";

const KEY_RE = /^[bn]:./;
const MAX_KEY_LENGTH = 200;

export const isOverrideKey = (key: unknown): key is string =>
  typeof key === "string" && key.length <= MAX_KEY_LENGTH && KEY_RE.test(key);

export function isClassOverride(v: unknown): v is ClassOverride {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  for (const k of Object.keys(o)) if (k !== "group" && k !== "processing") return false;
  if (o.group === undefined && o.processing === undefined) return false;
  if (o.group !== undefined && !(DIET_GROUPS as readonly unknown[]).includes(o.group)) return false;
  if (o.processing !== undefined && !(PROCESSING_LEVELS as readonly unknown[]).includes(o.processing)) return false;
  return true;
}

export function isClassOverrides(v: unknown): v is ClassOverrides {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  return Object.entries(v).every(([k, o]) => isOverrideKey(k) && isClassOverride(o));
}

const NONE: ClassOverrides = Object.freeze({});

/** Le sole correzioni valide di un valore letto: una voce rovinata non toglie le altre. */
export function normalizeClassOverrides(raw: unknown): ClassOverrides {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return NONE;
  if (isClassOverrides(raw)) return raw;
  const out: Record<string, ClassOverride> = {};
  for (const [k, o] of Object.entries(raw)) if (isOverrideKey(k) && isClassOverride(o)) out[k] = o;
  return out;
}

/** Le correzioni con quella chiave cambiata (`undefined`: «Torna alla stima», la chiave se ne va). Non modifica `current`. */
export function withClassOverride(current: ClassOverrides, key: string, value: ClassOverride | undefined): ClassOverrides {
  const out: Record<string, ClassOverride> = { ...current };
  const clean: ClassOverride | undefined =
    value === undefined
      ? undefined
      : { ...(value.group !== undefined ? { group: value.group } : {}), ...(value.processing !== undefined ? { processing: value.processing } : {}) };
  if (clean === undefined || !isClassOverride(clean)) delete out[key];
  else out[key] = clean;
  return out;
}

async function readOverrides(): Promise<ClassOverrides> {
  return normalizeClassOverrides(await getSetting<unknown>(CLASS_OVERRIDES_KEY));
}

async function write(next: ClassOverrides): Promise<void> {
  if (Object.keys(next).length === 0) await removeSetting(CLASS_OVERRIDES_KEY);
  else await setSetting(CLASS_OVERRIDES_KEY, next);
}

/**
 * Scrive una correzione (o la toglie con `undefined`). Rilegge l'impostazione prima di scrivere, così una correzione
 * fatta nel frattempo altrove non si perde. «Annulla» rimette solo questa chiave com'era, rileggendo di nuovo.
 */
export async function saveClassOverride(key: string, value: ClassOverride | undefined): Promise<{ undo(): Promise<void> }> {
  if (!isOverrideKey(key)) throw new Error("invalid_override_key");
  if (value !== undefined && !isClassOverride(value)) throw new Error("invalid_override");
  const current = await readOverrides();
  const previous = Object.hasOwn(current, key) ? current[key] : undefined;
  await write(withClassOverride(current, key, value));
  return {
    undo: async () => write(withClassOverride(await readOverrides(), key, previous)),
  };
}
