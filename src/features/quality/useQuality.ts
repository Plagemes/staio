"use client";

// Dati per le schermate di qualità. Tutto viene dal telefono: prodotti già letti, dispensa, registro,
// profilo e obiettivi. Niente rete, quindi la scheda di un prodotto salvato funziona anche senza.
import { useMemo, useSyncExternalStore } from "react";
import type { Product } from "@/core/catalog";
import type { Lot } from "@/core/ledger";
import { compareWithReferences, type ReferenceComparison } from "@/core/nutrition";
import type { Candidate, PersonalGoal } from "@/core/quality";
import { usePantry } from "@/data";
import { dayOf } from "../format";
import { periodOf } from "../nutrition/prepare";
import { toEngineProfile } from "../nutrition/profile";
import { useIntake, useNutritionProfile, useProducts, useReferences } from "../nutrition/useNutrition";
import { setSetting, useSetting } from "../localSettings";
import { useNow } from "../useNow";
import { buildCandidates } from "./candidates";
import { buildDietImpact, type DietImpactView } from "./consumption";
import { GOALS_SETTING_KEY, isGoals } from "./goals";

/** Confronto con i riferimenti sugli ultimi 30 giorni, come nella schermata della nutrizione. */
const COMPARISON_DAYS = 30;

const NO_GOALS: PersonalGoal[] = [];
const NO_LOTS: Lot[] = [];
const NO_PRODUCTS: ReadonlyMap<string, Product> = new Map();

export function useGoals(): { goals: PersonalGoal[]; ready: boolean } {
  const { value, ready } = useSetting<PersonalGoal[]>(GOALS_SETTING_KEY, isGoals, NO_GOALS);
  return { goals: value, ready };
}

export const saveGoals = (goals: readonly PersonalGoal[]): Promise<void> => setSetting(GOALS_SETTING_KEY, [...goals]);

/** Online o no, dal browser: serve solo a dirlo, la ricerca di rete decide da sola. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("online", onChange);
      window.addEventListener("offline", onChange);
      return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
      };
    },
    () => navigator.onLine,
    () => true,
  );
}

export interface QualityContext {
  /** Prodotti noti, dispensa e ora sono pronti: la scheda si può mostrare. */
  ready: boolean;
  /** I confronti con i riferimenti sono stati calcolati (o non c'è modo di calcolarli). */
  personalReady: boolean;
  /** Confronti utilizzabili; assenti senza profilo o senza dati. */
  comparisons: ReferenceComparison[] | undefined;
  profileMissing: boolean;
  goals: PersonalGoal[];
  /** Prodotti già letti o comprati, con i prezzi osservati. */
  candidates: Candidate[];
  lots: Lot[];
  products: ReadonlyMap<string, Product>;
}

export function useQualityContext(): QualityContext {
  const intake = useIntake();
  const refs = useReferences();
  const { profile, ready: profileReady } = useNutritionProfile();
  const { goals, ready: goalsReady } = useGoals();
  const pantry = usePantry();
  const products = useProducts();
  const now = useNow();
  const today = now ? dayOf(now) : null;

  const lots = pantry.data?.lots ?? NO_LOTS;
  const candidates = useMemo(() => (products ? buildCandidates(products.values(), lots) : []), [products, lots]);

  const comparisons = useMemo(() => {
    if (!intake.intake || !refs || !profile || !today) return undefined;
    return compareWithReferences(intake.intake.days, refs, toEngineProfile(profile, today), periodOf(today, COMPARISON_DAYS));
  }, [intake.intake, refs, profile, today]);

  const ready = products !== undefined && (pantry.data !== undefined || Boolean(pantry.error)) && today !== null && goalsReady;
  const personalReady = profileReady && (intake.error || (intake.ready && refs !== undefined));

  return {
    ready,
    personalReady,
    comparisons,
    profileMissing: profileReady && !profile,
    goals,
    candidates,
    lots,
    products: products ?? NO_PRODUCTS,
  };
}

export function useDietImpact(): { ready: boolean; error: boolean; view?: DietImpactView } {
  const intake = useIntake();
  const products = useProducts();
  const now = useNow();
  const today = now ? dayOf(now) : null;
  const view = useMemo(() => {
    if (!intake.intake || !products || !today) return undefined;
    return buildDietImpact(intake.intake.days, products, today);
  }, [intake.intake, products, today]);
  return { ready: view !== undefined, error: intake.error, ...(view ? { view } : {}) };
}
