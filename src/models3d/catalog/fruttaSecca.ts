import type { Recipe } from "../recipe";

/** Ricette della frutta secca e a guscio (prefisso fs-). */
export const fruttaSeccaRecipes: readonly Recipe[] = [
  {
    id: "fs-noce", name: "Noce", category: "frutta", archetype: "lathe", heightCm: 3.5, hatch: { density: 1.5 },
    params: { profile: [[0, 0], [0.28, 0.03], [0.46, 0.18], [0.5, 0.45], [0.42, 0.72], [0.24, 0.92], [0.08, 1], [0, 1.02]] },
  },
  {
    id: "fs-nocciola", name: "Nocciola", category: "frutta", archetype: "lathe", heightCm: 1.6,
    params: { profile: [[0.3, 0], [0.46, 0.15], [0.5, 0.4], [0.44, 0.7], [0.28, 0.92], [0.06, 1], [0, 1.05]] },
  },
  {
    id: "fs-mandorla", name: "Mandorla", category: "frutta", archetype: "elongated", heightCm: 1, pose: { tiltDeg: 80 },
    params: { radii: [[0, 0.02], [0.12, 0.16], [0.45, 0.27], [0.75, 0.2], [1, 0]], ratio: 0.55, wobble: 0.03 },
  },
  {
    id: "fs-pistacchio", name: "Pistacchio", category: "frutta", archetype: "elongated", heightCm: 1.2, pose: { tiltDeg: 80 },
    params: { radii: [[0, 0.1], [0.15, 0.28], [0.6, 0.36], [0.9, 0.25], [1, 0.03]], ratio: 0.8, wobble: 0.06 },
  },
  {
    id: "fs-arachide", name: "Arachide", category: "frutta", archetype: "lathe", heightCm: 1.8, pose: { tiltDeg: 80 }, hatch: { density: 1.3 },
    params: { profile: [[0, 0], [0.25, 0.03], [0.38, 0.12], [0.4, 0.25], [0.31, 0.4], [0.29, 0.5], [0.31, 0.6], [0.4, 0.75], [0.38, 0.88], [0.25, 0.97], [0, 1]] },
  },
  {
    id: "fs-anacardo", name: "Anacardo", category: "frutta", archetype: "elongated", heightCm: 1.2, pose: { tiltDeg: 80 },
    params: { radii: [[0, 0.08], [0.2, 0.2], [0.6, 0.26], [0.9, 0.2], [1, 0.06]], bend: 0.9, ratio: 0.8, wobble: 0.03 },
  },
  {
    id: "fs-castagna", name: "Castagna", category: "frutta", archetype: "lathe", heightCm: 3,
    params: { profile: [[0, 0], [0.4, 0.02], [0.6, 0.12], [0.66, 0.4], [0.56, 0.75], [0.32, 0.95], [0.1, 1], [0, 1.02]] },
  },
  {
    id: "fs-pinolo", name: "Pinoli", category: "frutta", archetype: "cluster", heightCm: 2,
    params: { layout: "mound", count: 200, elementRadius: 0.03, elongation: 1.6, spread: 0.9 },
  },
  {
    id: "fs-uvetta", name: "Uvetta", category: "frutta", archetype: "cluster", heightCm: 3,
    params: { layout: "mound", count: 160, elementRadius: 0.035, elongation: 0.8, spread: 0.9 },
  },
  {
    id: "fs-dattero-secco", name: "Dattero secco", category: "frutta", archetype: "elongated", heightCm: 2, pose: { tiltDeg: 80 },
    params: { radii: [[0, 0.12], [0.1, 0.22], [0.5, 0.27], [0.9, 0.22], [1, 0.12]], ratio: 0.8, wobble: 0.08 },
  },
  {
    id: "fs-fico-secco", name: "Fico secco", category: "frutta", archetype: "lathe", heightCm: 4,
    params: { profile: [[0, 0.02], [0.3, 0], [0.55, 0.1], [0.62, 0.3], [0.5, 0.55], [0.3, 0.8], [0.15, 0.95], [0.1, 1]] },
    details: { stem: { length: 0.1, thickness: 0.03, bend: 0.3 } },
  },
  {
    id: "fs-prugna-secca", name: "Prugna secca", category: "frutta", archetype: "elongated", heightCm: 3, pose: { tiltDeg: 78 },
    params: { radii: [[0, 0.1], [0.1, 0.25], [0.5, 0.3], [0.9, 0.24], [1, 0.1]], ratio: 0.85, wobble: 0.1 },
  },
  {
    id: "fs-albicocca-secca", name: "Albicocca secca", category: "frutta", archetype: "lathe", heightCm: 1.5,
    params: { profile: [[0, 0], [0.9, 0.06], [1.4, 0.3], [1.5, 0.55], [1.2, 0.85], [0.6, 0.98], [0, 1]] },
  },
  {
    id: "fs-cocco-grattugiato", name: "Cocco grattugiato in sacchetto", category: "dispensa", archetype: "bag", heightCm: 20,
    params: { size: [0.5, 1, 0.18], pinch: 0.1, wrinkle: 0.45 },
  },
  {
    id: "fs-mix-sacchetto", name: "Mix di frutta secca in sacchetto", category: "dispensa", archetype: "bag", heightCm: 18,
    params: { size: [0.58, 1, 0.2], pinch: 0.07, wrinkle: 0.6 },
  },
];
