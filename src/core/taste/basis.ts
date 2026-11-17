import type { TasteBasis, TasteSource } from "./types";

const TEXT: Record<TasteSource, string> = {
  flavorgraph:
    "Somiglianza statistica di gusto appresa da ricette e composti aromatici: non è una regola né un giudizio di salute.",
  sample: "Insieme di prova scritto a mano, usato solo nei test: non viene da dati statistici.",
};

/** La base dichiarata di ciò che si mostra, secondo la fonte dei dati. */
export function basisOf(source: TasteSource): TasteBasis {
  return { source, statistical: source === "flavorgraph", text: TEXT[source] };
}
