// Esiti giornalieri del diario (umore e sintomi) usati da esperimenti e associazioni.

import type { DiaryDay, SymptomKind } from "../diary";
import { mean } from "./stats";

export const OUTCOME_KEYS = [
  "mood",
  "symptomDigestion",
  "symptomEnergy",
  "symptomSleep",
  "symptomOther",
] as const;
export type OutcomeKey = (typeof OUTCOME_KEYS)[number];

export const OUTCOME_LABELS: Record<OutcomeKey, string> = {
  mood: "umore",
  symptomDigestion: "sintomi di digestione",
  symptomEnergy: "sintomi di energia",
  symptomSleep: "sintomi di sonno",
  symptomOther: "altri sintomi",
};

const SYMPTOM_OUTCOME: Record<SymptomKind, OutcomeKey> = {
  digestion: "symptomDigestion",
  energy: "symptomEnergy",
  sleep: "symptomSleep",
  other: "symptomOther",
};

/**
 * Valore del giorno: media dei punteggi registrati. Un giorno senza registrazioni non ha valore
 * (`undefined`): l'assenza di una voce non è un punteggio basso. Il verso dei punteggi (se più
 * alto è meglio o peggio) non è interpretato: si descrive solo "più alto" o "più basso".
 */
export function dailyOutcome(day: DiaryDay | undefined, key: OutcomeKey): number | undefined {
  if (!day) return undefined;
  const scores =
    key === "mood"
      ? day.moods.map((m) => m.score)
      : day.symptoms.filter((s) => SYMPTOM_OUTCOME[s.kind] === key).map((s) => s.score);
  return scores.length === 0 ? undefined : mean(scores);
}
