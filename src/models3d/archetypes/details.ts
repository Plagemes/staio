import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import type { CapDetail, LabelDetail, LeafDetail, StemDetail } from "../recipe";
import { bladeMesh, latheMesh, tubeAlong, type Pt } from "../geometry";
import type { BuildContext, RawPart } from "./types";

const deg = (d: number) => (d * Math.PI) / 180;

export interface StemResult {
  parts: RawPart[];
  /** Punto in cima al picciolo. */
  tip: Vector3;
  tangent: Vector3;
}

/** Picciolo curvo che parte da `base` verso l'alto. Misure relative all'altezza del corpo. */
export function stemPart(base: Vector3, d: StemDetail, ctx: BuildContext): StemResult {
  const bend = (d.bend ?? 0.4) + ctx.rng.signed() * 0.2 * ctx.variation;
  const len = d.length * (1 + ctx.rng.signed() * 0.12 * ctx.variation);
  const pts = [0, 0.33, 0.66, 1].map((t) => new Vector3(base.x + bend * len * 0.4 * t * t, base.y - 0.02 + (len + 0.02) * t, base.z));
  const geometry = tubeAlong(pts, (t) => d.thickness * (1 - 0.3 * t) * (1 + 0.5 * Math.pow(1 - t, 4)), 8);
  const tip = pts[3].clone();
  const tangent = pts[3].clone().sub(pts[2]).normalize();
  return { parts: [{ name: "stem", role: "stem", geometry, matrix: new Matrix4(), outline: 0.007 }], tip, tangent };
}

/** Una o più foglie a partire da `base`, lungo `dir`. `leanDeg` è l'angolo sopra l'orizzontale. */
export function leafParts(base: Vector3, d: LeafDetail, leanDeg: number, ctx: BuildContext): RawPart[] {
  const { rng } = ctx;
  const out: RawPart[] = [];
  const turn = rng.range(0, Math.PI * 2);
  for (let i = 0; i < d.count; i++) {
    const phi = turn + (i / d.count) * Math.PI * 2 + rng.signed() * 0.35 * ctx.variation;
    const lean = deg(leanDeg + rng.signed() * 12 * ctx.variation);
    const length = d.length * (1 + rng.signed() * 0.15 * ctx.variation);
    const blade = bladeMesh({ length, width: d.width ?? 0.45, curl: -0.25 + rng.signed() * 0.1, cup: 0.35, frill: 0, rng });
    const m = new Matrix4().makeTranslation(base.x, base.y, base.z).multiply(new Matrix4().makeRotationFromEuler(new Euler(0, phi, lean, "YXZ")));
    out.push({ name: "leaf", role: "leaf", geometry: blade.geometry, lines: blade.lines, matrix: m, outline: 0, doubleSided: true });
  }
  return out;
}

/** Matrice che porta la lamina (asse +x) lungo `dir` con il dorso verso l'alto. */
export function bladeMatrix(base: Vector3, dir: Vector3): Matrix4 {
  const q1 = new Quaternion().setFromUnitVectors(new Vector3(1, 0, 0), dir.clone().normalize());
  const up = new Vector3(0, 1, 0);
  const localUp = new Vector3(0, 1, 0).applyQuaternion(q1);
  const d = dir.clone().normalize();
  const target = up.clone().addScaledVector(d, -up.dot(d));
  if (target.lengthSq() > 1e-6) {
    target.normalize();
    const angle = Math.atan2(d.dot(localUp.clone().cross(target)), localUp.dot(target));
    q1.premultiply(new Quaternion().setFromAxisAngle(d, angle));
  }
  return new Matrix4().compose(base, q1, new Vector3(1, 1, 1));
}

export type CapKind = NonNullable<CapDetail["kind"]>;

function capProfile(kind: CapKind, r: number, h: number): Pt[] {
  switch (kind) {
    case "cork":
      return [[0, 0], [0.82 * r, 0], [0.95 * r, 0.5 * h], [r, 0.9 * h], [0.9 * r, h], [0, h]];
    case "lid":
      return [[0, 0], [1.05 * r, 0], [1.05 * r, 0.45 * h], [0.92 * r, 0.5 * h], [0.92 * r, h], [0, h]];
    default:
      return [[0, 0], [r, 0], [r, 0.85 * h], [0.93 * r, h], [0, h]];
  }
}

/** Tappo con la base in (x, y, z). */
export function capPart(x: number, y: number, z: number, radius: number, d: CapDetail, ctx: BuildContext): RawPart {
  const h = (d.height ?? 0.05) * (1 + ctx.rng.signed() * 0.1 * ctx.variation);
  const geometry = latheMesh(capProfile(d.kind ?? "screw", radius, h), { segments: 32, creaseDeg: 35, closeEnds: false });
  return {
    name: "cap",
    role: "cap",
    geometry,
    matrix: new Matrix4().makeTranslation(x, y - 0.002, z),
    outline: 0.006,
    signal: d.signal === true,
  };
}

/** Fascia di etichetta attorno a un profilo (r, y) già normalizzato: segue il corpo fra due altezze. */
export function labelBand(profile: readonly Pt[], d: LabelDetail): RawPart | null {
  const sub: Pt[] = [];
  const lerp = (a: Pt, b: Pt, y: number): Pt => {
    const t = b[1] === a[1] ? 0 : (y - a[1]) / (b[1] - a[1]);
    return [a[0] + (b[0] - a[0]) * t, y];
  };
  for (let i = 0; i < profile.length - 1; i++) {
    const a = profile[i];
    const b = profile[i + 1];
    const lo = Math.min(a[1], b[1]);
    const hi = Math.max(a[1], b[1]);
    if (hi < d.from || lo > d.to || hi === lo) continue;
    const pa = a[1] >= d.from && a[1] <= d.to ? a : lerp(a, b, a[1] < d.from ? d.from : d.to);
    const pb = b[1] >= d.from && b[1] <= d.to ? b : lerp(a, b, b[1] < d.from ? d.from : d.to);
    if (sub.length === 0) sub.push(pa);
    sub.push(pb);
  }
  if (sub.length < 2) return null;
  const off = 0.006;
  const band = sub.map(([r, y]) => [r + off, y] as Pt);
  const geometry = latheMesh(band, { segments: 56, creaseDeg: 60, closeEnds: false });
  const lines: number[] = [];
  for (const [r, y] of [band[0], band[band.length - 1]]) {
    for (let i = 0; i < 56; i++) {
      const a0 = (i / 56) * Math.PI * 2;
      const a1 = ((i + 1) / 56) * Math.PI * 2;
      lines.push(r * Math.cos(a0), y, r * Math.sin(a0), r * Math.cos(a1), y, r * Math.sin(a1));
    }
  }
  return { name: "label", role: "label", geometry, lines, matrix: new Matrix4(), outline: 0, signal: d.signal === true, densityMul: 0.5 };
}
