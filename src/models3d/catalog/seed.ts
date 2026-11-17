import type { Recipe } from "../recipe";

/** Ricette di partenza: coprono tutti e sette gli archetipi. */
export const SEED_RECIPES: readonly Recipe[] = [
  {
    id: "pera",
    name: "Pera",
    category: "frutta",
    archetype: "lathe",
    heightCm: 10,
    params: {
      profile: [[0, 0], [0.34, 0.01], [0.62, 0.18], [0.76, 0.5], [0.72, 0.86], [0.54, 1.2], [0.37, 1.5], [0.29, 1.74], [0.2, 1.92], [0, 2]],
    },
    details: {
      stem: { length: 0.16, thickness: 0.017, bend: 0.5 },
      leaf: { count: 1, length: 0.3, width: 0.4 },
    },
  },
  {
    id: "limone",
    name: "Limone",
    category: "frutta",
    archetype: "lathe",
    heightCm: 5.5,
    pose: { tiltDeg: 70 },
    params: {
      profile: [[0, 0], [0.07, 0.04], [0.16, 0.12], [0.46, 0.4], [0.64, 0.8], [0.64, 1.24], [0.46, 1.64], [0.16, 1.92], [0.07, 2], [0, 2.04]],
    },
  },
  {
    id: "uovo",
    name: "Uovo",
    category: "uova",
    archetype: "lathe",
    heightCm: 4.5,
    pose: { tiltDeg: 65 },
    params: {
      profile: [[0, 0], [0.36, 0.06], [0.6, 0.36], [0.68, 0.76], [0.6, 1.18], [0.42, 1.5], [0.2, 1.7], [0, 1.76]],
    },
  },
  {
    id: "mela",
    name: "Mela",
    category: "frutta",
    archetype: "lathe",
    heightCm: 8,
    params: {
      profile: [[0, 0.04], [0.3, 0], [0.5, 0.1], [0.62, 0.35], [0.6, 0.62], [0.45, 0.88], [0.2, 0.97], [0, 0.88]],
    },
    details: {
      stem: { length: 0.17, thickness: 0.02, bend: 0.3 },
      leaf: { count: 1, length: 0.3, width: 0.45 },
    },
  },
  {
    id: "bottiglia-latte",
    name: "Bottiglia di latte",
    category: "latticini",
    archetype: "lathe",
    heightCm: 24,
    params: {
      smooth: false,
      profile: [[0, 0], [0.2, 0], [0.22, 0.03], [0.22, 0.55], [0.21, 0.62], [0.18, 0.7], [0.13, 0.77], [0.09, 0.83], [0.085, 0.9], [0.085, 0.93]],
    },
    details: {
      cap: { kind: "screw", height: 0.07 },
      label: { from: 0.2, to: 0.55 },
    },
  },
  {
    id: "vasetto-yogurt",
    name: "Vasetto di yogurt",
    category: "latticini",
    archetype: "lathe",
    heightCm: 7.5,
    params: {
      smooth: false,
      profile: [[0, 0], [0.3, 0], [0.33, 0.04], [0.4, 0.95], [0.43, 1], [0.43, 1.03]],
    },
    details: {
      cap: { kind: "lid", height: 0.03, radius: 0.41 },
      label: { from: 0.25, to: 0.8 },
    },
  },
  {
    id: "barattolo-vetro",
    name: "Barattolo di vetro",
    category: "conserve",
    archetype: "lathe",
    heightCm: 12,
    hatch: { density: 0.8 },
    params: {
      smooth: false,
      profile: [[0, 0], [0.4, 0], [0.42, 0.03], [0.42, 0.8], [0.38, 0.86], [0.34, 0.9], [0.34, 0.96]],
    },
    details: {
      cap: { kind: "lid", height: 0.12, radius: 0.35 },
      label: { from: 0.2, to: 0.7 },
    },
  },
  {
    id: "brick-succo",
    name: "Brick di succo",
    category: "bevande",
    archetype: "box",
    heightCm: 17,
    params: { size: [7, 17, 5], bevel: 0.1 },
    details: {
      cap: { kind: "screw", height: 0.04, offset: [0.5, 0.4] },
      label: { from: 0.3, to: 0.72 },
    },
  },
  {
    id: "vaschetta-carne",
    name: "Vaschetta di carne",
    category: "carne",
    archetype: "box",
    heightCm: 3,
    params: { size: [14, 3, 10], bevel: 0.2 },
    details: { label: { from: 0.25, to: 0.85 } },
  },
  {
    id: "pacco-pasta",
    name: "Pacco di pasta",
    category: "pasta-riso",
    archetype: "bag",
    heightCm: 25,
    params: { size: [0.45, 1, 0.16], pinch: 0.06, wrinkle: 0.25 },
  },
  {
    id: "carota",
    name: "Carota",
    category: "verdura",
    archetype: "elongated",
    heightCm: 4,
    pose: { tiltDeg: 72 },
    params: {
      radii: [[0, 0], [0.08, 0.03], [0.5, 0.06], [0.9, 0.075], [1, 0.07]],
      bend: 0.15,
    },
    details: { leaf: { count: 4, length: 0.3, width: 0.18 } },
  },
  {
    id: "lattuga",
    name: "Lattuga",
    category: "verdura",
    archetype: "leaf",
    heightCm: 14,
    params: { layout: "rosette", count: 22, width: 0.66, spread: 0.6, curl: -0.45, frill: 0.35 },
  },
  {
    id: "grappolo-uva",
    name: "Grappolo d'uva",
    category: "frutta",
    archetype: "cluster",
    heightCm: 14,
    params: { layout: "hanging", count: 38, elementRadius: 0.085, elongation: 1.15, spread: 0.7, stalk: 0.18 },
  },
  {
    id: "spicchio-parmigiano",
    name: "Spicchio di parmigiano",
    category: "formaggi",
    archetype: "wedge",
    heightCm: 8,
    params: { radius: 2.2, angleDeg: 38, bulge: 0.06, rind: true },
  },
];
