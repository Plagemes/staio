import type { TasteBasis, TasteSource } from "./types";

const TEXT: Record<TasteSource, string> = {
  flavorgraph:
    "Somiglianza statistica appresa da molte ricette e dai composti aromatici degli alimenti: dice che questi alimenti compaiono in contesti simili. Non è una regola di cucina né un giudizio sulla salute.",
  sample:
    "Elenco di prova scritto a mano, con pochi alimenti e punteggi in tre fasce: non viene da dati statistici. Serve a provare la schermata, non è un consiglio.",
};

/** La base dichiarata di ciò che si mostra, secondo la fonte dei dati. */
export function basisOf(source: TasteSource): TasteBasis {
  return { source, statistical: source === "flavorgraph", text: TEXT[source] };
}
