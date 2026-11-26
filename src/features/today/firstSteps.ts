// «Primi passi» in «Adesso»: che cosa resta da fare, nella prima settimana dopo l'introduzione. Logica pura.
import { addDays } from "@/core/diary";
import type { OnboardingMemory } from "../onboarding/logic";

/** Sette giorni in tutto, il giorno in cui è finita l'introduzione compreso. */
export const FIRST_STEPS_DAYS = 7;

export type FirstStepId = "pantry" | "meal" | "profile";

export interface FirstStepRow {
  id: FirstStepId;
  label: string;
  /** Una riga piccola sotto l'etichetta. */
  hint?: string;
  href: string;
}

export interface FirstStepsInput {
  memory: OnboardingMemory;
  /** Oggi, `YYYY-MM-DD`. */
  today: string;
  /** Almeno un lotto in dispensa, anche finito. */
  hasLots: boolean;
  /** Almeno un pasto nel diario, in un giorno qualunque. */
  hasMeal: boolean;
  /** Sesso ed età già salvati. */
  hasProfile: boolean;
}

/** Le righe da mostrare, nell'ordine, ognuna solo se non fatta; `null` se non c'è nulla da mostrare. */
export function firstStepsView(input: FirstStepsInput): FirstStepRow[] | null {
  const { memory, today } = input;
  if (memory.since === undefined || memory.stepsHidden) return null;
  // un orologio indietro di un giorno (viaggio, fuso) non toglie le righe: conta solo la fine della settimana
  if (today > addDays(memory.since, FIRST_STEPS_DAYS - 1)) return null;

  const rows: FirstStepRow[] = [];
  if (!input.hasLots) {
    rows.push({ id: "pantry", label: "Aggiungi alla dispensa ciò che hai in casa", hint: "codice, scontrino, a mano", href: "/app/cattura" });
  }
  if (!input.hasMeal) rows.push({ id: "meal", label: "Registra il primo pasto", href: "/app/pasto" });
  if (!input.hasProfile) {
    rows.push({ id: "profile", label: "Sesso ed età", hint: "per i valori di riferimento dei nutrienti", href: "/app/impostazioni/profilo" });
  }
  return rows.length > 0 ? rows : null;
}
