import type { CompositeChild, Recipe } from "../recipe";

/** Uovo in piedi, per le confezioni: altezza 1, largo circa 0.8. */
const EGG: CompositeChild = {
  archetype: "lathe",
  params: { profile: [[0, 0], [0.22, 0.03], [0.36, 0.2], [0.4, 0.5], [0.33, 0.78], [0.18, 0.95], [0, 1]] },
  color: { main: "#f1dcc0" },
};

/** Portauova di cartone pressato, per le confezioni. */
const CARTON_COLOR = { main: "#d6c3a2" } as const;

/** Latticini, formaggi e uova (id con prefisso lt-). */
export const latticiniRecipes: readonly Recipe[] = [
  {
    id: "lt-latte-bottiglia-plastica", name: "Latte in bottiglia di plastica", category: "latticini", archetype: "lathe", heightCm: 26,
    params: { smooth: false, profile: [[0, 0], [0.2, 0], [0.22, 0.03], [0.22, 0.6], [0.2, 0.68], [0.12, 0.78], [0.08, 0.84], [0.08, 0.93]] },
    details: { cap: { kind: "screw", height: 0.06 }, label: { from: 0.15, to: 0.55 } },
  },
  {
    id: "lt-latte-brick", name: "Latte in brick", category: "latticini", archetype: "box", heightCm: 19,
    params: { size: [7, 19, 7], bevel: 0.06 },
    details: { cap: { kind: "screw", height: 0.03, offset: [0.55, 0.3] }, label: { from: 0.3, to: 0.7 } },
  },
  {
    id: "lt-latte-bottiglia-vetro", name: "Latte in bottiglia di vetro", category: "latticini", archetype: "lathe", heightCm: 23,
    hatch: { density: 0.6, cross: false },
    params: { smooth: false, profile: [[0, 0], [0.16, 0], [0.18, 0.03], [0.18, 0.62], [0.17, 0.7], [0.1, 0.8], [0.07, 0.88], [0.07, 0.97], [0.08, 1]] },
    details: { cap: { kind: "lid", height: 0.04, radius: 0.09 }, label: { from: 0.2, to: 0.5 } },
  },
  {
    id: "lt-panna-brick-piccolo", name: "Panna in brick piccolo", category: "latticini", archetype: "box", heightCm: 12,
    params: { size: [5, 12, 3.5], bevel: 0.08 },
    details: { cap: { kind: "screw", height: 0.03, offset: [0.6, 0] }, label: { from: 0.25, to: 0.7 } },
  },
  {
    id: "lt-yogurt-vasetto-singolo", name: "Yogurt, vasetto singolo", category: "latticini", archetype: "lathe", heightCm: 7,
    params: { smooth: false, profile: [[0, 0], [0.35, 0], [0.4, 0.04], [0.52, 0.95], [0.56, 1], [0.56, 1.03]] },
    details: { cap: { kind: "lid", height: 0.03, radius: 0.54 }, label: { from: 0.2, to: 0.75 } },
  },
  {
    id: "lt-yogurt-greco-vasetto-largo", name: "Yogurt greco, vasetto largo", category: "latticini", archetype: "lathe", heightCm: 6.5,
    params: { smooth: false, profile: [[0, 0], [0.9, 0], [0.98, 0.06], [1.1, 0.95], [1.14, 1], [1.14, 1.04]] },
    details: { cap: { kind: "lid", height: 0.05, radius: 1.1 }, label: { from: 0.2, to: 0.8, signal: true } },
  },
  {
    id: "lt-yogurt-da-bere", name: "Yogurt da bere", category: "latticini", archetype: "lathe", heightCm: 13,
    params: { smooth: false, profile: [[0, 0], [0.28, 0], [0.3, 0.04], [0.3, 0.7], [0.25, 0.8], [0.16, 0.88], [0.14, 0.95]] },
    details: { cap: { kind: "screw", height: 0.08, signal: true }, label: { from: 0.15, to: 0.62 } },
  },
  {
    id: "lt-burro-panetto", name: "Burro, panetto", category: "latticini", archetype: "box", heightCm: 4,
    params: { size: [9, 4, 5], bevel: 0.05 },
    details: { label: { from: 0.1, to: 0.9 } },
  },
  {
    id: "lt-mozzarella-palla", name: "Mozzarella, palla", category: "formaggi", archetype: "lathe", heightCm: 8,
    params: { profile: [[0, 0], [0.5, 0.03], [0.88, 0.25], [1, 0.55], [0.9, 0.85], [0.5, 1.02], [0, 1.05]] },
    hatch: { density: 0.7 },
  },
  {
    id: "lt-mozzarella-busta", name: "Mozzarella in busta", category: "formaggi", archetype: "bag", heightCm: 11,
    params: { size: [1.2, 1, 0.8], pinch: 0.1, wrinkle: 0.45 },
  },
  {
    id: "lt-burrata", name: "Burrata", category: "formaggi", archetype: "lathe", heightCm: 10,
    hatch: { density: 0.7 },
    params: { profile: [[0, 0], [0.45, 0.02], [0.85, 0.2], [0.95, 0.5], [0.8, 0.8], [0.4, 0.95], [0.2, 1.05], [0.16, 1.2], [0.24, 1.28], [0, 1.3]] },
  },
  {
    id: "lt-ricotta-cestello", name: "Ricotta in cestello", category: "formaggi", archetype: "lathe", heightCm: 8,
    params: { smooth: false, profile: [[0, 0], [0.7, 0], [0.75, 0.04], [0.95, 0.95], [1, 1], [0.7, 1.12], [0, 1.15]] },
    details: { label: { from: 0.3, to: 0.7 } },
  },
  {
    id: "lt-mascarpone-vaschetta", name: "Mascarpone in vaschetta", category: "formaggi", archetype: "lathe", heightCm: 5.5,
    params: { smooth: false, profile: [[0, 0], [1.3, 0], [1.38, 0.06], [1.45, 0.95], [1.5, 1], [1.5, 1.05]] },
    details: { cap: { kind: "lid", height: 0.06, radius: 1.45 }, label: { from: 0.25, to: 0.8 } },
  },
  {
    id: "lt-stracchino", name: "Stracchino", category: "formaggi", archetype: "box", heightCm: 3,
    params: { size: [11, 3, 11], bevel: 0.12 },
    details: { label: { from: 0.15, to: 0.85 } },
  },
  {
    id: "lt-gorgonzola-spicchio", name: "Gorgonzola a spicchio", category: "formaggi", archetype: "wedge", heightCm: 9,
    params: { radius: 1.6, angleDeg: 45, bulge: 0.12, rind: true },
  },
  {
    id: "lt-parmigiano-spicchio-alto", name: "Parmigiano a spicchio alto", category: "formaggi", archetype: "wedge", heightCm: 10,
    params: { radius: 1.3, angleDeg: 70, bulge: 0.1, rind: true },
  },
  {
    id: "lt-grana-grattugiato-busta", name: "Grana grattugiato in busta", category: "formaggi", archetype: "bag", heightCm: 16,
    params: { size: [0.65, 1, 0.14], pinch: 0.1, wrinkle: 0.2 },
  },
  {
    id: "lt-pecorino-spicchio", name: "Pecorino a spicchio", category: "formaggi", archetype: "wedge", heightCm: 6,
    params: { radius: 3.2, angleDeg: 22, bulge: 0.02, rind: true },
  },
  {
    id: "lt-caciotta", name: "Caciotta", category: "formaggi", archetype: "lathe", heightCm: 7,
    params: { smooth: false, profile: [[0, 0], [2, 0], [2.15, 0.04], [2.2, 0.1], [2.2, 0.9], [2.15, 0.96], [2, 1], [0, 1]] },
  },
  {
    id: "lt-provolone", name: "Provolone", category: "formaggi", archetype: "elongated", heightCm: 12,
    pose: { tiltDeg: 78 },
    params: { radii: [[0, 0], [0.06, 0.14], [0.3, 0.2], [0.7, 0.2], [0.92, 0.12], [1, 0.05]], wobble: 0.02 },
    details: { stem: { length: 0.1, thickness: 0.012, bend: 0.2 } },
  },
  {
    id: "lt-scamorza", name: "Scamorza", category: "formaggi", archetype: "lathe", heightCm: 12,
    params: { profile: [[0, 0], [0.5, 0.02], [0.85, 0.22], [0.92, 0.5], [0.7, 0.78], [0.35, 0.95], [0.2, 1.08], [0.2, 1.22], [0.28, 1.32], [0, 1.36]] },
  },
  {
    id: "lt-formaggio-fette-confezione", name: "Formaggio a fette in confezione", category: "formaggi", archetype: "box", heightCm: 2.5,
    params: { size: [12, 2.5, 12], bevel: 0.05 },
    details: { label: { from: 0.1, to: 0.9, signal: true } },
  },
  {
    id: "lt-feta-blocco", name: "Feta in blocco", category: "formaggi", archetype: "box", heightCm: 3.5,
    params: { size: [10, 3.5, 6], bevel: 0 },
  },
  {
    id: "lt-formaggio-spalmabile-vaschetta", name: "Formaggio spalmabile in vaschetta", category: "formaggi", archetype: "lathe", heightCm: 4.5,
    params: { smooth: false, profile: [[0, 0], [1.1, 0], [1.16, 0.06], [1.2, 0.9], [1.22, 1], [1.22, 1.04]] },
    details: { cap: { kind: "lid", height: 0.06, radius: 1.2, signal: true }, label: { from: 0.2, to: 0.8 } },
  },
  {
    id: "lt-uova-confezione-6", name: "Uova, confezione da 6", category: "uova", archetype: "composite", heightCm: 8.5, variation: 0.4,
    params: {
      parts: [
        { recipe: { archetype: "box", params: { size: [3, 1, 2], bevel: 0.1 }, color: CARTON_COLOR } },
        { recipe: EGG, position: [-1.0, 0.7, -0.5] },
        { recipe: EGG, position: [0.0, 0.7, -0.5] },
        { recipe: EGG, position: [1.0, 0.7, -0.5] },
        { recipe: EGG, position: [-1.0, 0.7, 0.5] },
        { recipe: EGG, position: [0.0, 0.7, 0.5] },
        { recipe: EGG, position: [1.0, 0.7, 0.5] },
      ],
    },
  },
  {
    id: "lt-uovo-singolo-tondo", name: "Uovo singolo", category: "uova", archetype: "lathe", heightCm: 4.5,
    pose: { tiltDeg: 75 },
    params: { profile: [[0, 0], [0.34, 0.05], [0.55, 0.3], [0.6, 0.65], [0.52, 1], [0.3, 1.28], [0, 1.38]] },
  },
  {
    id: "lt-uova-confezione-10", name: "Uova, confezione da 10", category: "uova", archetype: "composite", heightCm: 8.5, variation: 0.4,
    params: {
      parts: [
        { recipe: { archetype: "box", params: { size: [5, 1, 2], bevel: 0.1 }, color: CARTON_COLOR } },
        { recipe: EGG, position: [-2.0, 0.7, -0.5] },
        { recipe: EGG, position: [-1.0, 0.7, -0.5] },
        { recipe: EGG, position: [0.0, 0.7, -0.5] },
        { recipe: EGG, position: [1.0, 0.7, -0.5] },
        { recipe: EGG, position: [2.0, 0.7, -0.5] },
        { recipe: EGG, position: [-2.0, 0.7, 0.5] },
        { recipe: EGG, position: [-1.0, 0.7, 0.5] },
        { recipe: EGG, position: [0.0, 0.7, 0.5] },
        { recipe: EGG, position: [1.0, 0.7, 0.5] },
        { recipe: EGG, position: [2.0, 0.7, 0.5] },
      ],
    },
  },
  {
    id: "lt-kefir-bottiglia", name: "Kefir in bottiglia", category: "latticini", archetype: "lathe", heightCm: 22,
    params: { smooth: false, profile: [[0, 0], [0.25, 0], [0.27, 0.03], [0.27, 0.62], [0.24, 0.7], [0.15, 0.8], [0.11, 0.86], [0.11, 0.95]] },
    details: { cap: { kind: "screw", height: 0.06 }, label: { from: 0.12, to: 0.6 } },
  },
  {
    id: "lt-budino-vasetto", name: "Budino in vasetto", category: "latticini", archetype: "lathe", heightCm: 6,
    params: { smooth: false, profile: [[0, 0], [0.45, 0], [0.5, 0.05], [0.6, 0.9], [0.62, 1], [0.66, 1.03]] },
    details: { cap: { kind: "lid", height: 0.03, radius: 0.6, signal: true }, label: { from: 0.2, to: 0.75 } },
  },
  {
    id: "lt-tofu-panetto", name: "Tofu in panetto", category: "latticini", archetype: "box", heightCm: 3,
    params: { size: [9, 3, 6], bevel: 0.06 },
    details: { label: { from: 0.15, to: 0.85 } },
  },
];

