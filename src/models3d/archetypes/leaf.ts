import { Euler, Matrix4, Vector3 } from "three";
import type { LeafParams } from "../recipe";
import { MeshBuilder, bladeMesh, tubeAlong } from "../geometry";
import { bladeMatrix } from "./details";
import type { BuildContext, RawPart } from "./types";

const deg = (d: number) => (d * Math.PI) / 180;
const GOLDEN = 2.39996;

function transformLines(out: number[], lines: number[], m: Matrix4) {
  const p = new Vector3();
  for (let i = 0; i < lines.length; i += 3) {
    p.set(lines[i], lines[i + 1], lines[i + 2]).applyMatrix4(m);
    out.push(p.x, p.y, p.z);
  }
}

/** Cespo (rosette) o mazzo (bunch) di foglie. Lunghezza della foglia di riferimento = 1. */
export function buildLeaf(p: LeafParams, ctx: BuildContext): RawPart[] {
  const { rng, variation: v } = ctx;
  const n = p.count;
  const curl = p.curl ?? 0;
  const frill = p.frill ?? 0;
  const blades = new MeshBuilder();
  const lines: number[] = [];
  const parts: RawPart[] = [];

  if (p.layout === "rosette") {
    for (let k = 0; k < n; k++) {
      const f = n > 1 ? k / (n - 1) : 1;
      const phi = k * GOLDEN + rng.signed() * 0.2 * v;
      const lean = deg(88 - p.spread * 50 * f + rng.signed() * 5 * v);
      const length = (0.55 + 0.45 * Math.pow(f, 0.8)) * (1 + rng.signed() * 0.08 * v);
      const blade = bladeMesh({ length, width: p.width, curl: curl * (0.3 + 0.5 * f), cup: 0.45, frill, rng });
      const m = new Matrix4()
        .makeTranslation(Math.cos(phi) * 0.05, 0.06, Math.sin(phi) * 0.05)
        .multiply(new Matrix4().makeRotationFromEuler(new Euler(0, phi, lean, "YXZ")));
      blades.append(blade.geometry, m);
      transformLines(lines, blade.lines, m);
    }
    const stump = tubeAlong([new Vector3(0, 0, 0), new Vector3(0, 0.05, 0), new Vector3(0, 0.1, 0)], () => 0.07, 12);
    parts.push({ name: "stump", role: "stem", geometry: stump, matrix: new Matrix4(), outline: 0.008 });
  } else {
    const stems = new MeshBuilder();
    const bladeLen = 0.55;
    for (let k = 0; k < n; k++) {
      const phi = k * GOLDEN + rng.signed() * 0.3 * v;
      const elev = deg(6 + p.spread * 34 * (0.4 + 0.6 * rng.next()));
      const dir = new Vector3(Math.sin(elev) * Math.cos(phi), Math.cos(elev), Math.sin(elev) * Math.sin(phi));
      const len = (p.stalk ?? 1) * bladeLen * (0.8 + 0.4 * rng.next());
      const out = new Vector3(Math.cos(phi), 0, Math.sin(phi));
      const pts = [0, 1 / 3, 2 / 3, 1].map((t) => dir.clone().multiplyScalar(len * t).addScaledVector(out, 0.08 * len * t * t));
      stems.append(tubeAlong(pts, (t) => 0.016 * (1 - 0.4 * t), 6), new Matrix4());
      const tangent = pts[3].clone().sub(pts[2]);
      const blade = bladeMesh({ length: bladeLen * (0.8 + 0.3 * rng.next()), width: p.width, curl: curl - 0.1, cup: 0.4, frill, rng });
      const m = bladeMatrix(pts[3], tangent);
      blades.append(blade.geometry, m);
      transformLines(lines, blade.lines, m);
    }
    parts.push({ name: "stems", role: "stem", geometry: stems.toGeometry(), matrix: new Matrix4(), outline: 0.006 });
  }
  parts.unshift({ name: "leaves", role: "leaf", geometry: blades.toGeometry(), lines, matrix: new Matrix4(), outline: 0, doubleSided: true, densityMul: 1.7 });
  return parts;
}
