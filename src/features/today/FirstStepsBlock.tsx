"use client";

import { useSetting } from "@/data";
import type { DiaryState } from "@/core/diary";
import type { PantryState } from "@/core/ledger";
import { Label } from "@/design";
import { ActionList } from "../common";
import { PROFILE_SETTING_KEY, isNutritionProfile } from "../nutrition/profile";
import { hideFirstSteps, useOnboardingMemory } from "../onboarding";
import ui from "../ui.module.css";
import { firstStepsView, type FirstStepRow } from "./firstSteps";
import styles from "./FirstStepsBlock.module.css";

interface Inputs {
  /** Oggi, `YYYY-MM-DD`. */
  today: string;
  diary: DiaryState;
  pantry: PantryState;
}

/**
 * Le righe di «Primi passi» e se si sa già che cosa mostrare: finché memoria e profilo non sono letti non si decide
 * (né le righe né il suggerimento che ne prende il posto), così non c'è mai un lampo.
 */
export function useFirstSteps({ today, diary, pantry }: Inputs): { ready: boolean; rows: FirstStepRow[] | null } {
  const memory = useOnboardingMemory();
  const profile = useSetting<unknown>(PROFILE_SETTING_KEY);
  if (memory === undefined || profile.loading || profile.error !== undefined) return { ready: false, rows: null };
  const rows = firstStepsView({
    memory,
    today,
    hasLots: pantry.lots.length > 0,
    hasMeal: diary.days.some((d) => d.meals.length > 0 || d.untrackedMeals.length > 0),
    hasProfile: isNutritionProfile(profile.data),
  });
  return { ready: true, rows };
}

/** In fondo a «Adesso»: ciò che resta da fare, senza pulsanti propri. Il pulsante pieno resta quello del momento. */
export function FirstSteps({ rows }: { rows: readonly FirstStepRow[] }) {
  return (
    <div className={styles.steps}>
      <Label>Primi passi</Label>
      <ActionList items={rows.map((r) => ({ id: r.id, label: r.label, hint: r.hint, href: r.href }))} />
      <button type="button" className={`${ui.textLink} ${styles.leave}`} onClick={hideFirstSteps}>
        Lascia così
      </button>
    </div>
  );
}
