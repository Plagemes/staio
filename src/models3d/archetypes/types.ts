import type { BufferGeometry, Matrix4 } from "three";
import type { RecipeDetails } from "../recipe";
import type { Rng } from "../rng";

export type PartRole = "body" | "stem" | "leaf" | "cap" | "label" | "rind";

/** Parte prima della normalizzazione: la geometria è nello spazio locale, `matrix` la colloca. */
export interface RawPart {
  name: string;
  role: PartRole;
  geometry: BufferGeometry;
  /** Coppie di punti (x,y,z,x,y,z) di tratti d'inchiostro espliciti, nello spazio locale. */
  lines?: number[];
  matrix: Matrix4;
  /** Spessore del contorno come frazione della dimensione di riferimento del modello. */
  outline: number;
  /** Angolo (gradi) oltre cui si disegnano gli spigoli; assente = nessuno. */
  edgeAngle?: number;
  doubleSided?: boolean;
  signal?: boolean;
  /** Moltiplicatore della densità del tratto per questa parte. */
  densityMul?: number;
}

export interface BuildContext {
  rng: Rng;
  /** Intensità della variazione a seme, 0..1. */
  variation: number;
  details: RecipeDetails;
}
