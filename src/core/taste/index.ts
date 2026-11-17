export { basisOf } from "./basis";
export { decodeTasteData } from "./decode";
export type { CompactTasteData } from "./decode";
export { createTasteIndex, resolveTasteFood, searchTasteFoods } from "./index-build";
export type { TasteIndex } from "./index-build";
export { DEFAULT_PAIRING_LIMIT, pairingsForSet, pairingsOf } from "./pairings";
export { screenFood } from "./safety";
export type { PairingVerdict } from "./safety";
export type {
  Pairing,
  PairingDoubt,
  PairingOptions,
  PairingResult,
  TasteBasis,
  TasteData,
  TasteFood,
  TasteSource,
  TasteSubject,
} from "./types";
