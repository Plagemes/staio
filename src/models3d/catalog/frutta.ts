import type { Recipe } from "../recipe";

/** Profilo di un ellissoide: `w` = metà larghezza relativa all'altezza (0.5 = sfera). */
function ball(w: number): [number, number][] {
  return [0, 22, 45, 70, 90, 110, 135, 158, 180].map((deg) => {
    const a = (deg * Math.PI) / 180;
    return [Math.round(w * Math.sin(a) * 1000) / 1000, Math.round(((1 - Math.cos(a)) / 2) * 1000) / 1000];
  });
}

/** Ricette della frutta fresca (prefisso fr-). */
export const fruttaRecipes: readonly Recipe[] = [
  // Mele: tre sagome diverse (conica, tonda, bassa e larga).
  {
    id: "fr-mela-golden", name: "Mela golden", category: "frutta", archetype: "lathe", heightCm: 8.5,
    params: { profile: [[0, 0.04], [0.28, 0], [0.46, 0.1], [0.58, 0.38], [0.55, 0.68], [0.4, 0.9], [0.18, 0.98], [0, 0.9]] },
    details: { stem: { length: 0.17, thickness: 0.02, bend: 0.3 }, leaf: { count: 1, length: 0.3, width: 0.45 } },
  },
  {
    id: "fr-mela-rossa", name: "Mela rossa", category: "frutta", archetype: "lathe", heightCm: 7.5,
    params: { profile: [[0, 0.05], [0.35, 0], [0.58, 0.12], [0.68, 0.4], [0.64, 0.68], [0.48, 0.88], [0.2, 0.95], [0, 0.86]] },
    details: { stem: { length: 0.2, thickness: 0.022, bend: -0.3 } },
  },
  {
    id: "fr-mela-verde", name: "Mela verde", category: "frutta", archetype: "lathe", heightCm: 6.5,
    params: { profile: [[0, 0.06], [0.45, 0], [0.8, 0.1], [0.95, 0.4], [0.88, 0.72], [0.6, 0.92], [0.25, 0.98], [0, 0.88]] },
    details: { stem: { length: 0.15, thickness: 0.026, bend: 0.2 }, leaf: { count: 1, length: 0.3, width: 0.5 } },
  },
  // Pere
  {
    id: "fr-pera-abate", name: "Pera abate", category: "frutta", archetype: "lathe", heightCm: 14,
    params: { profile: [[0, 0], [0.3, 0.01], [0.52, 0.12], [0.62, 0.35], [0.56, 0.62], [0.4, 0.95], [0.28, 1.3], [0.22, 1.65], [0.15, 1.9], [0, 1.98]] },
    details: { stem: { length: 0.2, thickness: 0.016, bend: 0.5 }, leaf: { count: 1, length: 0.28, width: 0.4 } },
  },
  {
    id: "fr-pera-decana", name: "Pera decana", category: "frutta", archetype: "lathe", heightCm: 9,
    params: { profile: [[0, 0], [0.4, 0.02], [0.68, 0.2], [0.78, 0.5], [0.66, 0.85], [0.46, 1.1], [0.34, 1.3], [0.2, 1.42], [0, 1.46]] },
    details: { stem: { length: 0.2, thickness: 0.02, bend: -0.5 } },
  },
  // Agrumi
  {
    id: "fr-arancia", name: "Arancia", category: "frutta", archetype: "lathe", heightCm: 7.5,
    params: { profile: ball(0.52) },
    details: { stem: { length: 0.03, thickness: 0.03, bend: 0 }, leaf: { count: 1, length: 0.25, width: 0.5 } },
  },
  {
    id: "fr-mandarino", name: "Mandarino", category: "frutta", archetype: "lathe", heightCm: 5.5,
    params: { profile: [[0, 0.02], [0.3, 0], [0.55, 0.1], [0.66, 0.4], [0.62, 0.72], [0.42, 0.92], [0.14, 0.96], [0, 1]] },
    details: { stem: { length: 0.05, thickness: 0.03, bend: 0.3 }, leaf: { count: 2, length: 0.28, width: 0.5 } },
  },
  {
    id: "fr-clementina", name: "Clementina", category: "frutta", archetype: "lathe", heightCm: 4.8,
    params: { profile: ball(0.6) },
    details: { leaf: { count: 1, length: 0.3, width: 0.5 } },
  },
  {
    id: "fr-pompelmo", name: "Pompelmo", category: "frutta", archetype: "lathe", heightCm: 11, hatch: { density: 0.9 },
    params: { profile: [[0, 0.03], [0.3, 0], [0.5, 0.1], [0.58, 0.45], [0.55, 0.78], [0.38, 0.96], [0.15, 1], [0, 0.98]] },
  },
  {
    id: "fr-lime", name: "Lime", category: "frutta", archetype: "lathe", heightCm: 4, pose: { tiltDeg: 65 },
    params: { profile: [[0, 0], [0.08, 0.03], [0.34, 0.2], [0.5, 0.5], [0.5, 0.85], [0.34, 1.15], [0.1, 1.3], [0.05, 1.34], [0, 1.36]] },
  },
  // Frutti a nocciolo
  {
    id: "fr-pesca", name: "Pesca", category: "frutta", archetype: "lathe", heightCm: 7,
    params: { profile: [[0, 0.03], [0.3, 0], [0.55, 0.1], [0.66, 0.4], [0.6, 0.72], [0.38, 0.92], [0.14, 0.97], [0, 0.88]] },
    details: { stem: { length: 0.06, thickness: 0.02, bend: 0.3 }, leaf: { count: 2, length: 0.5, width: 0.28 } },
  },
  {
    id: "fr-nettarina", name: "Nettarina", category: "frutta", archetype: "lathe", heightCm: 6.5, hatch: { density: 0.8 },
    params: { profile: [[0, 0.02], [0.32, 0], [0.56, 0.12], [0.62, 0.45], [0.52, 0.78], [0.3, 0.96], [0, 1]] },
    details: { stem: { length: 0.07, thickness: 0.02, bend: -0.3 } },
  },
  {
    id: "fr-albicocca", name: "Albicocca", category: "frutta", archetype: "lathe", heightCm: 4.5,
    params: { profile: [[0, 0.02], [0.3, 0], [0.52, 0.12], [0.6, 0.45], [0.5, 0.8], [0.28, 0.97], [0, 0.92]] },
    details: { stem: { length: 0.08, thickness: 0.025, bend: 0.4 } },
  },
  {
    id: "fr-prugna", name: "Prugna", category: "frutta", archetype: "lathe", heightCm: 4, pose: { tiltDeg: 20 },
    params: { profile: [[0, 0], [0.22, 0.02], [0.4, 0.12], [0.5, 0.32], [0.5, 0.6], [0.42, 0.85], [0.26, 1.02], [0.12, 1.1], [0, 1.12]] },
    details: { stem: { length: 0.1, thickness: 0.02, bend: 0.4 } },
  },
  {
    id: "fr-susina", name: "Susina", category: "frutta", archetype: "lathe", heightCm: 4.5,
    params: { profile: ball(0.5) },
    details: { stem: { length: 0.14, thickness: 0.02, bend: 0.5 }, leaf: { count: 1, length: 0.3, width: 0.45 } },
  },
  {
    id: "fr-ciliegia", name: "Ciliegia", category: "frutta", archetype: "lathe", heightCm: 2,
    params: { profile: [[0, 0], [0.4, 0.04], [0.65, 0.3], [0.66, 0.65], [0.42, 0.93], [0.12, 0.96], [0, 0.88]] },
    details: { stem: { length: 0.5, thickness: 0.012, bend: 0.6 }, leaf: { count: 1, length: 0.3, width: 0.4 } },
  },
  // Bacche
  {
    id: "fr-fragola", name: "Fragola", category: "frutta", archetype: "lathe", heightCm: 3.5, hatch: { density: 1.2 },
    params: { profile: [[0, 0], [0.18, 0.06], [0.42, 0.26], [0.57, 0.5], [0.6, 0.72], [0.48, 0.9], [0.24, 0.98], [0, 0.94]] },
    details: { stem: { length: 0.12, thickness: 0.02, bend: 0.3 }, leaf: { count: 5, length: 0.32, width: 0.5 } },
  },
  {
    id: "fr-lampone", name: "Lamponi", category: "frutta", archetype: "cluster", heightCm: 3,
    params: { layout: "heap", count: 22, elementRadius: 0.11, elongation: 0.9, spread: 0.45 },
  },
  {
    id: "fr-mirtillo", name: "Mirtilli", category: "frutta", archetype: "cluster", heightCm: 2.5,
    params: { layout: "heap", count: 14, elementRadius: 0.17, elongation: 0.85, spread: 0.6 },
  },
  {
    id: "fr-mora", name: "More", category: "frutta", archetype: "cluster", heightCm: 3,
    params: { layout: "heap", count: 18, elementRadius: 0.1, elongation: 1.3, spread: 0.35 },
  },
  {
    id: "fr-ribes", name: "Ribes", category: "frutta", archetype: "cluster", heightCm: 6,
    params: { layout: "truss", count: 12, elementRadius: 0.07, elongation: 1, spread: 0.3, stalk: 0.35 },
  },
  {
    id: "fr-uva-bianca", name: "Uva bianca", category: "frutta", archetype: "cluster", heightCm: 14,
    params: { layout: "hanging", count: 34, elementRadius: 0.085, elongation: 1.3, spread: 0.55, stalk: 0.2 },
  },
  {
    id: "fr-uva-nera", name: "Uva nera", category: "frutta", archetype: "cluster", heightCm: 12,
    params: { layout: "hanging", count: 46, elementRadius: 0.07, elongation: 1, spread: 0.85, stalk: 0.14 },
  },
  // Frutti allungati e tropicali
  {
    id: "fr-banana", name: "Banana", category: "frutta", archetype: "elongated", heightCm: 5, pose: { tiltDeg: 80 },
    params: { radii: [[0, 0.04], [0.08, 0.07], [0.45, 0.1], [0.85, 0.085], [0.95, 0.045], [1, 0.03]], bend: 0.6, ratio: 0.92, wobble: 0.02 },
    details: { stem: { length: 0.06, thickness: 0.025, bend: 0.2 } },
  },
  {
    id: "fr-kiwi", name: "Kiwi", category: "frutta", archetype: "lathe", heightCm: 5, pose: { tiltDeg: 65 }, hatch: { density: 1.3 },
    params: { profile: [[0, 0], [0.3, 0.03], [0.52, 0.2], [0.58, 0.55], [0.52, 0.95], [0.3, 1.25], [0.14, 1.34], [0, 1.36]] },
  },
  {
    id: "fr-ananas", name: "Ananas", category: "frutta", archetype: "lathe", heightCm: 32, hatch: { density: 1.4 },
    params: { profile: [[0, 0], [0.18, 0.01], [0.27, 0.08], [0.3, 0.4], [0.28, 0.75], [0.2, 0.93], [0.08, 0.99], [0, 1]] },
    details: { leaf: { count: 5, length: 0.4, width: 0.15 } },
  },
  {
    id: "fr-mango", name: "Mango", category: "frutta", archetype: "elongated", heightCm: 8, pose: { tiltDeg: 80 },
    params: { radii: [[0, 0.03], [0.1, 0.2], [0.4, 0.3], [0.7, 0.29], [0.92, 0.2], [1, 0.1]], bend: 0.2, ratio: 0.75, wobble: 0.02 },
    details: { stem: { length: 0.05, thickness: 0.03, bend: 0.3 } },
  },
  {
    id: "fr-papaya", name: "Papaya", category: "frutta", archetype: "elongated", heightCm: 12, pose: { tiltDeg: 80 },
    params: { radii: [[0, 0.08], [0.15, 0.2], [0.5, 0.26], [0.85, 0.16], [1, 0.06]], bend: 0.1, ratio: 1, wobble: 0.03 },
    details: { stem: { length: 0.06, thickness: 0.03, bend: 0.2 } },
  },
  {
    id: "fr-melone", name: "Melone", category: "frutta", archetype: "lathe", heightCm: 16, hatch: { density: 1.1 },
    params: { profile: ball(0.54) },
    details: { stem: { length: 0.06, thickness: 0.03, bend: 0.4 } },
  },
  {
    id: "fr-anguria", name: "Anguria", category: "frutta", archetype: "lathe", heightCm: 25, pose: { tiltDeg: 75 },
    params: { profile: [[0, 0], [0.22, 0.02], [0.4, 0.1], [0.5, 0.3], [0.52, 0.7], [0.5, 1.1], [0.4, 1.3], [0.22, 1.38], [0, 1.4]] },
    details: { stem: { length: 0.04, thickness: 0.02, bend: 0 } },
  },
  {
    id: "fr-anguria-fetta", name: "Anguria a fetta", category: "frutta", archetype: "wedge", heightCm: 5,
    params: { radius: 2.6, angleDeg: 62, bulge: 0.12, rind: true },
  },
  {
    id: "fr-melone-fetta", name: "Melone a fetta", category: "frutta", archetype: "wedge", heightCm: 4,
    params: { radius: 3.2, angleDeg: 28, bulge: 0.08, rind: true },
  },
  {
    id: "fr-fico", name: "Fico", category: "frutta", archetype: "lathe", heightCm: 5.5,
    params: { profile: [[0, 0.03], [0.2, 0], [0.4, 0.1], [0.52, 0.3], [0.5, 0.52], [0.36, 0.75], [0.2, 0.92], [0.08, 1]] },
    details: { stem: { length: 0.12, thickness: 0.03, bend: 0.4 } },
  },
  {
    id: "fr-cachi", name: "Cachi", category: "frutta", archetype: "lathe", heightCm: 7,
    params: { profile: [[0, 0.02], [0.4, 0], [0.7, 0.1], [0.82, 0.4], [0.76, 0.7], [0.55, 0.9], [0.2, 0.98], [0, 0.96]] },
    details: { stem: { length: 0.06, thickness: 0.03, bend: 0.2 }, leaf: { count: 4, length: 0.45, width: 0.5 } },
  },
  {
    id: "fr-melagrana", name: "Melagrana", category: "frutta", archetype: "lathe", heightCm: 8.5,
    params: { profile: [[0, 0], [0.3, 0.01], [0.5, 0.12], [0.58, 0.4], [0.55, 0.7], [0.4, 0.88], [0.28, 0.93], [0.31, 1], [0.2, 1.05]] },
  },
  {
    id: "fr-avocado", name: "Avocado", category: "frutta", archetype: "lathe", heightCm: 12, hatch: { density: 1.2 },
    params: { profile: [[0, 0], [0.34, 0.02], [0.6, 0.18], [0.72, 0.45], [0.62, 0.75], [0.42, 0.95], [0.26, 1.08], [0.14, 1.14], [0, 1.16]] },
    details: { stem: { length: 0.06, thickness: 0.03, bend: 0.3 } },
  },
  {
    id: "fr-cocco", name: "Cocco", category: "frutta", archetype: "lathe", heightCm: 14, hatch: { density: 1.5 },
    params: { profile: [[0, 0], [0.22, 0.02], [0.38, 0.1], [0.47, 0.28], [0.5, 0.5], [0.46, 0.74], [0.34, 0.91], [0.16, 0.99], [0, 1.02]] },
  },
  {
    id: "fr-dattero-fresco", name: "Dattero fresco", category: "frutta", archetype: "lathe", heightCm: 2.2, pose: { tiltDeg: 75 },
    params: { profile: [[0, 0], [0.2, 0.02], [0.42, 0.12], [0.5, 0.4], [0.5, 1.0], [0.42, 1.3], [0.2, 1.46], [0, 1.5]] },
    details: { stem: { length: 0.08, thickness: 0.03, bend: 0.4 } },
  },
  {
    id: "fr-nespola", name: "Nespola", category: "frutta", archetype: "lathe", heightCm: 4,
    params: { profile: [[0, 0], [0.22, 0.03], [0.44, 0.2], [0.55, 0.5], [0.5, 0.78], [0.38, 0.93], [0.3, 0.97], [0.34, 1.03], [0.22, 1.06]] },
  },
  {
    id: "fr-limone-spicchio", name: "Limone a spicchio", category: "frutta", archetype: "wedge", heightCm: 1.4,
    params: { radius: 2.8, angleDeg: 60, bulge: 0.14, rind: true },
  },
  {
    id: "fr-arancia-meta", name: "Arancia a metà", category: "frutta", archetype: "lathe", heightCm: 3.8,
    params: { profile: [[0, 0], [0.34, 0.06], [0.64, 0.23], [0.87, 0.5], [0.97, 0.74], [1, 1]] },
  },
  {
    id: "fr-frutto-passione", name: "Frutto della passione", category: "frutta", archetype: "lathe", heightCm: 5,
    params: { profile: [[0, 0], [0.24, 0.02], [0.4, 0.12], [0.48, 0.3], [0.5, 0.55], [0.44, 0.8], [0.3, 0.94], [0.12, 0.99], [0, 0.97]] },
    details: { stem: { length: 0.1, thickness: 0.02, bend: 0.5 } },
  },
  {
    id: "fr-litchi", name: "Litchi", category: "frutta", archetype: "cluster", heightCm: 8, hatch: { density: 1.4 },
    params: { layout: "truss", count: 6, elementRadius: 0.15, elongation: 1.1, spread: 0.4, stalk: 0.3 },
  },
  {
    id: "fr-fico-d-india", name: "Fico d'India", category: "frutta", archetype: "lathe", heightCm: 5, pose: { tiltDeg: 70 }, hatch: { density: 1.3 },
    params: { profile: [[0, 0], [0.24, 0.02], [0.42, 0.14], [0.5, 0.45], [0.48, 0.95], [0.4, 1.25], [0.5, 1.32], [0.3, 1.38]] },
  },
  {
    id: "fr-mela-cotogna", name: "Mela cotogna", category: "frutta", archetype: "lathe", heightCm: 9,
    params: { profile: [[0, 0.03], [0.34, 0], [0.62, 0.1], [0.7, 0.32], [0.58, 0.55], [0.5, 0.75], [0.52, 0.9], [0.3, 0.98], [0, 0.93]] },
    details: { leaf: { count: 2, length: 0.3, width: 0.5 } },
  },
];
