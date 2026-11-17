export { checkDigitFor, isValidBarcode, toGtin13, validateBarcode } from "./barcode";
export type { BarcodeCheck, BarcodeFormat, BarcodeProblem } from "./barcode";
export { FALLBACK_CATEGORY, expiryCategoryFor, expiryCategoryMatch } from "./expiryCategory";
export { OFF_FIELDS, isStoredProduct, productFromOpenFoodFacts } from "./openFoodFacts";
export type { FromOffOptions } from "./openFoodFacts";
export { parsePackageQuantity, quantityText } from "./quantity";
export type {
  BaseUnit,
  ExpiryCategoryMatch,
  NovaGroup,
  Nutrients,
  NutriScore,
  PackageQuantity,
  Product,
} from "./types";
