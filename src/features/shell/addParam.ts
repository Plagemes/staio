// La richiesta «apri il foglio +» che arriva dall'indirizzo (la scorciatoia «Aggiungi» dell'icona). Solo funzioni pure.

const PARAM = "aggiungi";

function pairs(search: string): string[] {
  const body = search.startsWith("?") ? search.slice(1) : search;
  return body === "" ? [] : body.split("&");
}

const nameOf = (pair: string): string => {
  const raw = pair.split("=")[0] ?? "";
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
};

/** Vero solo per `aggiungi=1` (anche ripetuto con altri valori accanto). */
export function wantsAddSheet(search: string): boolean {
  return pairs(search).some((pair) => nameOf(pair) === PARAM && pair.slice(pair.indexOf("=") + 1) === "1" && pair.includes("="));
}

/** L'indirizzo senza il parametro `aggiungi`: gli altri restano come sono, nell'ordine. */
export function withoutAddParam(pathname: string, search: string, hash: string): string {
  const kept = pairs(search).filter((pair) => nameOf(pair) !== PARAM);
  return `${pathname}${kept.length > 0 ? `?${kept.join("&")}` : ""}${hash}`;
}
