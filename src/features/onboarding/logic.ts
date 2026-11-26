// Percorso d'ingresso dopo la scelta dello stile: quando proporlo e che cosa si ricorda. Logica pura.
import { foldVoice, type DeclarationChange, type DeclarationList } from "@/core/allergens";
import { isStyleChoicePath } from "../settings/firstRunStyle";

/** Per dove vuole cominciare chi ha finito il percorso; guida la scheda del primo passo in Oggi. */
export type StartChoice = "pantry" | "meal" | "look";

/** «new»: mai fatto; «redo»: richiesto da Impostazioni, vale anche con dei dati; «done»: fatto o saltato. */
export type OnboardingPhase = "new" | "redo" | "done";

export interface OnboardingMemory {
  phase: OnboardingPhase;
  start?: StartChoice;
}

/**
 * Dove si ricorda: nella copia locale del telefono (localStorage), come la scelta dello stile, e non nella tabella delle
 * impostazioni. La copia delle impostazioni si porta su un telefono nuovo, e lì «fatto» farebbe saltare un'introduzione
 * che il nuovo telefono non ha mai mostrato. Le sincronizzazioni e le copie di sicurezza non lo toccano.
 */
export const ONBOARDING_STORAGE_KEY = "onboarding";

const isStart = (v: unknown): v is StartChoice => v === "pantry" || v === "meal" || v === "look";

/** Legge la copia locale con prudenza: qualunque forma inattesa vale «mai fatto». */
export function parseOnboarding(raw: string | null): OnboardingMemory {
  if (raw === null) return { phase: "new" };
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== "object" || v === null) return { phase: "new" };
    const o = v as Record<string, unknown>;
    const phase: OnboardingPhase = o.phase === "done" || o.phase === "redo" ? o.phase : "new";
    return isStart(o.start) ? { phase, start: o.start } : { phase };
  } catch {
    return { phase: "new" };
  }
}

export const serializeOnboarding = (memory: OnboardingMemory): string => JSON.stringify(memory);

export interface OnboardingInput {
  pathname: string;
  /** Copia locale: undefined finché non è stata letta (server, primo disegno). */
  raw: string | null | undefined;
  storageOk: boolean;
  /** Che cosa c'è già sul telefono; `loading` finché non è stato letto tutto. */
  existing: { loading: boolean; error: unknown; hasData: boolean };
}

/**
 * "wait": non si sa ancora; "offer": proporre il percorso; "skip": aprire l'app; "skip-mark": aprire l'app e
 * segnare «fatto» (chi ha già dati, per esempio da una copia ripristinata o dalla sincronizzazione, non lo vedrà mai).
 * Ogni dubbio porta a "skip": il percorso si può sempre rifare da Impostazioni, Persona.
 */
export function decideOnboarding(input: OnboardingInput): "wait" | "offer" | "skip" | "skip-mark" {
  if (!isStyleChoicePath(input.pathname)) return "skip";
  if (input.raw === undefined) return "wait";
  if (!input.storageOk) return "skip";
  const memory = parseOnboarding(input.raw);
  if (memory.phase === "done") return "skip";
  if (memory.phase === "redo") return "offer";
  if (input.existing.loading) return "wait";
  if (input.existing.error) return "skip";
  return input.existing.hasData ? "skip-mark" : "offer";
}

/** Applica solo le differenze fatte in una schermata (aggiunte e rimozioni) sopra l'elenco riletto: mai una sostituzione in blocco. */
export function applyDiff(fresh: readonly string[], before: readonly string[], after: readonly string[]): string[] {
  const added = after.filter((x) => !before.includes(x));
  const removed = before.filter((x) => !after.includes(x));
  return [...fresh.filter((x) => !removed.includes(x)), ...added.filter((x) => !fresh.includes(x))];
}

/**
 * Le stesse differenze, come aggiunte e tolte di allergeni ed esclusioni: si aggiunge ciò che è stato scelto qui e non
 * c'è già, si toglie ciò che è stato tolto qui e c'è ancora. Il confronto non guarda maiuscole né accenti.
 */
export function declarationDiff(
  list: DeclarationList,
  fresh: readonly string[],
  before: readonly string[],
  after: readonly string[],
): DeclarationChange[] {
  const keys = (xs: readonly string[]) => new Set(xs.map(foldVoice));
  const [freshKeys, beforeKeys, afterKeys] = [keys(fresh), keys(before), keys(after)];
  const out: DeclarationChange[] = [];
  for (const text of before) {
    const key = foldVoice(text);
    if (!afterKeys.has(key) && freshKeys.has(key)) out.push({ action: "remove", list, text });
  }
  const added = new Set<string>();
  for (const text of after) {
    const key = foldVoice(text);
    if (beforeKeys.has(key) || freshKeys.has(key) || added.has(key)) continue;
    added.add(key);
    out.push({ action: "add", list, text });
  }
  return out;
}

/**
 * Le voci scritte nel campo, separate da virgola. Senza tagli né tetto (a differenza di `splitList`): una voce lunga
 * già dichiarata, lasciata com'era, non deve risultare tolta; i limiti li fa valere la scrittura, dicendolo. Le voci di
 * `existing` che contengono una virgola, se compaiono intere nel testo, restano una voce sola.
 */
export function splitVoices(text: string, existing: readonly string[] = []): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string): void => {
    const v = raw.replace(/\s+/g, " ").trim();
    if (v === "" || seen.has(foldVoice(v))) return;
    seen.add(foldVoice(v));
    out.push(v);
  };
  let rest = text;
  for (const voice of [...existing].filter((x) => /[,;\n]/.test(x)).sort((x, y) => y.length - x.length)) {
    const at = rest.indexOf(voice);
    if (at < 0) continue;
    push(voice);
    rest = `${rest.slice(0, at)},${rest.slice(at + voice.length)}`;
  }
  for (const part of rest.split(/[,;\n]/)) push(part);
  return out;
}
