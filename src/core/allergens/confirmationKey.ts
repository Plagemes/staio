// Conferma dell'utente per gli ingredienti «non verificabili»: chiave dell'ingrediente e regole di copertura.
//
// La conferma è una dichiarazione dell'utente («ho letto l'etichetta, per me va bene»): l'app non ha verificato nulla e
// non rileva tracce né contaminazioni. Vale solo per l'esito `uncertain`, mai per `contains`. Copre solo gli allergeni
// e le esclusioni dichiarati quando è stata data, ed è legata a ciò che l'ingrediente era in quel momento: nome, nota,
// identificativo dell'alimento, alimenti di dispensa collegati, prodotto e codici a barre. Cambia uno di questi e la
// conferma decade. Nessuna corrispondenza approssimata: il confronto è sul testo normalizzato, parola per parola.

/** Ciò che identifica un ingrediente per la conferma: tutto ciò che il motore legge, più i codici dei prodotti collegati. */
export interface ConfirmableItem {
  name: string;
  note?: string;
  foodId?: string;
  linkedNames?: readonly string[];
  productName?: string;
  /** Codici a barre o identificativi dei prodotti di dispensa collegati. */
  productRefs?: readonly string[];
}

/**
 * Testo normalizzato per le chiavi: NFKC, minuscolo, punteggiatura e spazi ridotti a uno. Conserva lettere, segni e cifre
 * di ogni alfabeto (a differenza di `foldText`, che serve alle tabelle latine): «salsa Молоко» e «salsa Сыр» restano
 * diverse, e «œ», «æ», «ø», «ß» non spariscono. Gli accenti restano: «pâté» non è «pate».
 */
export function keyText(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, " ")
    .trim();
}

const folded = (s: string | undefined): string => (s === undefined ? "" : keyText(s));
const foldedSet = (xs: readonly string[] | undefined): string[] =>
  [...new Set((xs ?? []).map(keyText).filter((x) => x !== ""))].sort();
const refSet = (xs: readonly string[] | undefined): string[] =>
  [...new Set((xs ?? []).map((x) => x.trim()).filter((x) => x !== ""))].sort();

/**
 * La chiave della conferma: il nome normalizzato dall'unico normalizzatore del motore e, insieme, nota, alimento
 * collegato, prodotto e codici. Due ingredienti hanno la stessa chiave solo se coincidono in tutto («prosciutto cotto»
 * non copre «prosciutto crudo» né «prosciutto cotto affumicato»). Vuota se il nome non ha lettere né cifre.
 */
export function confirmationKey(item: ConfirmableItem): string {
  const name = folded(item.name);
  if (name === "") return "";
  return JSON.stringify([
    name,
    folded(item.note),
    folded(item.foodId),
    foldedSet(item.linkedNames),
    folded(item.productName),
    refSet(item.productRefs),
  ]);
}

/** Una conferma attiva, come risulta dal registro. */
export interface ConfirmationRecord {
  key: string;
  /** Il nome dell'ingrediente come l'utente l'ha visto. */
  ingredient: string;
  /** Gli allergeni dichiarati quando l'ha data, come etichette del motore (`allergenLabels`). */
  allergens: readonly string[];
  /** Le esclusioni dichiarate allora, normalizzate. */
  excludedFoods: readonly string[];
  /** Istante in cui è stata data (`recordedAt` dell'evento che vale). */
  confirmedAt: string;
  /** L'evento che vale. */
  eventId: string;
  /** Tutti gli eventi di conferma ancora validi per questa chiave: una revoca li cita tutti. */
  eventIds: readonly string[];
  /** Il dispositivo su cui è stata data (quella che vale). */
  deviceId: string;
}

/** Le conferme attive per chiave. */
export type ConfirmationMap = ReadonlyMap<string, ConfirmationRecord>;

/** Le esclusioni dichiarate, normalizzate con `keyText`, senza vuoti né doppioni, in ordine. */
export function foldedExclusions(excludedFoods: readonly string[] | undefined): string[] {
  return foldedSet(excludedFoods);
}

/**
 * Che cosa, di ciò che è dichiarato adesso, la conferma non copre: allergeni (come etichette del motore) ed esclusioni
 * normalizzate. Un allergene non coperto resta incerto, e gli altri restano confermati; un'esclusione non coperta
 * toglie valore a tutta la conferma, finché non la si ridà. Lo applica il motore.
 */
export function confirmationLapse(
  record: Pick<ConfirmationRecord, "allergens" | "excludedFoods">,
  declaredLabels: readonly string[],
  excludedFoods: readonly string[],
): { allergens: string[]; excludedFoods: string[] } {
  return {
    allergens: declaredLabels.filter((a) => !record.allergens.includes(a)),
    excludedFoods: foldedExclusions(excludedFoods).filter((e) => !record.excludedFoods.includes(e)),
  };
}
