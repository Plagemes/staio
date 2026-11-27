"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssociationsResult } from "@/core/analysis";
import { addDays } from "@/core/diary";
import { useDietHistory } from "../diet";
import type { AssociationsInputs } from "./associationsJob";
import { runAssociations } from "./associationsClient";
import { ASSOCIATION_WINDOW_DAYS } from "./config";

type State =
  | { source: AssociationsInputs; status: "ok"; result: AssociationsResult }
  | { source: AssociationsInputs; status: "error" };

export interface AssociationsOutcome {
  result?: AssociationsResult;
  failed: boolean;
}

/** Calcola le associazioni in un worker quando gli ingressi cambiano; i risultati di ingressi vecchi non si mostrano. */
export function useAssociations(base: AssociationsInputs | undefined): AssociationsOutcome {
  const [state, setState] = useState<State | undefined>();
  // Stessa finestra delle associazioni: la quota di prodotti molto lavorati per giorno viene dal quadro di Mangiato.
  const dailyFrom = base ? addDays(base.today, -(ASSOCIATION_WINDOW_DAYS - 1)) : undefined;
  const diet = useDietHistory(dailyFrom ? { dailyFrom } : {});
  const daily = diet.history?.daily;
  const dietSettled = diet.ready || diet.error;

  const inputs = useMemo<AssociationsInputs | undefined>(() => {
    if (!base || !dietSettled) return undefined;
    if (!daily) return base;
    const processedShareByDate: Record<string, { share: number; coverage: number }> = {};
    for (const [date, d] of Object.entries(daily)) {
      if (d.processedShare !== undefined) processedShareByDate[date] = { share: d.processedShare, coverage: d.coverage };
    }
    return Object.keys(processedShareByDate).length > 0 ? { ...base, processedShareByDate } : base;
  }, [base, dietSettled, daily]);

  useEffect(() => {
    if (!inputs) return;
    let run: ReturnType<typeof runAssociations> | undefined;
    // Dopo il primo disegno; in StrictMode la pulizia ferma il timer prima che nasca un worker.
    const timer = window.setTimeout(() => {
      run = runAssociations(inputs);
      run.promise.then(
        (result) => setState({ source: inputs, status: "ok", result }),
        () => setState({ source: inputs, status: "error" }),
      );
    }, 60);
    return () => {
      window.clearTimeout(timer);
      run?.cancel();
    };
  }, [inputs]);
  const current = state && state.source === inputs ? state : undefined;
  return { result: current?.status === "ok" ? current.result : undefined, failed: current?.status === "error" };
}
