// Dove compare la qualità del prodotto nella scheda di un alimento in Dispensa: il riquadro a colpo d'occhio quando il
// prodotto è in cache e si può valutare, altrimenti la voce «Qualità del prodotto» nel menu «Altro». Mai tutti e due.
import { isLocalProduct, type Product } from "@/core/catalog";
import { qualityGlance } from "../quality/glance";
import { qualityHref } from "../quality/links";

export interface LotQuality {
  /** Il prodotto da mostrare nel riquadro; assente se non c'è il codice, la scheda non è in cache, è scritta a mano o non si valuta. */
  glance?: Product;
  /** La pagina della qualità per la voce di menu; assente quando c'è il riquadro o il prodotto non ha una pagina. */
  menuHref?: string;
}

export function lotQuality(barcode: string | undefined, product: Product | undefined): LotQuality {
  if (!barcode || isLocalProduct(product)) return {};
  if (product && qualityGlance(product)) return { glance: product };
  return { menuHref: qualityHref(barcode) };
}
