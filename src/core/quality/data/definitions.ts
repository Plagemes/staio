// Definizioni usate per NOVA e Nutri-Score. Il testo è una parafrasi in italiano della fonte
// (consultata il 2026-11-17); il raggruppamento in esiti è indicato accanto a ciò su cui si fonda.

import type { NovaGroup, NutriScore } from "../../catalog";
import type { Outcome, SourceRef } from "../types";

export const NOVA_SOURCE: SourceRef = {
  body: "FAO (Organizzazione delle Nazioni Unite per l'alimentazione e l'agricoltura)",
  document:
    "Monteiro C.A., Cannon G., Lawrence M., Costa Louzada M.L., Pereira Machado P., Ultra-processed foods, diet quality, and health using the NOVA classification system, Roma 2019, Table 1 e pp. 6-8",
  url: "https://www.fao.org/3/ca5644en/ca5644en.pdf",
};

/** Come Open Food Facts attribuisce il gruppo NOVA al prodotto (calcolo da ingredienti e categorie). */
export const NOVA_OFF_SOURCE: SourceRef = {
  body: "Open Food Facts",
  document: "Pagina NOVA: il gruppo è calcolato dagli ingredienti e dalle categorie del prodotto con un metodo che la pagina definisce ancora sperimentale",
  url: "https://world.openfoodfacts.org/nova",
};

export interface NovaDefinition {
  group: NovaGroup;
  name: string;
  /** Definizione della fonte, in parafrasi. */
  definition: string;
  /**
   * Esito per la presentazione. La FAO non assegna voti ai gruppi: l'esito riassume ciò che il
   * documento dice di ciascun gruppo, indicato in `basis`.
   */
  outcome: Exclude<Outcome, "not_assessable">;
  basis: string;
}

export const NOVA_DEFINITIONS: Readonly<Record<NovaGroup, NovaDefinition>> = {
  1: {
    group: 1,
    name: "Alimenti non trasformati o minimamente trasformati",
    definition:
      "Parti commestibili di piante o animali, funghi, alghe e acqua dopo la separazione dalla natura, anche sottoposte a processi come essiccazione, frantumazione, filtrazione, tostatura, bollitura, fermentazione non alcolica, pastorizzazione, refrigerazione, congelamento o confezionamento sottovuoto.",
    outcome: "favorable",
    basis: "Il documento FAO indica che, in varietà e combinazioni appropriate, questi alimenti sono la base di una dieta sana.",
  },
  2: {
    group: 2,
    name: "Ingredienti culinari trasformati",
    definition:
      "Sostanze ricavate dagli alimenti del gruppo 1 o dalla natura con pressatura, raffinazione, macinazione o essiccazione, come oli, burro, strutto, zucchero e sale, usate per preparare e condire gli alimenti del gruppo 1.",
    outcome: "intermediate",
    basis:
      "Il documento FAO indica che, da soli, sono squilibrati e (tranne il sale) molto energetici, che si usano in combinazione con altri alimenti e che possono essere usati in eccesso.",
  },
  3: {
    group: 3,
    name: "Alimenti trasformati",
    definition:
      "Prodotti ottenuti aggiungendo sale, olio, zucchero o altri ingredienti del gruppo 2 agli alimenti del gruppo 1, con metodi di conservazione come inscatolamento e imbottigliamento e, per pane e formaggi, fermentazione non alcolica.",
    outcome: "intermediate",
    basis:
      "Il documento FAO indica che, come gli ingredienti culinari, possono essere usati in eccesso e che con moderazione (per le carni lavorate anche solo occasionalmente) danno piatti equilibrati.",
  },
  4: {
    group: 4,
    name: "Alimenti ultra-processati",
    definition:
      "Formulazioni di ingredienti, per lo più di uso esclusivamente industriale, ottenute con una serie di tecniche e processi industriali, spesso con additivi come aromi, coloranti, emulsionanti e dolcificanti.",
    outcome: "unfavorable",
    basis:
      "Il documento FAO indica che questi prodotti sono tipicamente nutrizionalmente squilibrati e tendono a essere consumati in eccesso e a sostituire gli altri gruppi.",
  },
};

export const NUTRI_SCORE_SOURCE: SourceRef = {
  body: "Santé publique France",
  document:
    "Pagina Nutri-Score: punteggio unico sulla qualità nutrizionale calcolato per 100 g o 100 ml, su una scala di cinque colori da verde scuro ad arancione scuro abbinati alle lettere da A a E",
  url: "http://www.santepubliquefrance.fr/nutri-score",
};

/** Da dove viene la lettera mostrata: il dato del prodotto letto da Open Food Facts. */
export const NUTRI_SCORE_DATA_ORIGIN = "Open Food Facts (campo del prodotto, non ricalcolato)";

/**
 * Raggruppamento per posizione sulla scala A-E (migliore, centro, peggiore): è una scelta di
 * presentazione, non una soglia della fonte. La lettera resta sempre mostrata accanto all'esito.
 */
export const NUTRI_SCORE_OUTCOME: Readonly<Record<NutriScore, Exclude<Outcome, "not_assessable">>> = {
  a: "favorable",
  b: "favorable",
  c: "intermediate",
  d: "unfavorable",
  e: "unfavorable",
};
