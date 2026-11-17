// Percorso d'ingresso dopo la scelta dello stile: quando proporlo e che cosa si ricorda. Logica pura.
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
