"use client";

// I dati da cui si calcolano le viste, presi dall'archivio locale e passati a chi li disegna.
// I nutrienti (e con loro la tabella degli alimenti) si caricano solo se una vista li usa.
import { useMemo, type ReactNode } from "react";
import type { ViewContext } from "@/core/views";
import { useDiary, usePantry } from "@/data";
import { dayOf } from "../format";
import { toEngineProfile } from "../nutrition/profile";
import { useIntake, useNutritionProfile, useReferences } from "../nutrition/useNutrition";
import { useNow } from "../useNow";

export type ContextState = { status: "loading" } | { status: "error" } | { status: "ready"; ctx: ViewContext };

interface GateProps {
  needsNutrition: boolean;
  children: (state: ContextState) => ReactNode;
}

/** Dà ai figli lo stato dell'app pronto per le interrogazioni, oppure «sto caricando» o «errore». */
export function ViewContextGate({ needsNutrition, children }: GateProps) {
  const now = useNow();
  const pantry = usePantry();
  const diary = useDiary();
  const base = useMemo(
    () => (now && pantry.data && diary.data ? { today: dayOf(now), pantry: pantry.data, diary: diary.data } : undefined),
    [now, pantry.data, diary.data],
  );
  const failed = Boolean(pantry.error || diary.error);

  if (failed) return <>{children({ status: "error" })}</>;
  if (!base) return <>{children({ status: "loading" })}</>;
  if (!needsNutrition) return <>{children({ status: "ready", ctx: base })}</>;
  return <WithNutrition base={base}>{children}</WithNutrition>;
}

function WithNutrition({ base, children }: { base: Pick<ViewContext, "today" | "pantry" | "diary">; children: (state: ContextState) => ReactNode }) {
  const nutrition = useIntake();
  const references = useReferences();
  const { profile, ready: profileReady } = useNutritionProfile();

  const ctx = useMemo<ViewContext | undefined>(() => {
    if (!nutrition.ready || !references || !profileReady) return undefined;
    return {
      ...base,
      intake: nutrition.intake,
      references,
      profile: profile ? toEngineProfile(profile, base.today) : null,
    };
  }, [base, nutrition.ready, nutrition.intake, references, profile, profileReady]);

  if (nutrition.error) return <>{children({ status: "error" })}</>;
  // senza i nutrienti pronti le viste che non li usano si possono già calcolare: le altre dicono «non ancora pronti»
  return <>{children({ status: "ready", ctx: ctx ?? base })}</>;
}
