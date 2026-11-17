export { checkDigitFor, isValidBarcode, toGtin13, validateBarcode } from "./barcode";
export type { BarcodeCheck, BarcodeFormat, BarcodeProblem } from "./barcode";
export { FALLBACK_CATEGORY, expiryCategoryFor, expiryCategoryFromName, expiryCategoryMatch, expiryCategoryProposal } from "./expiryCategory";
export type { ExpiryCategoryProposal, ExpiryCategorySource } from "./expiryCategory";
export { OFF_FIELDS, isStoredProduct, productFromOpenFoodFacts } from "./openFoodFacts";
export type { FromOffOptions } from "./openFoodFacts";
export { parsePeriodAfterOpening } from "./periodAfterOpening";
export { parsePackageQuantity, quantityText } from "./quantity";
export { piecesHintFrom } from "./piecesHint";
export { locationFromStorage } from "./storage";
export type { StoragePlace } from "./storage";
export type {
  BaseUnit,
  ExpiryCategoryMatch,
  NovaGroup,
  Nutrients,
  NutriScore,
  PackageQuantity,
  PiecesHint,
  ServingSize,
  Product,
} from "./types";
