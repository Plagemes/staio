/**
 * Disposizione degli alimenti sui piani di un mobile. Funzione pura: stessi dati, stessa disposizione,
 * qualunque sia l'ordine in cui arrivano. Se non c'è posto per tutto, restano fuori i meno urgenti.
 *
 * Due passaggi: prima si decide quali alimenti entrano (riempimento compatto, dal più urgente), poi li si
 * distribuisce in modo bilanciato fra i piani e li si spazia sulla larghezza, invece di ammucchiarli sul primo.
 */
import { hashSeed } from "../rng";
import type { FurnitureSpec, Slot } from "./furniture";

export interface LayoutItem {
  id: string;
  name: string;
  /** Larghezza, altezza, profondità nelle unità della scena, a scala 1. */
  size: readonly [number, number, number];
  /** Più basso = più urgente (posizione nell'ordine «da mangiare prima»). */
  priority: number;
  /** Dove preferisce stare: cassetto (frutta e verdura) o balconcino dello sportello (bottiglie e cartoni). */
  prefer?: "drawer" | "door";
}

export interface Placement {
  id: string;
  slot: string;
  /** Centro della base dell'alimento, nel sistema del piano (vedi `Slot.frame`). */
  position: [number, number, number];
  /** Fattore da applicare alla dimensione dell'alimento (1 = intero, meno se deve stare sotto il ripiano). */
  scale: number;
  /** Rotazione attorno alla verticale, in radianti, nel sistema del piano. */
  rotationY: number;
}

export interface LayoutResult {
  placements: Placement[];
  /** Id degli alimenti che non trovano posto, dal più urgente. */
  hidden: string[];
}

/** Distanza dai bordi del piano e fra un alimento e l'altro. */
export const MARGIN = 0.03;
export const GAP = 0.025;
/** Spazio in più che si può aggiungere fra un alimento e l'altro quando il piano è poco pieno. */
export const MAX_SPREAD = 0.14;
/** Sotto questo fattore un alimento non entra in un piano troppo basso. */
export const MIN_SCALE = 0.72;
/** Quota dell'altezza libera di un piano occupata da un alimento: da una scatoletta a una bottiglia. */
export const FILL_MIN = 0.52;
export const FILL_MAX = 0.72;
/** Un alimento largo non supera questa dimensione in pianta. */
export const MAX_FOOTPRINT = 0.5;
const CLEARANCE = 0.02;
const MAX_TILT = 0.16;

/** Altezza libera tipica dei piani di un mobile (la mediana): serve a dimensionare gli alimenti. */
export function typicalHeadroom(spec: FurnitureSpec): number {
  const hs = spec.slots.filter((s) => s.kind !== "door").map((s) => s.headroom).sort((a, b) => a - b);
  return hs.length ? hs[Math.floor(hs.length / 2)] : 0.46;
}

/**
 * Scala di un alimento nel mobile: l'altezza occupa dal 52 al 72 per cento dello spazio libero di un piano
 * (più alto il vero oggetto, più alto il modello), ma una confezione larga e bassa non supera il mezzo metro in pianta.
 */
export function itemScale(
  heightCm: number,
  modelSize: readonly [number, number, number],
  level = 1,
  headroom = 0.46,
): { k: number; size: [number, number, number] } {
  const cm = Math.max(0.3, heightCm);
  const tall = Math.min(1, Math.sqrt(cm / 30));
  let k = (headroom * (FILL_MIN + (FILL_MAX - FILL_MIN) * tall)) / modelSize[1];
  k = Math.min(k, MAX_FOOTPRINT / Math.max(modelSize[0], modelSize[2]));
  // il livello rimasto si vede nella scala: una confezione quasi vuota è un poco più piccola
  k *= 0.78 + 0.22 * Math.min(1, Math.max(0, level));
  return { k, size: [modelSize[0] * k, modelSize[1] * k, modelSize[2] * k] };
}

interface Row {
  zBack: number;
  depth: number;
  width: number;
  items: Placed[];
}

interface Placed {
  item: LayoutItem;
  scale: number;
  rot: number;
  bw: number;
  bd: number;
}

interface SlotState {
  slot: Slot;
  rows: Row[];
  /** Superficie occupata, per scegliere il piano meno pieno. */
  used: number;
}

const marginOf = (slot: Slot) => slot.margin ?? MARGIN;

const tiltOf = (id: string, w: number, d: number): number => {
  // gli alimenti quasi quadrati ruotano un poco, a caso ma sempre allo stesso modo; i lunghi restano dritti
  if (Math.max(w, d) / Math.min(w, d) > 1.8) return 0;
  return ((hashSeed(id) % 2001) / 1000 - 1) * MAX_TILT;
};

function footprint(w: number, d: number, rot: number): [number, number] {
  const c = Math.abs(Math.cos(rot));
  const s = Math.abs(Math.sin(rot));
  return [w * c + d * s, w * s + d * c];
}

function tryPlace(state: SlotState, item: LayoutItem): boolean {
  const { slot, rows } = state;
  const m = marginOf(slot);
  const scale = Math.min(1, (slot.headroom - CLEARANCE) / item.size[1]);
  if (scale < MIN_SCALE) return false;
  // dietro il bordo anteriore di un cassetto l'alimento deve sporgere almeno per metà, altrimenti non si vede
  if (slot.lipTop !== undefined && item.size[1] * scale < 2 * (slot.lipTop - slot.y)) return false;
  const w = item.size[0] * scale;
  const d = item.size[2] * scale;
  const rot = tiltOf(item.id, w, d);
  const [bw, bd] = footprint(w, d, rot);
  const usable = slot.x1 - slot.x0 - 2 * m;
  if (bw > usable) return false;
  const zLimit = slot.z1 - m;
  const placed: Placed = { item, scale, rot, bw, bd };

  const last = rows[rows.length - 1];
  if (last && last.width + GAP + bw <= usable && last.zBack + Math.max(last.depth, bd) <= zLimit) {
    last.items.push(placed);
    last.width += GAP + bw;
    last.depth = Math.max(last.depth, bd);
    state.used += bw * bd;
    return true;
  }
  const zBack = last ? last.zBack + last.depth + GAP : slot.z0 + m;
  if (zBack + bd > zLimit) return false;
  rows.push({ zBack, depth: bd, width: bw, items: [placed] });
  state.used += bw * bd;
  return true;
}

type Group = SlotState[];

/** Gruppi di piani in ordine di preferenza per l'alimento. */
function candidateGroups(states: SlotState[], item: LayoutItem): Group[] {
  const shelves = states.filter((s) => s.slot.kind === "shelf");
  const drawers = states.filter((s) => s.slot.kind === "drawer");
  const doors = states.filter((s) => s.slot.kind === "door");
  const order = item.prefer === "door" ? [doors, shelves, drawers] : item.prefer === "drawer" ? [drawers, shelves, doors] : [shelves, drawers, doors];
  return order.filter((g) => g.length > 0);
}

function pack(spec: FurnitureSpec, items: readonly LayoutItem[], balanced: boolean): Placement[] | null {
  const states: SlotState[] = spec.slots.map((slot) => ({ slot, rows: [], used: 0 }));
  // i più alti per primi: stanno in fondo al piano, i bassi davanti
  const ordered = [...items].sort((a, b) => b.size[1] - a.size[1] || a.name.localeCompare(b.name, "it") || (a.id < b.id ? -1 : 1));
  for (const item of ordered) {
    let done = false;
    for (const group of candidateGroups(states, item)) {
      const order = [...group].sort((a, b) =>
        balanced
          ? a.used / area(a.slot) - b.used / area(b.slot) || b.slot.headroom - a.slot.headroom
          : b.slot.headroom - a.slot.headroom,
      );
      if (order.some((s) => tryPlace(s, item))) {
        done = true;
        break;
      }
    }
    if (!done) return null;
  }
  return balanced ? assemble(states) : assembleCompact(states);
}

const area = (slot: Slot) => (slot.x1 - slot.x0) * (slot.z1 - slot.z0);

function toPlacement(slot: Slot, p: Placed, cx: number, z: number): Placement {
  return {
    id: p.item.id,
    slot: slot.id,
    position: [cx, slot.y, z],
    scale: p.scale,
    rotationY: p.rot + (slot.flip ? Math.PI : 0),
  };
}

/** Disposizione compatta: file centrate, in fondo al piano. Serve solo a sapere se tutto ci sta. */
function assembleCompact(states: SlotState[]): Placement[] {
  const out: Placement[] = [];
  for (const { slot, rows } of states) {
    const usable = slot.x1 - slot.x0;
    for (const row of rows) {
      let x = slot.x0 + (usable - row.width) / 2;
      for (const p of row.items) {
        out.push(toPlacement(slot, p, x + p.bw / 2, row.zBack + p.bd / 2));
        x += p.bw + GAP;
      }
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Disposizione definitiva: le file scorrono verso il fronte del piano, così si vedono, e ogni fila è spaziata
 * sulla larghezza (fino a `MAX_SPREAD` in più fra un alimento e l'altro) e centrata.
 */
function assemble(states: SlotState[]): Placement[] {
  const out: Placement[] = [];
  for (const { slot, rows } of states) {
    if (rows.length === 0) continue;
    const m = marginOf(slot);
    const usable = slot.x1 - slot.x0 - 2 * m;
    const lastRow = rows[rows.length - 1];
    const shift = Math.max(0, slot.z1 - m - (lastRow.zBack + lastRow.depth));
    for (const row of rows) {
      const n = row.items.length;
      const extra = Math.min(MAX_SPREAD, (usable - row.width) / (n + 1));
      const total = row.width + extra * (n + 1);
      let x = slot.x0 + m + (usable - total) / 2 + extra;
      for (const p of row.items) {
        out.push(toPlacement(slot, p, x + p.bw / 2, row.zBack + shift + p.bd / 2));
        x += p.bw + GAP + extra;
      }
    }
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Sceglie e dispone gli alimenti. Si scorrono dal più urgente: ognuno resta se, con quelli già scelti,
 * la disposizione completa ci sta. Un alimento meno urgente ma piccolo può riempire un buco lasciato libero.
 */
export function layoutItems(spec: FurnitureSpec, items: readonly LayoutItem[]): LayoutResult {
  const byUrgency = [...items].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name, "it") || (a.id < b.id ? -1 : 1));
  const shown: LayoutItem[] = [];
  const hidden: string[] = [];
  let compact: Placement[] = [];
  for (const item of byUrgency) {
    const attempt = pack(spec, [...shown, item], false);
    if (attempt) {
      shown.push(item);
      compact = attempt;
    } else {
      hidden.push(item.id);
    }
  }
  // la distribuzione bilanciata può sprecare spazio: se non ci sta, resta quella compatta
  return { placements: shown.length ? (pack(spec, shown, true) ?? compact) : [], hidden };
}

/** Piano per id, per chi deve disegnare. */
export function slotOf(spec: FurnitureSpec, id: string): Slot | undefined {
  return spec.slots.find((s) => s.id === id);
}
