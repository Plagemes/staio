// Indirizzi della vista «Qualità di ciò che mangi» e delle pagine a cui rimanda. Solo stringhe: nessun import pesante.

/** La vista dettagliata della settimana. */
export const DIET_PATH = "/app/salute/mangiato";
/** `?settimana=YYYY-MM-DD`: il lunedì della settimana da mostrare. */
export const WEEK_PARAM = "settimana";

export type DietAnchor = "consigli" | "come";

/** La vista, su una settimana (lunedì) e su una sezione se date. */
export function dietHref(options: { week?: string; anchor?: DietAnchor } = {}): string {
  const query = options.week ? `?${WEEK_PARAM}=${encodeURIComponent(options.week)}` : "";
  return `${DIET_PATH}${query}${options.anchor ? `#${options.anchor}` : ""}`;
}

/** La scheda di una ricetta del ricettario. */
export const recipeHref = (recipeId: string): string => `/app/ricette/vedi?id=${encodeURIComponent(recipeId)}`;

/** L'id dell'evento di una riga di Oggi: la chiave è `eventId` oppure `eventId#indice`. */
export const eventIdOfLineKey = (lineKey: string): string => {
  const hash = lineKey.indexOf("#");
  return hash < 0 ? lineKey : lineKey.slice(0, hash);
};

/** Una voce da controllare in Oggi: il giorno (se non è oggi) e la voce in vista. */
export function lineHref(lineKey: string, date: string, today: string): string {
  const day = date !== today ? `giorno=${encodeURIComponent(date)}&` : "";
  return `/app?${day}voce=${encodeURIComponent(eventIdOfLineKey(lineKey))}`;
}
