import type { Recipe } from "../recipe";

/** Carne, salumi e pesce (id con prefisso cp-). */
export const carnePesceRecipes: readonly Recipe[] = [
  {
    id: "cp-petto-pollo-vaschetta", name: "Petto di pollo in vaschetta", category: "carne", archetype: "box", heightCm: 4,
    params: { size: [16, 4, 11], bevel: 0.2 },
    details: { label: { from: 0.25, to: 0.85 } },
  },
  {
    id: "cp-cosce-pollo-vaschetta", name: "Cosce di pollo in vaschetta", category: "carne", archetype: "box", heightCm: 5,
    params: { size: [19, 5, 12], bevel: 0.15 },
    details: { label: { from: 0.2, to: 0.8, signal: true } },
  },
  {
    id: "cp-pollo-intero", name: "Pollo intero", category: "carne", archetype: "lathe", heightCm: 14,
    pose: { tiltDeg: 55 },
    params: { profile: [[0, 0], [0.4, 0.06], [0.7, 0.3], [0.78, 0.65], [0.65, 1.0], [0.4, 1.3], [0.2, 1.5], [0.12, 1.65], [0, 1.72]] },
  },
  {
    id: "cp-macinato-vaschetta", name: "Macinato in vaschetta", category: "carne", archetype: "box", heightCm: 4,
    params: { size: [14, 4, 10], bevel: 0.3 },
    details: { label: { from: 0.3, to: 0.9 } },
  },
  {
    id: "cp-bistecca-vaschetta", name: "Bistecca in vaschetta", category: "carne", archetype: "box", heightCm: 3.5,
    params: { size: [15, 3.5, 12], bevel: 0.12 },
    details: { label: { from: 0.2, to: 0.8 } },
  },
  {
    id: "cp-hamburger-medaglione", name: "Hamburger, medaglione", category: "carne", archetype: "lathe", heightCm: 2.5,
    params: { profile: [[0, 0], [1.6, 0], [2.1, 0.12], [2.3, 0.5], [2.1, 0.88], [1.6, 1], [0, 1]], segments: 40 },
    hatch: { density: 1.2 },
  },
  {
    id: "cp-salsiccia", name: "Salsiccia", category: "carne", archetype: "elongated", heightCm: 3.5,
    pose: { tiltDeg: 82 },
    params: { radii: [[0, 0.02], [0.05, 0.09], [0.3, 0.1], [0.7, 0.1], [0.95, 0.09], [1, 0.02]], bend: 0.55, wobble: 0.05 },
  },
  {
    id: "cp-wurstel-confezione", name: "Wurstel in confezione", category: "carne", archetype: "bag", heightCm: 18,
    params: { size: [0.6, 1, 0.14], pinch: 0.07, wrinkle: 0.2 },
  },
  {
    id: "cp-arrosto-legato", name: "Arrosto legato", category: "carne", archetype: "elongated", heightCm: 9,
    pose: { tiltDeg: 80 },
    params: { radii: [[0, 0.1], [0.08, 0.2], [0.3, 0.23], [0.5, 0.2], [0.75, 0.23], [0.95, 0.2], [1, 0.1]], ratio: 0.85, wobble: 0.08 },
  },
  {
    id: "cp-costine", name: "Costine", category: "carne", archetype: "box", heightCm: 3,
    params: { size: [18, 3, 9], bevel: 0.1 },
    details: { label: { from: 0.2, to: 0.7, signal: true } },
  },
  {
    id: "cp-prosciutto-cotto-vaschetta", name: "Prosciutto cotto a fette in vaschetta", category: "carne", archetype: "box", heightCm: 2.5,
    params: { size: [13, 2.5, 9], bevel: 0.12 },
    details: { label: { from: 0.2, to: 0.85 } },
  },
  {
    id: "cp-prosciutto-crudo-vaschetta", name: "Prosciutto crudo a fette in vaschetta", category: "carne", archetype: "box", heightCm: 2.2,
    params: { size: [15, 2.2, 10], bevel: 0.05 },
    details: { label: { from: 0.15, to: 0.8, signal: true } },
  },
  {
    id: "cp-salame-intero", name: "Salame intero", category: "carne", archetype: "elongated", heightCm: 7,
    pose: { tiltDeg: 84 },
    params: { radii: [[0, 0.06], [0.04, 0.13], [0.2, 0.15], [0.5, 0.16], [0.8, 0.15], [0.96, 0.13], [1, 0.06]], bend: 0.1, wobble: 0.04 },
    details: { stem: { length: 0.08, thickness: 0.008, bend: 0.5 } },
  },
  {
    id: "cp-salame-fette-vaschetta", name: "Salame a fette in vaschetta", category: "carne", archetype: "box", heightCm: 2,
    params: { size: [12, 2, 12], bevel: 0.3 },
    details: { label: { from: 0.2, to: 0.8 } },
  },
  {
    id: "cp-mortadella-fette", name: "Mortadella a fette", category: "carne", archetype: "lathe", heightCm: 4,
    params: { smooth: false, profile: [[0, 0], [1.25, 0], [1.35, 0.08], [1.45, 0.9], [1.5, 1], [1.5, 1.05]] },
    details: { cap: { kind: "lid", height: 0.05, radius: 1.45 }, label: { from: 0.2, to: 0.75 } },
  },
  {
    id: "cp-bresaola", name: "Bresaola", category: "carne", archetype: "elongated", heightCm: 6,
    pose: { tiltDeg: 80 },
    params: { radii: [[0, 0.08], [0.1, 0.14], [0.45, 0.17], [0.8, 0.13], [1, 0.05]], ratio: 0.75, wobble: 0.04 },
  },
  {
    id: "cp-pancetta-cubetti-vaschetta", name: "Pancetta a cubetti in vaschetta", category: "carne", archetype: "box", heightCm: 3,
    params: { size: [10, 3, 7], bevel: 0.2 },
    details: { label: { from: 0.2, to: 0.85, signal: true } },
  },
  {
    id: "cp-speck-trancio", name: "Speck in trancio", category: "carne", archetype: "elongated", heightCm: 8,
    pose: { tiltDeg: 78 },
    params: { radii: [[0, 0.1], [0.06, 0.18], [0.4, 0.2], [0.85, 0.17], [1, 0.1]], ratio: 0.6, bend: -0.1, wobble: 0.03 },
  },
  {
    id: "cp-salmone-filetto-vaschetta", name: "Filetto di salmone in vaschetta", category: "pesce", archetype: "box", heightCm: 3,
    params: { size: [15, 3, 9], bevel: 0.15 },
    details: { label: { from: 0.2, to: 0.8 } },
  },
  {
    id: "cp-tonno-trancio", name: "Trancio di tonno", category: "pesce", archetype: "lathe", heightCm: 3,
    params: { profile: [[0, 0], [1.6, 0], [2.1, 0.1], [2.3, 0.5], [2.1, 0.9], [1.6, 1], [0, 1]], segments: 36 },
    hatch: { density: 1.3 },
  },
  {
    id: "cp-pesce-intero-orata", name: "Pesce intero, orata", category: "pesce", archetype: "fish", heightCm: 9,
    params: { bodyHeight: 0.34, thickness: 0.14, tail: 0.22, dorsal: 0.7, snout: 0.55 },
  },
  {
    id: "cp-gamberi-vaschetta", name: "Gamberi in vaschetta", category: "pesce", archetype: "cluster", heightCm: 4,
    params: { layout: "heap", count: 14, elementRadius: 0.13, elongation: 1.5, spread: 0.8 },
  },
  {
    id: "cp-cozze-retina", name: "Cozze in retina", category: "pesce", archetype: "bag", heightCm: 14,
    params: { size: [1, 1, 0.55], pinch: 0.1, wrinkle: 0.6 },
  },
  {
    id: "cp-calamaro", name: "Calamaro", category: "pesce", archetype: "elongated", heightCm: 4,
    pose: { tiltDeg: 80 },
    params: { radii: [[0, 0.01], [0.15, 0.08], [0.5, 0.1], [0.8, 0.08], [1, 0.06]], ratio: 0.8, wobble: 0.02 },
    details: { leaf: { count: 5, length: 0.25, width: 0.15 } },
  },
  {
    id: "cp-tonno-scatoletta", name: "Tonno in scatoletta", category: "pesce", archetype: "lathe", heightCm: 4,
    params: { smooth: false, profile: [[0, 0], [1.2, 0], [1.25, 0.05], [1.25, 0.95], [1.2, 1], [0, 1]] },
    details: { label: { from: 0.15, to: 0.85, signal: true } },
  },
  {
    id: "cp-sgombro-scatoletta", name: "Sgombro in scatoletta", category: "pesce", archetype: "box", heightCm: 3,
    params: { size: [11, 3, 7], bevel: 0.1 },
    details: { cap: { kind: "lid", height: 0.04, offset: [0, 0] }, label: { from: 0.2, to: 0.8 } },
  },
  {
    id: "cp-bastoncini-pesce-scatola", name: "Bastoncini di pesce in scatola", category: "pesce", archetype: "box", heightCm: 14,
    params: { size: [9, 14, 4], bevel: 0 },
    details: { label: { from: 0.15, to: 0.85, signal: true } },
  },
  {
    id: "cp-salmone-affumicato-busta", name: "Salmone affumicato in busta piatta", category: "pesce", archetype: "bag", heightCm: 16,
    params: { size: [12, 16, 0.8], pinch: 0.08, wrinkle: 0.15 },
  },
];

