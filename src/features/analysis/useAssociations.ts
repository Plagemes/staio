"use client";

import { useEffect, useState } from "react";
import type { AssociationsResult } from "@/core/analysis";
import type { AssociationsInputs } from "./associationsJob";
import { runAssociations } from "./associationsClient";

type State =
  | { source: AssociationsInputs; status: "ok"; result: AssociationsResult }
  | { source: AssociationsInputs; status: "error" };

export interface AssociationsOutcome {
  result?: AssociationsResult;
  failed: boolean;
}

/** Calcola le associazioni in un worker quando gli ingressi cambiano; i risultati di ingressi vecchi non si mostrano. */
export function useAssociations(inputs: AssociationsInputs | undefined): AssociationsOutcome {
  const [state, setState] = useState<State | undefined>();
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
