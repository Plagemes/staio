/**
 * Inquadratura della scena: calcola dove mettere la camera perché un ingombro (mobile con gli sportelli aperti)
 * stia tutto nella tela, il più grande possibile. Tiene conto della prospettiva: uno sportello che sporge verso
 * chi guarda appare più grande di quanto direbbero le sue misure.
 */
import { PerspectiveCamera, Vector3 } from "three";

export interface Bounds {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}

export interface Framing {
  position: [number, number, number];
  target: [number, number, number];
  /** Estremi dell'ingombro in coordinate normalizzate dello schermo (-1..1). */
  ndc: { minX: number; maxX: number; minY: number; maxY: number };
}

function corners(b: Bounds): Vector3[] {
  const out: Vector3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push(new Vector3(x, y, z));
  return out;
}

function project(camera: PerspectiveCamera, pts: Vector3[]) {
  camera.updateMatrixWorld(true);
  const p = new Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of pts) {
    p.copy(c).project(camera);
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Camera che guarda verso -z, un poco più in alto del centro, a distanza tale che l'ingombro riempia `fill`
 * della tela nella dimensione più stretta, e centrato.
 */
export function frameCamera(bounds: Bounds, aspect: number, fovDeg: number, opts: { fill?: number; pitch?: number } = {}): Framing {
  const fill = opts.fill ?? 0.94;
  const pitch = opts.pitch ?? 0.3;
  const camera = new PerspectiveCamera(fovDeg, aspect, 0.1, 100);
  const pts = corners(bounds);
  let cx = (bounds.min[0] + bounds.max[0]) / 2;
  let cy = (bounds.min[1] + bounds.max[1]) / 2;
  let d = 8;
  let ndc = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
  const place = () => {
    camera.position.set(cx, cy + pitch, d);
    camera.lookAt(cx, cy, 0);
    ndc = project(camera, pts);
  };
  place();
  for (let i = 0; i < 24; i++) {
    const halfW = d * Math.tan((fovDeg * Math.PI) / 360) * aspect;
    const halfH = d * Math.tan((fovDeg * Math.PI) / 360);
    // ricentra, poi avvicina o allontana finché l'ingombro riempie la tela
    cx += ((ndc.minX + ndc.maxX) / 2) * halfW;
    cy += ((ndc.minY + ndc.maxY) / 2) * halfH;
    const extent = Math.max((ndc.maxX - ndc.minX) / 2, (ndc.maxY - ndc.minY) / 2);
    d = Math.min(60, Math.max(1, d * (extent / fill)));
    place();
  }
  return { position: [cx, cy + pitch, d], target: [cx, cy, 0], ndc };
}
