import { Euler, Matrix4, Vector3 } from "three";
import type { FishParams } from "../recipe";
import { MeshBuilder, ellipsoidProfile, latheMesh, sweepMesh } from "../geometry";
import type { BuildContext, RawPart } from "./types";

const deg = (d: number) => (d * Math.PI) / 180;

interface Fin {
  geometry: ReturnType<MeshBuilder["toGeometry"]>;
  lines: number[];
}

/**
 * Lamina di pinna a colonne: ogni colonna parte dalla base e sale di `height(s)`, con una spinta all'indietro `sweep`.
 * `place(s, j)` dà il punto della colonna s (0..1) alla quota relativa j (0..1) con l'altezza già calcolata.
 */
function finSheet(m: number, rows: number, place: (s: number, j: number) => Vector3, rays: number): Fin {
  const b = new MeshBuilder();
  for (let i = 0; i <= m; i++) {
    for (let j = 0; j <= rows; j++) {
      const p = place(i / m, j / rows);
      b.vertex(p.x, p.y, p.z, i / m, j / rows);
    }
  }
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < rows; j++) {
      const a = i * (rows + 1) + j;
      b.quad(a, a + 1, a + rows + 1, a + rows + 2);
    }
  }
  const lines: number[] = [];
  const seg = (p: Vector3, q: Vector3) => lines.push(p.x, p.y, p.z, q.x, q.y, q.z);
  for (let i = 0; i < m; i++) seg(place(i / m, 1), place((i + 1) / m, 1));
  seg(place(0, 0), place(0, 1));
  seg(place(1, 0), place(1, 1));
  for (let k = 1; k < rays; k++) seg(place(k / rays, 0), place(k / rays, 1));
  return { geometry: b.toGeometry(), lines };
}

/** Pesce intero visto di fianco, in piedi sul ventre, lungo 1 lungo x (muso a x = 0). */
export function buildFish(p: FishParams, ctx: BuildContext): RawPart[] {
  const { rng, variation: v } = ctx;
  const H = (p.bodyHeight ?? 0.28) * (1 + rng.signed() * 0.06 * v);
  const Tk = (p.thickness ?? 0.14) * (1 + rng.signed() * 0.08 * v);
  const tail = p.tail ?? 0.22;
  const dorsal = p.dorsal ?? 0.6;
  const pectoral = p.pectoral ?? 0.5;
  const snout = p.snout ?? 0.6;
  const Lb = 1 - tail * 0.7;
  const y0 = H / 2;
  const tm = 0.35;
  const e = 0.5 + snout;

  const g = (t: number) =>
    t < tm ? Math.sin((Math.PI / 2) * Math.pow(t / tm, e)) : 0.18 + 0.82 * (1 - Math.pow((t - tm) / (1 - tm), 1.4));
  const hy = (t: number) => (H / 2) * g(t);
  const hz = (t: number) => (Tk / 2) * Math.pow(g(t), 0.9);

  const body = sweepMesh({
    rings: 44,
    radial: 24,
    spine: (t) => new Vector3(t * Lb, y0, 0),
    radius: (t, phi) => {
      const a = hy(t);
      const b = hz(t);
      if (a < 1e-6 || b < 1e-6) return 0;
      return (a * b) / Math.hypot(b * Math.cos(phi), a * Math.sin(phi));
    },
  });

  // branchia e linea laterale, sui due fianchi
  const bodyLines: number[] = [];
  for (const side of [-1, 1]) {
    const tg = 0.2;
    let prev: Vector3 | null = null;
    for (let i = 0; i <= 10; i++) {
      const u = -0.8 + (1.6 * i) / 10;
      const t = tg + 0.03 * Math.cos(u * 1.2);
      const yy = u * hy(t);
      const z = side * hz(t) * Math.sqrt(Math.max(0, 1 - (yy / hy(t)) ** 2)) * 1.01;
      const pt = new Vector3(t * Lb, y0 + yy, z);
      if (prev) bodyLines.push(prev.x, prev.y, prev.z, pt.x, pt.y, pt.z);
      prev = pt;
    }
    prev = null;
    for (let i = 0; i <= 18; i++) {
      const t = 0.24 + (0.7 * i) / 18;
      const yy = hy(t) * 0.12;
      const z = side * hz(t) * Math.sqrt(Math.max(0, 1 - (yy / hy(t)) ** 2)) * 1.01;
      const pt = new Vector3(t * Lb, y0 + yy, z);
      if (prev) bodyLines.push(prev.x, prev.y, prev.z, pt.x, pt.y, pt.z);
      prev = pt;
    }
  }
  const parts: RawPart[] = [{ name: "body", role: "body", geometry: body, lines: bodyLines, matrix: new Matrix4(), outline: 0.01 }];

  const fins = new MeshBuilder();
  const finLines: number[] = [];
  const add = (fin: Fin, m: Matrix4) => {
    fins.append(fin.geometry, m);
    fin.geometry.dispose();
    const q = new Vector3();
    for (let i = 0; i < fin.lines.length; i += 3) {
      q.set(fin.lines[i], fin.lines[i + 1], fin.lines[i + 2]).applyMatrix4(m);
      finLines.push(q.x, q.y, q.z);
    }
  };

  if (dorsal > 0) {
    const x0 = 0.28 * Lb;
    const x1 = 0.72 * Lb;
    const peak = dorsal * H * 0.55;
    const fin = finSheet(10, 4, (s, j) => {
      const t = x0 / Lb + (s * (x1 - x0)) / Lb;
      const profile = Math.sin(Math.PI * Math.pow(s, 0.75)) * (1 - 0.25 * s);
      const h = peak * profile;
      return new Vector3(t * Lb + 0.5 * j * h, y0 + hy(t) * 0.94 + j * h, 0);
    }, 5);
    add(fin, new Matrix4());
  }

  const span = H * 0.55;
  const root = hy(1);
  const tailFin = finSheet(12, 5, (s, j) => {
    const k = s * 2 - 1;
    const len = tail * (0.45 + 0.55 * Math.pow(Math.abs(k), 1.2)) * 1.05;
    return new Vector3(Lb - 0.01 + j * len, y0 + k * (root + j * (span - root)), 0);
  }, 6);
  add(tailFin, new Matrix4());

  if (pectoral > 0) {
    for (const side of [-1, 1]) {
      const size = pectoral * H * 0.45;
      const fin = finSheet(6, 3, (s, j) => new Vector3(s * 0.1, j * size * Math.sin(Math.PI * Math.pow(s, 0.8)), 0), 3);
      const t = 0.3;
      const m = new Matrix4()
        .makeTranslation(t * Lb, y0 - hy(t) * 0.25, side * hz(t) * 0.92)
        .multiply(new Matrix4().makeRotationFromEuler(new Euler(0, side * deg(22), deg(150), "YXZ")));
      add(fin, m);
    }
  }
  parts.push({ name: "fins", role: "leaf", geometry: fins.toGeometry(), lines: finLines, matrix: new Matrix4(), outline: 0, doubleSided: true, densityMul: 1.2 });

  const eyeBase = latheMesh(ellipsoidProfile(1, 1, 6), { segments: 10, creaseDeg: 80 });
  const eyes = new MeshBuilder();
  const et = 0.09;
  for (const side of [-1, 1]) {
    const r = 0.018 + H * 0.05;
    const m = new Matrix4()
      .makeTranslation(et * Lb, y0 + hy(et) * 0.25, side * hz(et) * 0.9)
      .multiply(new Matrix4().makeScale(r, r, r * 0.6))
      .multiply(new Matrix4().makeTranslation(0, -1, 0));
    eyes.append(eyeBase, m);
  }
  eyeBase.dispose();
  parts.push({ name: "eyes", role: "body", geometry: eyes.toGeometry(), matrix: new Matrix4(), outline: 0, densityMul: 4 });
  return parts;
}
