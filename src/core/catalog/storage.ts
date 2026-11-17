// Dove conservare un prodotto, dal testo di Open Food Facts («conservation_conditions»), solo se il testo è chiaro.

export type StoragePlace = "frigo" | "freezer" | "dispensa";

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, " ");

// Prima le negazioni: «non congelare» e «non refrigerare» dicono dove NON stare.
const NOT_FREEZE = /(non|ne pas|do not|don t|nicht)\s+(congelare|surgelare|congeler|freeze)/;
const NOT_FRIDGE = /(non|ne pas|do not|don t|nicht)\s+(refrigerare|mettere in frigo|mettere au refrigerateur|mettre au refrigerateur|refrigerate|keep in the fridge|conservare in frigo)/;
const FREEZER = /(freezer|congelatore|congele a|conservare a -|a -\s?1[0-9]|-\s?18\s?°?\s?c|keep frozen|store frozen|conserver au congelateur|conserver a -)/;
const FRIDGE = /(frigo|frigorifero|refrigerat|refrigerateur|au frais entre|between 0|tra 0 e|tra \+?[0-4] e|da 0 a|0\s?°?\s?c? ?(e|a|-|and) ?\+?[3-8]\s?°|\+?[2-4]\s?°\s?c|keep refrigerated|store in the fridge|in the refrigerator)/;
const PANTRY = /(luogo fresco e asciutto|luogo asciutto|luogo fresco|al riparo da|temperatura ambiente|endroit frais et sec|endroit sec|au sec|a l abri de la chaleur|a l abri du soleil|cool,? dry place|dry place|room temperature|ambient)/;

/**
 * Il luogo che il testo indica, o undefined se non è chiaro. È una proposta: l'utente la può cambiare.
 * «Dopo l'apertura in frigo» non cambia il luogo di una confezione chiusa, quindi non conta.
 */
export function locationFromStorage(text: string | undefined): StoragePlace | undefined {
  if (!text) return undefined;
  const t = fold(text).replace(/\s+/g, " ");
  // un testo che parla di apertura riguarda un altro momento: non si decide da qui
  const closed = t.split(/(dopo l apertura|once opened|apres ouverture|apres l ouverture|after opening)/)[0];
  const freezerWord = FREEZER.test(closed) && !NOT_FREEZE.test(closed);
  const fridgeWord = FRIDGE.test(closed) && !NOT_FRIDGE.test(closed);
  const pantryWord = PANTRY.test(closed) || NOT_FRIDGE.test(closed);
  const found = [freezerWord && "freezer", fridgeWord && "frigo", pantryWord && "dispensa"].filter(Boolean) as StoragePlace[];
  // un testo che indica due luoghi diversi non è chiaro
  return found.length === 1 ? found[0] : undefined;
}
