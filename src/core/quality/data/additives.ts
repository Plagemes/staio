// Additivi per i quali esiste una dichiarazione ufficiale verificata. Tutto ciò che non è qui
// resta senza giudizio: dell'additivo si mostrano solo la presenza e il numero.
// Consultazione: testi dei regolamenti su EUR-Lex, 2026-11-17.

import type { SourceRef } from "../types";

export interface AdditiveStatement {
  code: string;
  name: string;
  kind: "not_authorised_in_food" | "label_warning";
  outcome: "intermediate" | "unfavorable";
  text: string;
  source: SourceRef;
}

const REG_2022_63: SourceRef = {
  body: "Commissione europea",
  document:
    "Regolamento (UE) 2022/63 del 14 gennaio 2022, che modifica gli allegati II e III del regolamento (CE) 1333/2008 per il biossido di titanio (E 171); considerando 11-12 (parere EFSA del 6 maggio 2021) e articolo 2",
  url: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32022R0063",
};

const REG_1333_ANNEX_V: SourceRef = {
  body: "Parlamento europeo e Consiglio dell'UE",
  document:
    "Regolamento (CE) 1333/2008 sugli additivi alimentari, allegato V (coloranti per i quali l'etichetta include informazioni addizionali), richiamato dall'articolo 24",
  url: "https://eur-lex.europa.eu/legal-content/IT/TXT/?uri=CELEX:32008R1333",
};

const WARNING_TEXT =
  "Nell'UE l'etichetta degli alimenti che lo contengono deve riportare l'avvertenza che può influire negativamente sull'attività e l'attenzione dei bambini.";

const colour = (code: string, name: string): AdditiveStatement => ({
  code,
  name,
  kind: "label_warning",
  outcome: "intermediate",
  text: WARNING_TEXT,
  source: REG_1333_ANNEX_V,
});

export const ADDITIVE_STATEMENTS: readonly AdditiveStatement[] = [
  {
    code: "E171",
    name: "Biossido di titanio",
    kind: "not_authorised_in_food",
    outcome: "unfavorable",
    text: "Dal 7 febbraio 2022 non è più autorizzato come additivo negli alimenti nell'UE: nel parere del 2021 l'EFSA ha concluso che non può più essere considerato sicuro come additivo alimentare. Se il prodotto lo riporta, il dato di Open Food Facts può essere datato o il prodotto non è conforme alle regole UE.",
    source: REG_2022_63,
  },
  colour("E102", "Tartrazina"),
  colour("E104", "Giallo di chinolina"),
  colour("E110", "Giallo tramonto (Sunset yellow)"),
  colour("E122", "Carmoisina"),
  colour("E124", "Ponceau 4R"),
  colour("E129", "Rosso allura"),
];

/** "e 171", "E171", "E-171" diventano "E171". Le lettere finali (E150a) restano e non corrispondono a nulla qui. */
export function normalizeAdditiveCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, "");
}

export function statementFor(code: string): AdditiveStatement | undefined {
  const normalized = normalizeAdditiveCode(code);
  return ADDITIVE_STATEMENTS.find((s) => s.code === normalized);
}
