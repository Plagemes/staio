// Abbinamenti di gusto: tipi dei dati e dei risultati. Logica pura, nessun dato qui dentro.

/** `sample`: insieme di prova scritto a mano. `flavorgraph`: vettori statistici (solo se la licenza lo consente, vedi FONTI.md). */
export type TasteSource = "sample" | "flavorgraph";

/** Un alimento dell'elenco degli abbinamenti, legato agli alimenti della tabella nutrizionale. */
export interface TasteFood {
  /** Identificativo stabile dell'alimento nell'elenco. */
  key: string;
  /** Nome italiano mostrato all'utente. */
  name: string;
  /** Altri nomi con cui si riconosce: confronto per parole uguali, mai approssimato. */
  aliases?: readonly string[];
  /** Identificativi della tabella nutrizionale che questo alimento comprende («pomodoro-crudo», «passata-di-pomodoro»). */
  foodIds: readonly string[];
}

/** Dati degli abbinamenti. I vicini sono per chiave, con punteggio da 0 (escluso) a 1. */
export interface TasteData {
  source: TasteSource;
  /** Versione dei dati, per ricordare da dove vengono. */
  version: string;
  foods: readonly TasteFood[];
  neighbors: Readonly<Record<string, readonly (readonly [string, number])[]>>;
}

/** Ciò che si sa di un ingrediente: nome, ed eventualmente l'alimento della tabella nutrizionale. */
export interface TasteSubject {
  name: string;
  foodId?: string;
  /** Altri nomi dello stesso alimento (per esempio il nome del prodotto), provati dopo il nome. */
  aliases?: readonly string[];
}

/** Su che cosa si fonda un risultato. Mostrato sempre accanto agli abbinamenti. */
export interface TasteBasis {
  source: TasteSource;
  /** Vero solo se i punteggi vengono da una statistica vera. */
  statistical: boolean;
  text: string;
}

/** Perché un abbinamento è mostrato con riserva. */
export interface PairingDoubt {
  /** Allergeni (nomi per l'utente) di cui non si può dire se l'alimento li contiene. */
  allergens: string[];
  /** Motivi, già in italiano. */
  reasons: string[];
}

export interface Pairing {
  food: TasteFood;
  /** Da 0 a 1. Per un insieme: media dei punteggi con i suoi alimenti, contando 0 dove non c'è legame. */
  score: number;
  /** Con quali alimenti dell'insieme si abbina (nomi dell'elenco). */
  supportedBy: string[];
  /** C'è in casa: nomi come scritti in dispensa. */
  inHome: boolean;
  homeNames: string[];
  /** Presente solo se un allergene dichiarato non si può escludere: mai da leggere come compatibile. */
  doubt?: PairingDoubt;
}

export interface PairingOptions {
  /** Ciò che c'è in casa. */
  home?: readonly TasteSubject[];
  /** Allergeni da evitare («glutine», «lattosio»…): chi li contiene è escluso, chi è incerto è segnalato. */
  allergens?: readonly string[];
  /** Alimenti da escludere per nome. */
  excludedFoods?: readonly string[];
  /** Quanti abbinamenti al massimo, oltre a quelli che ci sono in casa. Predefinito 20. */
  limit?: number;
}

export type PairingResult =
  /** Nessun alimento dell'insieme è nell'elenco: non si inventa nulla. */
  | { status: "not_in_list"; unknown: string[]; basis: TasteBasis }
  | {
      status: "ok";
      /** Gli alimenti riconosciuti. */
      members: TasteFood[];
      /** Nomi dati che non sono nell'elenco. */
      unknown: string[];
      pairings: Pairing[];
      /** Abbinamenti tolti per allergeni o alimenti esclusi. */
      hiddenCount: number;
      /** Elementi di casa che non sono nell'elenco: non si può dire se si abbinano. */
      homeNotInList: number;
      basis: TasteBasis;
    };
