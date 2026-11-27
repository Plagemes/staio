// Indice di qualità dei prodotti: schermate e funzioni di preparazione dei dati.
// Il componente da montare nelle altre schermate è `ProductQuality`.
export { ProductQuality } from "./ProductQuality";
export type { ProductQualityProps } from "./ProductQuality";
export { Quality } from "./Quality";
export { QualityProduct } from "./QualityProduct";
export { Shelf } from "./Shelf";
export { KnownProducts } from "./KnownProducts";
export { useQualityContext } from "./useQuality";
export type { QualityContext } from "./useQuality";
export { KNOWN_PRODUCTS_PATH, QUALITY_PATH, QUALITY_PRODUCT_PATH, SHELF_PATH, qualityHref } from "./links";
export { buildCandidates, knownProductRows, pantryStockFor, pricesFor } from "./candidates";
export { buildDietImpact, consumptionEntries, trackedWindow } from "./consumption";
export { alternativesView } from "./alternatives";
export { compareTable } from "./compare";
export { listEntryFor } from "./listEntry";
export { QualityGlance } from "./QualityGlance";
export type { QualityGlanceProps } from "./QualityGlance";
export { GLANCE_MAX, qualityGlance } from "./glance";
export type { GlanceChip, QualityGlanceView } from "./glance";
