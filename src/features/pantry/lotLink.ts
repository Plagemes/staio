// `/app/dispensa?lotto=<id>`: quando aprire la scheda dell'alimento e quando dire che non c'è più. Logica pura; la
// schermata la interroga a ogni disegno finché la richiesta è aperta.

/**
 * Quanto si aspetta un alimento che non c'è ancora: chi tocca «Vedi» subito dopo un salvataggio può trovare la
 * dispensa di prima, e l'alimento compare alla lettura dopo.
 */
export const LOT_WAIT_MS = 2000;

export type LotLinkVerdict =
  /** L'alimento c'è: si apre la sua scheda. */
  | "show"
  /** Non c'è ancora: si riprova al prossimo stato della dispensa, senza dire niente. */
  | "wait"
  /** Non c'è: lo si dice. */
  | "gone";

/**
 * Che cosa fare di una richiesta `?lotto=`. L'alimento trovato si apre, anche tardi. Se manca, lo si dice solo quando
 * manca ancora in uno stato della dispensa arrivato dopo quello visto alla richiesta, oppure passati `LOT_WAIT_MS`
 * (senza scritture lo stato dopo non arriva mai).
 */
export function lotLinkVerdict(input: {
  /** L'alimento è nella dispensa che c'è adesso. */
  found: boolean;
  /** La dispensa di adesso non è quella che c'era quando la richiesta è stata guardata la prima volta. */
  stateChanged: boolean;
  /** Millisecondi dall'arrivo della richiesta sulla pagina. */
  waitedMs: number;
}): LotLinkVerdict {
  if (input.found) return "show";
  return input.stateChanged || input.waitedMs >= LOT_WAIT_MS ? "gone" : "wait";
}
