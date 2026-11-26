// I passi del foglio «Mettiamoci in pari»: quale pulsante pieno c'è e quando un tocco su di esso vale. Pura.

/**
 * «Avanti» e «Salva» stanno nello stesso punto: un doppio tocco su «Avanti» nel penultimo giorno arriverebbe su «Salva»
 * senza aver mostrato l'ultimo. Per questo tempo dopo un cambio di passo il pulsante pieno non vale.
 */
export const STEP_SETTLE_MS = 500;

export type PrimaryAction = "next" | "save";

/** Il pulsante pieno del passo: «Avanti» nei giorni prima dell'ultimo, «Salva» sull'ultimo. */
export const primaryAction = (step: number, total: number): PrimaryAction => (step >= total - 1 ? "save" : "next");

/**
 * Un tocco sul pulsante pieno vale solo se il passo è in vista da almeno `STEP_SETTLE_MS`. `changedAt`: l'istante
 * (ms) dell'ultimo cambio di passo, `null` se il foglio non ha ancora cambiato passo.
 */
export function tapAccepted(changedAt: number | null, now: number): boolean {
  return changedAt === null || now - changedAt >= STEP_SETTLE_MS;
}

/**
 * Che cosa fa un tocco sul pulsante pieno: niente se il passo è appena cambiato, altrimenti l'azione del passo in vista.
 * Il passo è quello dell'ultimo cambio, non quello del disegno su cui è arrivato il tocco.
 */
export function onPrimaryTap(args: { step: number; total: number; changedAt: number | null; now: number }): PrimaryAction | "ignore" {
  return tapAccepted(args.changedAt, args.now) ? primaryAction(args.step, args.total) : "ignore";
}
