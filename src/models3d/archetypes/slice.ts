import { Matrix4, type BufferGeometry } from "three";
import type { SliceParams } from "../recipe";
import { MeshBuilder, ellipsoidProfile, latheMesh, orientByNormals } from "../geometry";
import type { BuildContext, RawPart } from "./types";

function finish(b: MeshBuilder): BufferGeometry {
  const g = b.toGeometry();
  orientByNormals(g);
  return g;
}

/**
 * Fetta di frutto a mezzaluna, in piedi: il cerchio ha raggio 1, l'apice sta in alto (0, 1) e il bordo curvo
 * tocca terra. Con arcDeg = 180 il taglio è un piano orizzontale. La faccia guarda lungo z.
 */
export function buildSlice(p: SliceParams, ctx: BuildContext): RawPart[] {
  const { rng, variation: v } = ctx;
  const arc = (((p.arcDeg ?? 180) + rng.signed() * 4 * v) * Math.PI) / 180;
  const half = Math.min(arc, Math.PI * 1.1) / 2;
  const T = (p.thickness ?? 0.25) * (1 + rng.signed() * 0.1 * v);
  const rindW = p.rindWidth ?? 0.06;
  const at = (theta: number, rho: number): [number, number] => [rho * Math.sin(theta), 1 - rho * Math.cos(theta)];
  const nTheta = Math.max(12, Math.ceil((arc / Math.PI) * 28));
  const nRho = 6;

  const flesh = new MeshBuilder();
  for (const side of [1, -1]) {
    const first = flesh.count;
    for (let k = 0; k <= nRho; k++) {
      for (let i = 0; i <= nTheta; i++) {
        const [x, y] = at(-half + (2 * half * i) / nTheta, k / nRho);
        flesh.vertex(x, y, (side * T) / 2, x, y, [0, 0, side]);
      }
    }
    for (let k = 0; k < nRho; k++) {
      for (let i = 0; i < nTheta; i++) {
        const a = first + k * (nTheta + 1) + i;
        flesh.quad(a, a + 1, a + nTheta + 1, a + nTheta + 2);
      }
    }
  }
  for (const side of [-1, 1]) {
    const theta = side * half;
    const first = flesh.count;
    const nn: [number, number, number] = [side * Math.cos(theta), side * Math.sin(theta), 0];
    for (let k = 0; k <= nRho; k++) {
      const [x, y] = at(theta, k / nRho);
      for (const z of [-T / 2, T / 2]) flesh.vertex(x, y, z, k / nRho, z + T / 2, nn);
    }
    for (let k = 0; k < nRho; k++) flesh.quad(first + 2 * k, first + 2 * k + 1, first + 2 * k + 2, first + 2 * k + 3);
  }

  const outer = new MeshBuilder();
  for (let i = 0; i <= nTheta; i++) {
    const theta = -half + (2 * half * i) / nTheta;
    const [x, y] = at(theta, 1);
    for (const z of [-T / 2, T / 2]) outer.vertex(x, y, z, i / nTheta, z + T / 2, [Math.sin(theta), -Math.cos(theta), 0]);
  }
  for (let i = 0; i < nTheta; i++) outer.quad(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 3);

  // linea fra buccia e polpa, su entrambe le facce
  const lines: number[] = [];
  const hasRind = p.rind !== false;
  if (hasRind) {
    for (const z of [-T / 2, T / 2]) {
      for (let i = 0; i < nTheta; i++) {
        const [x0, y0] = at(-half + (2 * half * i) / nTheta, 1 - rindW);
        const [x1, y1] = at(-half + (2 * half * (i + 1)) / nTheta, 1 - rindW);
        lines.push(x0, y0, z, x1, y1, z);
      }
    }
  }

  const parts: RawPart[] = [];
  if (hasRind) {
    parts.push({ name: "flesh", role: "body", geometry: finish(flesh), lines, matrix: new Matrix4(), outline: 0.008, edgeAngle: 30 });
    parts.push({ name: "rind", role: "rind", geometry: finish(outer), matrix: new Matrix4(), outline: 0.008, edgeAngle: 30, densityMul: 1.4 });
  } else {
    const merged = new MeshBuilder();
    merged.append(finish(flesh), new Matrix4());
    merged.append(finish(outer), new Matrix4());
    parts.push({ name: "flesh", role: "body", geometry: merged.toGeometry(), matrix: new Matrix4(), outline: 0.008, edgeAngle: 30 });
  }

  const seeds = p.seeds ?? 0;
  if (seeds > 0) {
    const size = (p.seedSize ?? 0.04) * (1 + rng.signed() * 0.1 * v);
    const base = latheMesh(ellipsoidProfile(1, 1.7, 6), { segments: 8, creaseDeg: 80 });
    const sb = new MeshBuilder();
    for (let i = 0; i < seeds; i++) {
      const theta = rng.signed() * (half - 0.2);
      const rho = rng.range(0.2, Math.max(0.3, 1 - rindW - 0.1));
      const [x, y] = at(theta, rho);
      const side = i % 2 === 0 ? 1 : -1;
      const m = new Matrix4()
        .makeTranslation(x, y, (side * T) / 2)
        .multiply(new Matrix4().makeRotationZ(theta + rng.signed() * 0.3))
        .multiply(new Matrix4().makeScale(size, size, size * 0.35))
        .multiply(new Matrix4().makeTranslation(0, -1.7, 0));
      sb.append(base, m);
    }
    base.dispose();
    parts.push({ name: "seeds", role: "body", geometry: sb.toGeometry(), matrix: new Matrix4(), outline: 0, densityMul: 4 });
  }
  return parts;
}
