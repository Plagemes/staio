// Tipi delle viste generate: il contesto di calcolo, i risultati delle interrogazioni e il loro catalogo.
// Una vista è solo una descrizione: i numeri nascono qui, dalle interrogazioni eseguite sui dati del dispositivo.
import type { DiaryState } from "../diary";
import type { Certainty, PantryState } from "../ledger";
import type { IntakeResult, Profile, ReferenceWithVariant } from "../nutrition";

/** Stato dell'app da cui si calcolano le viste. Tutto è già derivato: le interrogazioni non toccano disco né rete. */
export interface ViewContext {
  /** Giorno di calendario di oggi, `YYYY-MM-DD`. */
  today: string;
  pantry: PantryState;
  diary: DiaryState;
  /** Nutrienti per giornata. Assente finché la tabella degli alimenti non è caricata. */
  intake?: IntakeResult;
  references?: readonly ReferenceWithVariant[];
  /** Profilo per i valori di riferimento; null se l'utente non l'ha ancora scritto. */
  profile?: Profile | null;
}

/** Un numero con la sua unità e la sua certezza. */
export interface NumberResult {
  kind: "number";
  value: number;
  /** "kcal", "mg", "€", "giorni"... */
  unit: string;
  /** Cifre decimali da mostrare. */
  digits: number;
  certainty?: Certainty;
  /** Su quali dati poggia: quanti giorni, quanta parte manca. */
  basis: string;
  /** Avvertenza o precisazione, se serve. */
  note?: string;
}

export interface SeriesPoint {
  /** Etichetta dell'ascissa già pronta (per esempio "12/11"). */
  label: string;
  /** null = nessun dato in quel punto: nel grafico è una lacuna, mai uno zero. */
  value: number | null;
}

export interface SeriesResult {
  kind: "series";
  points: SeriesPoint[];
  unit: string;
  digits: number;
  certainty?: Certainty;
  basis: string;
  note?: string;
}

export interface RowItem {
  label: string;
  /** Valore già formattato ("12,3 mg", "scade domani"). */
  valueText: string;
  /** Quota sul totale, da 0 a 1, per la barretta. */
  share?: number;
  /** Seconda riga, più piccola. */
  detail?: string;
  certainty?: Certainty;
}

export interface RowsResult {
  kind: "rows";
  rows: RowItem[];
  /** I nomi effettivamente trovati, quando l'interrogazione cerca per nome. */
  matched?: string[];
  basis: string;
  note?: string;
}

/** «Dati insufficienti»: nessun numero, e perché. Mai uno zero al posto di un dato che manca. */
export interface InsufficientResult {
  kind: "insufficient";
  reason: string;
  basis: string;
}

export type QueryResult = NumberResult | SeriesResult | RowsResult | InsufficientResult;
export type ResultKind = "number" | "series" | "rows";

export type ParamValue = string | number;
export type Params = Readonly<Record<string, ParamValue>>;

export type ParamDef =
  | { kind: "enum"; values: readonly string[]; default?: string; description: string }
  | { kind: "int"; min: number; max: number; default?: number; description: string }
  | { kind: "text"; maxLength: number; description: string };

export interface QueryDef {
  name: string;
  /** In italiano: cosa calcola. È ciò che legge l'intelligenza artificiale per scegliere. */
  description: string;
  params: Readonly<Record<string, ParamDef>>;
  result: ResultKind;
  /** Servono i nutrienti calcolati (e per alcuni i riferimenti): se mancano il risultato è «dati insufficienti». */
  needsNutrition: boolean;
  /** Frase breve che dice cosa mostra la riga con questi parametri, per esempio «Ferro · ultimi 30 giorni». */
  caption: (params: Params, result?: QueryResult) => string;
  /** Pura: dagli stati derivati al risultato. Non lancia per dati insoliti. */
  run: (params: Params, ctx: ViewContext) => QueryResult;
}
