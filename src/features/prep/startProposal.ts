"use client";

// La proposta di partenza di un modulo (gli ingredienti da prendere dalla dispensa per una ricetta), calcolata al
// montaggio. Al montaggio i dati possono essere di un istante prima: la dispensa di prima di una scrittura appena
// fatta, la tabella degli alimenti e le scelte manuali non ancora lette. Finché l'utente non ha toccato la proposta, e
// per poco dopo l'apertura, la si rifà quando arrivano i dati nuovi; poi resta quella, e ciò che l'utente ha scritto
// non si riscrive mai.
import { useEffect, useState } from "react";

/** Per quanto, dall'apertura, la proposta non toccata segue i dati che arrivano. */
export const START_SETTLE_MS = 2000;

/** Qualcosa da cui dipende la proposta è cambiato (per identità: i dati dei ganci sono oggetti nuovi solo se cambiano). */
export function inputsChanged(before: readonly unknown[], now: readonly unknown[]): boolean {
  return before.length !== now.length || now.some((value, i) => !Object.is(value, before[i]));
}

/** Se rifare la proposta di partenza: solo con dati cambiati, se l'utente non l'ha toccata e non è passato il tempo. */
export function shouldRedoStart(input: { changed: boolean; touched: boolean; settled: boolean }): boolean {
  return input.changed && !input.touched && !input.settled;
}

/**
 * La proposta di partenza: `compute` gira al montaggio e di nuovo, finché `touched` è falso e per `START_SETTLE_MS`,
 * quando cambia uno di `inputs`. `compute` deve dipendere solo da `inputs`.
 */
export function useStartProposal<T>(compute: () => T, inputs: readonly unknown[], touched: boolean): T {
  const [seed, setSeed] = useState(() => ({ inputs, value: compute() }));
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), START_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, []);
  if (shouldRedoStart({ changed: inputsChanged(seed.inputs, inputs), touched, settled })) {
    const next = { inputs, value: compute() };
    setSeed(next);
    return next.value;
  }
  return seed.value;
}
