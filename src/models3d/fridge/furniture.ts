/**
 * Tre mobili semplici, con le misure scritte a mano: frigo (ripiani di vetro, cassetto, sportello aperto con
 * i balconcini), freezer (tre cassetti, sportello con balconcini) e credenza (ripiani e due ante). Ogni mobile è
 * una ricetta composta di scatole più l'elenco dei piani su cui si appoggiano gli alimenti.
 *
 * Sistema di riferimento: y verso l'alto, il pavimento a y = 0, il fondo a z negativo e il fronte (verso chi guarda)
 * a z positivo, centrato su x = 0. Le unità sono quelle della scena, non centimetri.
 */
import type { CompositePart, CompositeRecipe } from "../recipe";

export type FurnitureKind = "fridge" | "freezer" | "pantry";

export const FURNITURE_KINDS: readonly FurnitureKind[] = ["fridge", "freezer", "pantry"];

/**
 * Piano su cui appoggiare gli alimenti. `z0` è il fondo, `z1` il fronte. Le coordinate sono locali: per i piani
 * con `frame` (i balconcini dello sportello) vanno portate nel mondo con quella posizione e rotazione.
 */
export interface Slot {
  id: string;
  kind: "shelf" | "drawer" | "door";
  /** Quota della superficie. */
  y: number;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  /** Altezza libera sopra il piano. */
  headroom: number;
  /** Distanza dai bordi; predefinita se assente. I balconcini sono stretti e ne usano meno. */
  margin?: number;
  /** Posizione e rotazione (attorno a y, radianti) del sistema locale del piano nel mondo. */
  frame?: { position: [number, number, number]; rotY: number };
  /** Gli alimenti guardano il lato opposto (verso la faccia interna dello sportello). */
  flip?: boolean;
  /** Quota della cima del bordo anteriore (cassetti): un alimento deve sporgere almeno per metà sopra di essa. */
  lipTop?: number;
}

export interface FurnitureSpec {
  kind: FurnitureKind;
  label: string;
  width: number;
  height: number;
  depth: number;
  slots: Slot[];
  /** Rapporto larghezza / altezza consigliato per la tela: mobile e sportelli aperti riempiono bene l'inquadratura. */
  aspect: number;
  recipe: CompositeRecipe;
}

const T = 0.08;
const RAIL_DEPTH = 0.18;
const RAIL_H = 0.04;

/** Tinte dei mobili per lo stile a colori: chiare e pulite, per far risaltare gli alimenti. */
interface Tones {
  shell: string;
  back: string;
  shelf: string;
  drawer: string;
  door: string;
  rail: string;
}

const FRIDGE_TONES: Tones = { shell: "#f3f5f7", back: "#e1e7ec", shelf: "#bfe1ea", drawer: "#cfe3ee", door: "#fafbfc", rail: "#dde5eb" };
const FREEZER_TONES: Tones = { shell: "#eaf4fa", back: "#d6e6f0", shelf: "#bcd9ea", drawer: "#bcd9ea", door: "#f4fafd", rail: "#cfe2ee" };
const PANTRY_TONES: Tones = { shell: "#f1e6d3", back: "#e2d3b9", shelf: "#ead9bd", drawer: "#ead9bd", door: "#f7efe0", rail: "#e2d3b9" };

interface BoxOptions {
  /** Colore per lo stile a colori. */
  color?: string;
  /** Rotazione attorno alla verticale, in gradi. */
  rotY?: number;
  /** Moltiplicatore della densità del tratto: più basso = più rado. */
  density?: number;
}

/** Scatola `w × h × d` con il centro della base in (cx, y0, cz). Le misure sono dilatate per rispettare i limiti dei lati. */
function box(w: number, h: number, d: number, cx: number, y0: number, cz: number, o: BoxOptions = {}): CompositePart {
  return {
    recipe: {
      archetype: "box",
      params: { size: [w * 5, h * 5, d * 5] },
      variation: 0,
      hatch: { density: o.density ?? 0.6, cross: false },
      color: { main: o.color ?? "#f3f5f7" },
    },
    position: [cx, y0, cz],
    rotationDeg: [0, o.rotY ?? 0, 0],
    scale: h,
  };
}

interface DoorResult {
  parts: CompositePart[];
  /** Balconcini: uno per ripiano, con il sistema locale già portato nel mondo. */
  slots: Slot[];
}

/**
 * Anta incernierata in (hx, hz) che si apre verso chi guarda di `angleDeg`. `side` è +1 se il bordo libero
 * parte verso +x, -1 verso -x. Sulla faccia interna porta i balconcini (`rails`, quota della base).
 */
function door(
  hx: number,
  hz: number,
  side: 1 | -1,
  width: number,
  height: number,
  angleDeg: number,
  rails: { y: number; width: number }[],
  tones: Tones,
  idPrefix = "door",
): DoorResult {
  const a = (angleDeg * Math.PI) / 180;
  const thick = 0.08;
  const u = [side * Math.cos(a), Math.sin(a)] as const;
  const w = [-side * Math.sin(a), Math.cos(a)] as const;
  const at = (along: number, across: number): [number, number] => [hx + u[0] * along + w[0] * across, hz + u[1] * along + w[1] * across];
  const rot = -side * angleDeg;
  const [cx, cz] = at(width / 2, thick / 2);
  const parts = [box(width, height, thick, cx, 0.03, cz, { rotY: rot, density: 0.5, color: tones.door })];
  const slots: Slot[] = [];
  rails.forEach((r, i) => {
    const [rx, rz] = at(width / 2, -thick / 2 - RAIL_DEPTH / 2);
    parts.push(box(r.width, RAIL_H, RAIL_DEPTH, rx, r.y, rz, { rotY: rot, density: 0.6, color: tones.rail }));
    const next = rails[i + 1] ? rails[i + 1].y : r.y + 0.6;
    slots.push({
      id: `${idPrefix}-${i + 1}`,
      kind: "door",
      y: 0,
      x0: -(r.width / 2 - 0.03),
      x1: r.width / 2 - 0.03,
      z0: -RAIL_DEPTH / 2,
      z1: RAIL_DEPTH / 2,
      headroom: Math.min(0.5, next - (r.y + RAIL_H) - 0.02),
      margin: 0.015,
      frame: { position: [rx, r.y + RAIL_H, rz], rotY: (rot * Math.PI) / 180 },
      flip: true,
    });
  });
  return { parts, slots };
}

function cabinetShell(width: number, height: number, depth: number, tones: Tones): CompositePart[] {
  return [
    box(width, height, T, 0, 0, -depth / 2 + T / 2, { color: tones.back }),
    box(T, height, depth, -width / 2 + T / 2, 0, 0, { color: tones.shell }),
    box(T, height, depth, width / 2 - T / 2, 0, 0, { color: tones.shell }),
    box(width - 2 * T, T, depth, 0, height - T, 0, { color: tones.shell }),
    box(width - 2 * T, T, depth, 0, 0, 0, { color: tones.shell }),
  ];
}

function fridge(angle = 115): FurnitureSpec {
  const W = 1.3;
  const H = 2.2;
  const D = 0.9;
  const inner = W - 2 * T;
  const tops = [0.64, 1.12, 1.6];
  const parts = cabinetShell(W, H, D, FRIDGE_TONES);
  for (const y of tops) parts.push(box(inner - 0.02, 0.04, D - T - 0.03, 0, y - 0.04, (T - 0.03) / 2, { density: 0.4, color: FRIDGE_TONES.shelf }));
  // cassetto estratto di poco: fondo, bordo anteriore basso e due fianchi
  const drawer = { density: 0.5, color: FRIDGE_TONES.drawer };
  parts.push(box(inner - 0.06, 0.04, 0.78, 0, 0.1, 0.06, { ...drawer, density: 0.4 }));
  parts.push(box(inner - 0.04, 0.1, 0.05, 0, 0.08, 0.47, drawer));
  parts.push(box(0.04, 0.22, 0.78, -(inner - 0.1) / 2, 0.1, 0.06, drawer));
  parts.push(box(0.04, 0.22, 0.78, (inner - 0.1) / 2, 0.1, 0.06, drawer));
  const d = door(-W / 2, D / 2, 1, W, H - 0.1, angle, [0.5, 1.0, 1.5].map((y) => ({ y, width: 1.0 })), FRIDGE_TONES);
  parts.push(...d.parts);

  const x = inner / 2 - 0.04;
  const slots: Slot[] = [
    { id: "drawer", kind: "drawer", y: 0.14, x0: -x, x1: x, z0: -0.32, z1: 0.42, headroom: 0.46, lipTop: 0.18 },
    ...tops.map((y, i): Slot => ({ id: `shelf-${i + 1}`, kind: "shelf", y, x0: -x, x1: x, z0: -D / 2 + T + 0.02, z1: D / 2 - 0.05, headroom: i < 2 ? 0.44 : 0.52 })),
    ...d.slots,
  ];
  return {
    kind: "fridge",
    label: "Frigo",
    width: W,
    height: H,
    depth: D,
    slots,
    aspect: 0.9,
    recipe: composite("frigo-scena", "Frigo", H, parts),
  };
}

function freezer(angle = 115): FurnitureSpec {
  const W = 1.2;
  const H = 1.7;
  const D = 0.85;
  const inner = W - 2 * T;
  const parts = cabinetShell(W, H, D, FREEZER_TONES);
  const plates = [0.1, 0.62, 1.14];
  const drawer = { density: 0.5, color: FREEZER_TONES.drawer };
  for (const y of plates) {
    parts.push(box(inner - 0.04, 0.04, 0.72, 0, y, 0.07, { ...drawer, density: 0.4 }));
    parts.push(box(inner - 0.02, 0.08, 0.05, 0, y - 0.02, 0.46, drawer));
    parts.push(box(0.04, 0.14, 0.72, -(inner - 0.06) / 2, y, 0.07, drawer));
    parts.push(box(0.04, 0.14, 0.72, (inner - 0.06) / 2, y, 0.07, drawer));
  }
  const d = door(-W / 2, D / 2, 1, W, H - 0.1, angle, [0.45, 1.1].map((y) => ({ y, width: 0.9 })), FREEZER_TONES);
  parts.push(...d.parts);

  const x = inner / 2 - 0.06;
  const slots: Slot[] = plates.map((y, i) => {
    const top = y + 0.04;
    return { id: `drawer-${i + 1}`, kind: "drawer", y: top, x0: -x, x1: x, z0: -0.27, z1: 0.42, headroom: i < 2 ? 0.46 : H - T - top, lipTop: y + 0.06 };
  });
  slots.push(...d.slots);
  return {
    kind: "freezer",
    label: "Freezer",
    width: W,
    height: H,
    depth: D,
    slots,
    aspect: 0.9,
    recipe: composite("freezer-scena", "Freezer", H, parts),
  };
}

function pantry(angle = 100): FurnitureSpec {
  const W = 1.9;
  const H = 2.2;
  const D = 0.65;
  const inner = W - 2 * T;
  const tops = [0.6, 1.12, 1.64];
  const parts = cabinetShell(W, H, D, PANTRY_TONES);
  for (const y of tops) parts.push(box(inner - 0.02, 0.06, D - T - 0.02, 0, y - 0.06, (T - 0.02) / 2, { density: 0.4, color: PANTRY_TONES.shelf }));
  parts.push(...door(-W / 2, D / 2, 1, W / 2, H - 0.1, angle, [], PANTRY_TONES).parts);
  parts.push(...door(W / 2, D / 2, -1, W / 2, H - 0.1, angle, [], PANTRY_TONES).parts);

  const x = inner / 2 - 0.03;
  const floors = [T, ...tops];
  const slots: Slot[] = floors.map((y, i) => ({
    id: i === 0 ? "floor" : `shelf-${i}`,
    kind: "shelf",
    y,
    x0: -x,
    x1: x,
    z0: -D / 2 + T + 0.02,
    z1: D / 2 - 0.04,
    headroom: i < floors.length - 1 ? floors[i + 1] - 0.06 - y : H - T - y,
  }));
  return {
    kind: "pantry",
    label: "Credenza",
    width: W,
    height: H,
    depth: D,
    slots,
    aspect: 1.15,
    recipe: composite("credenza-scena", "Credenza", H, parts),
  };
}

function composite(id: string, name: string, height: number, parts: CompositePart[]): CompositeRecipe {
  return {
    id,
    name,
    category: "altro",
    archetype: "composite",
    heightCm: height * 100,
    variation: 0,
    params: { parts },
  };
}

const cache = new Map<FurnitureKind, FurnitureSpec>();

/** Costruisce un mobile con l'angolo di apertura dello sportello dato (gradi). */
export function makeFurniture(kind: FurnitureKind, doorAngle?: number): FurnitureSpec {
  return kind === "fridge" ? fridge(doorAngle) : kind === "freezer" ? freezer(doorAngle) : pantry(doorAngle);
}

export function furnitureSpec(kind: FurnitureKind): FurnitureSpec {
  let spec = cache.get(kind);
  if (!spec) {
    spec = makeFurniture(kind);
    cache.set(kind, spec);
  }
  return spec;
}

/** Luogo del libro mastro → mobile. */
export function furnitureForLocation(location: "frigo" | "freezer" | "dispensa"): FurnitureKind {
  return location === "frigo" ? "fridge" : location === "freezer" ? "freezer" : "pantry";
}
