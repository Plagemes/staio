// Una riga dello scontrino collegata a un prodotto letto dal codice a barre: nome vero, quantità della confezione,
// categoria e giorni dopo l'apertura vengono dal prodotto; il lotto porta il codice, e da lì i valori nutrizionali.
// Usa soltanto ciò che esporta la lettura del codice a barre (`draftFromProduct`, `locationFor`).
import { isLocalCode, isLocalProduct, isRestrictedCode, type Product } from "@/core/catalog";
import { draftFromProduct, locationFor } from "../barcode/directAdd";
import type { ReviewLine } from "./receiptEvents";

export type LinePatch = Partial<ReviewLine>;

/** Un codice locale non è un codice a barre: la riga non lo mostra come tale. */
export function codeLabel(code: string, local = false): string {
  return local ? "Prodotto tuo, senza codice a barre" : `Codice ${code}`;
}

/** Come si descrive il prodotto collegato a una riga: il codice tra parentesi solo se è un vero codice a barre. */
export function linkedProductText(line: { barcode: string; productLabel?: string; localProduct?: true }): string {
  // senza la scheda (riga ripresa dalla memoria) la forma del codice basta per non mostrarlo come codice a barre
  if (line.localProduct || isLocalCode(line.barcode)) return `Prodotto: ${line.productLabel ?? codeLabel(line.barcode, true)}`;
  return `Prodotto: ${line.productLabel ?? line.barcode} (${line.barcode})`;
}

/** Codice interno del negozio: lo stesso numero è un prodotto in un negozio e un altro altrove, qualunque sia l'origine della scheda. La riga non si collega mai da sola. */
export function needsConfirmation(product: Product): boolean {
  return isRestrictedCode(product.barcode) && !isLocalProduct(product);
}

/** Cosa cambia nella riga quando il prodotto è stato trovato. Ciò che il prodotto non dice resta com'era. */
export function linkPatch(product: Product): LinePatch {
  const draft = draftFromProduct(product);
  return {
    include: true,
    ignoreAlways: false,
    barcode: product.barcode,
    productLabel: [draft.name, product.brand].filter((s): s is string => Boolean(s)).join(" · ") || codeLabel(product.barcode, isLocalProduct(product)),
    ...(isLocalProduct(product) ? { localProduct: true as const } : {}),
    daysAfterOpening: draft.daysAfterOpening,
    ...(draft.name ? { name: draft.name } : {}),
    ...(draft.quantityText ? { quantityText: draft.quantityText, quantityGuessed: false } : {}),
    ...(draft.category ? { category: draft.category, location: locationFor(draft.category) } : {}),
  };
}

/** Codice sconosciuto a Open Food Facts: la riga porta comunque il codice, il resto lo scrive l'utente. */
export function codeOnlyPatch(code: string): LinePatch {
  return { include: true, ignoreAlways: false, barcode: code, productLabel: codeLabel(code) };
}

export const unlinkPatch = (): LinePatch => ({ barcode: undefined, localProduct: undefined, productLabel: undefined, daysAfterOpening: undefined });
