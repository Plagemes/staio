/** Mattoncini geometrici puri (nessun WebGL): costruttore di maglie, solido di rotazione, spazzata lungo una curva. */
import { BufferGeometry, Float32BufferAttribute, Matrix4, Vector2, Vector3, SplineCurve } from "three";
import type { Rng } from "./rng";

export type Pt = readonly [number, number];

export class MeshBuilder {
  readonly positions: number[] = [];
  readonly normals: number[] = [];
  readonly uvs: number[] = [];
  readonly indices: number[] = [];
  private hasNormals = true;

  get count(): number {
    return this.positions.length / 3;
  }

  vertex(x: number, y: number, z: number, u: number, v: number, n?: readonly [number, number, number]): number {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    if (n) this.normals.push(n[0], n[1], n[2]);
    else {
      this.hasNormals = false;
      this.normals.push(0, 0, 0);
    }
    return this.count - 1;
  }

  tri(a: number, b: number, c: number) {
    this.indices.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number) {
    this.indices.push(a, b, c, b, d, c);
  }

  /** Aggiunge una geometria già pronta con una trasformazione (scala uniforme). */
  append(g: BufferGeometry, m: Matrix4) {
    const pos = g.getAttribute("position");
    const nor = g.getAttribute("normal");
    const uv = g.getAttribute("uv");
    const nm = new Matrix4().extractRotation(m);
    const base = this.count;
    const p = new Vector3();
    const n = new Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(m);
      this.positions.push(p.x, p.y, p.z);
      n.fromBufferAttribute(nor, i).applyMatrix4(nm).normalize();
      this.normals.push(n.x, n.y, n.z);
      this.uvs.push(uv.getX(i), uv.getY(i));
    }
    const idx = g.getIndex();
    if (idx) for (let i = 0; i < idx.count; i++) this.indices.push(base + idx.getX(i));
    else for (let i = 0; i < pos.count; i++) this.indices.push(base + i);
  }

  toGeometry(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(this.positions, 3));
    g.setAttribute("normal", new Float32BufferAttribute(this.normals, 3));
    g.setAttribute("uv", new Float32BufferAttribute(this.uvs, 2));
    g.setIndex(this.indices);
    if (!this.hasNormals) g.computeVertexNormals();
    return g;
  }
}

/** Gira i triangoli se la maglia chiusa ha volume negativo. */
export function orientByVolume(g: BufferGeometry): void {
  const idx = g.getIndex();
  if (!idx) return;
  const pos = g.getAttribute("position");
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let vol = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(pos, idx.getX(i));
    b.fromBufferAttribute(pos, idx.getX(i + 1));
    c.fromBufferAttribute(pos, idx.getX(i + 2));
    vol += a.dot(b.cross(c));
  }
  if (vol < 0) flip(idx);
}

/** Gira ogni triangolo il cui verso non concorda con le normali dei vertici. */
export function orientByNormals(g: BufferGeometry): void {
  const idx = g.getIndex();
  if (!idx) return;
  const pos = g.getAttribute("position");
  const nor = g.getAttribute("normal");
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < idx.count; i += 3) {
    const i0 = idx.getX(i);
    const i1 = idx.getX(i + 1);
    const i2 = idx.getX(i + 2);
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1).sub(a);
    c.fromBufferAttribute(pos, i2).sub(a);
    b.cross(c);
    n.set(
      nor.getX(i0) + nor.getX(i1) + nor.getX(i2),
      nor.getY(i0) + nor.getY(i1) + nor.getY(i2),
      nor.getZ(i0) + nor.getZ(i1) + nor.getZ(i2),
    );
    if (b.dot(n) < 0) {
      idx.setX(i + 1, i2);
      idx.setX(i + 2, i1);
    }
  }
}

function flip(idx: { count: number; getX(i: number): number; setX(i: number, v: number): unknown }) {
  for (let i = 0; i < idx.count; i += 3) {
    const t = idx.getX(i + 1);
    idx.setX(i + 1, idx.getX(i + 2));
    idx.setX(i + 2, t);
  }
}

/** Media i vettori dei vertici che occupano la stessa posizione. */
export function smoothByPosition(g: BufferGeometry, source: ArrayLike<number>): Float32Array {
  const pos = g.getAttribute("position");
  const keys: string[] = [];
  const sums = new Map<string, [number, number, number]>();
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    keys.push(k);
    let s = sums.get(k);
    if (!s) sums.set(k, (s = [0, 0, 0]));
    const x = source[i * 3];
    const y = source[i * 3 + 1];
    const z = source[i * 3 + 2];
    const l = Math.hypot(x, y, z) || 1;
    s[0] += x / l;
    s[1] += y / l;
    s[2] += z / l;
  }
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const s = sums.get(keys[i])!;
    const l = Math.hypot(s[0], s[1], s[2]);
    if (l < 1e-5) {
      out[i * 3] = source[i * 3];
      out[i * 3 + 1] = source[i * 3 + 1];
      out[i * 3 + 2] = source[i * 3 + 2];
    } else {
      out[i * 3] = s[0] / l;
      out[i * 3 + 1] = s[1] / l;
      out[i * 3 + 2] = s[2] / l;
    }
  }
  return out;
}

/** Normali lisce anche sulle cuciture (copie di vertici alla stessa posizione). */
export function weldNormals(g: BufferGeometry): void {
  const nor = g.getAttribute("normal");
  g.setAttribute("normal", new Float32BufferAttribute(smoothByPosition(g, nor.array), 3));
}

/** Maglia chiusa e liscia: orienta, calcola e salda le normali. */
export function finishSmooth(g: BufferGeometry): BufferGeometry {
  orientByVolume(g);
  g.computeVertexNormals();
  weldNormals(g);
  return g;
}

export interface LatheOptions {
  segments: number;
  /** Angolo oltre cui lo spigolo resta vivo (normali separate). */
  creaseDeg?: number;
  /** Chiude con un disco gli estremi che non stanno sull'asse. Predefinito true. */
  closeEnds?: boolean;
}

interface Rec {
  r: number;
  y: number;
  nr: number;
  ny: number;
  v: number;
  start: boolean;
}

/** Solido di rotazione attorno a y. u = angolo / 2π, v = lunghezza d'arco del profilo / totale. */
export function latheMesh(profile: readonly Pt[], opts: LatheOptions): BufferGeometry {
  const crease = Math.cos(((opts.creaseDeg ?? 40) * Math.PI) / 180);
  const pts: Pt[] = [];
  for (const p of profile) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 1e-7) pts.push([Math.max(0, p[0]), p[1]]);
  }
  if (opts.closeEnds !== false && pts.length >= 2) {
    if (pts[0][0] > 1e-4) pts.unshift([0, pts[0][1]]);
    const l = pts[pts.length - 1];
    if (l[0] > 1e-4) pts.push([0, l[1]]);
  }
  const n = pts.length;
  const segN: Pt[] = [];
  const cum = [0];
  for (let k = 0; k < n - 1; k++) {
    const dr = pts[k + 1][0] - pts[k][0];
    const dy = pts[k + 1][1] - pts[k][1];
    const len = Math.hypot(dr, dy);
    segN.push([dy / len, -dr / len]);
    cum.push(cum[k] + len);
  }
  const total = cum[n - 1] || 1;
  const recs: Rec[] = [];
  const mk = (i: number, nn: Pt, start: boolean): Rec => {
    let [nr, ny] = nn;
    if (pts[i][0] < 1e-6) {
      nr = 0;
      ny = ny >= 0 ? 1 : -1;
    }
    return { r: pts[i][0], y: pts[i][1], nr, ny, v: cum[i] / total, start };
  };
  recs.push(mk(0, segN[0], true));
  for (let i = 1; i < n - 1; i++) {
    const a = segN[i - 1];
    const b = segN[i];
    if (a[0] * b[0] + a[1] * b[1] < crease) {
      recs.push(mk(i, a, false));
      recs.push(mk(i, b, true));
    } else {
      const m = Math.hypot(a[0] + b[0], a[1] + b[1]) || 1;
      recs.push(mk(i, [(a[0] + b[0]) / m, (a[1] + b[1]) / m], false));
    }
  }
  recs.push(mk(n - 1, segN[n - 2], false));

  const S = opts.segments;
  const b = new MeshBuilder();
  for (const rec of recs) {
    for (let i = 0; i <= S; i++) {
      const th = (i / S) * Math.PI * 2;
      const c = Math.cos(th);
      const s = Math.sin(th);
      b.vertex(rec.r * c, rec.y, rec.r * s, i / S, rec.v, [rec.nr * c, rec.ny, rec.nr * s]);
    }
  }
  for (let j = 0; j < recs.length - 1; j++) {
    if (recs[j + 1].start) continue;
    for (let i = 0; i < S; i++) {
      const a0 = j * (S + 1) + i;
      const b0 = a0 + 1;
      const c0 = a0 + S + 1;
      const d0 = c0 + 1;
      b.tri(a0, b0, c0);
      b.tri(b0, d0, c0);
    }
  }
  const g = b.toGeometry();
  orientByNormals(g);
  return g;
}

/** Mezzo profilo di un ellissoide con la base a y = 0, per elementi tondi. */
export function ellipsoidProfile(rx: number, ry: number, steps = 12): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI;
    out.push([rx * Math.sin(a), ry * (1 - Math.cos(a))]);
  }
  return out;
}

/** Campiona una curva Catmull-Rom 2D che passa dai punti, a passo costante di lunghezza. */
export function sampleSpline(points: readonly Pt[], n: number): Pt[] {
  const curve = new SplineCurve(points.map((p) => new Vector2(p[0], p[1])));
  return curve.getSpacedPoints(n).map((p) => [Math.max(p.x, 0), p.y] as Pt);
}

/** Interpolazione Catmull-Rom di coppie [t, valore], t crescente. */
export function interpolateStops(stops: readonly Pt[], t: number): number {
  const n = stops.length;
  if (t <= stops[0][0]) return stops[0][1];
  if (t >= stops[n - 1][0]) return stops[n - 1][1];
  let i = 0;
  while (i < n - 2 && t > stops[i + 1][0]) i++;
  const p0 = stops[Math.max(i - 1, 0)][1];
  const p1 = stops[i][1];
  const p2 = stops[i + 1][1];
  const p3 = stops[Math.min(i + 2, n - 1)][1];
  const f = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
  const f2 = f * f;
  const f3 = f2 * f;
  return Math.max(0, 0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f2 + (3 * p1 - p0 - 3 * p2 + p3) * f3));
}

export interface SweepOptions {
  rings: number;
  radial: number;
  spine: (t: number) => Vector3;
  /** Raggio nella direzione phi (radianti) alla posizione t in [0, 1]. */
  radius: (t: number, phi: number) => number;
  /** Rapporto fra i due assi della sezione. */
  ratio?: number;
}

/** Tubo con raggio variabile lungo una spina, chiuso agli estremi. u = giro, v = t. */
export function sweepMesh(o: SweepOptions): BufferGeometry {
  const { rings, radial } = o;
  const ratio = o.ratio ?? 1;
  const b = new MeshBuilder();
  const t0 = o.spine(0);
  const t1 = o.spine(0.01);
  const tan0 = t1.clone().sub(t0).normalize();
  const ref = Math.abs(tan0.z) < 0.9 ? new Vector3(0, 0, 1) : new Vector3(1, 0, 0);
  const c = new Vector3();
  const tan = new Vector3();
  const n1 = new Vector3();
  const n2 = new Vector3();
  const centers: Vector3[] = [];
  for (let j = 0; j <= rings; j++) {
    const t = j / rings;
    c.copy(o.spine(t));
    const a = o.spine(Math.max(0, t - 0.01));
    const d = o.spine(Math.min(1, t + 0.01));
    tan.copy(d).sub(a).normalize();
    n1.copy(tan).cross(ref).normalize();
    n2.copy(tan).cross(n1).normalize();
    centers.push(c.clone());
    for (let k = 0; k <= radial; k++) {
      const phi = (k / radial) * Math.PI * 2;
      const r = o.radius(t, phi);
      const cs = Math.cos(phi) * r;
      const sn = Math.sin(phi) * r * ratio;
      b.vertex(c.x + n1.x * cs + n2.x * sn, c.y + n1.y * cs + n2.y * sn, c.z + n1.z * cs + n2.z * sn, k / radial, t);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let k = 0; k < radial; k++) {
      const a0 = j * (radial + 1) + k;
      b.tri(a0, a0 + 1, a0 + radial + 1);
      b.tri(a0 + 1, a0 + radial + 2, a0 + radial + 1);
    }
  }
  for (const end of [0, rings]) {
    if (o.radius(end / rings, 0) <= 1e-4) continue;
    const cc = centers[end];
    const ci = b.vertex(cc.x, cc.y, cc.z, 0.5, end === 0 ? 0 : 1);
    for (let k = 0; k < radial; k++) {
      const a0 = end * (radial + 1) + k;
      if (end === 0) b.tri(ci, a0 + 1, a0);
      else b.tri(ci, a0, a0 + 1);
    }
  }
  return finishSmooth(b.toGeometry());
}

/** Contorno di un tubo semplice fra punti, per steli e piccioli. */
export function tubeAlong(points: readonly Vector3[], radiusAt: (t: number) => number, radial = 8): BufferGeometry {
  const spine = (t: number) => {
    const f = Math.min(Math.max(t, 0), 1) * (points.length - 1);
    const i = Math.min(Math.floor(f), points.length - 2);
    const u = f - i;
    // Catmull-Rom uniforme sui punti di controllo.
    const p0 = points[Math.max(i - 1, 0)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(i + 2, points.length - 1)];
    const u2 = u * u;
    const u3 = u2 * u;
    return new Vector3(
      0.5 * (2 * p1.x + (p2.x - p0.x) * u + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * u2 + (3 * p1.x - p0.x - 3 * p2.x + p3.x) * u3),
      0.5 * (2 * p1.y + (p2.y - p0.y) * u + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * u2 + (3 * p1.y - p0.y - 3 * p2.y + p3.y) * u3),
      0.5 * (2 * p1.z + (p2.z - p0.z) * u + (2 * p0.z - 5 * p1.z + 4 * p2.z - p3.z) * u2 + (3 * p1.z - p0.z - 3 * p2.z + p3.z) * u3),
    );
  };
  return sweepMesh({ rings: Math.max(6, points.length * 4), radial, spine, radius: (t) => radiusAt(t) });
}

export interface BladeOptions {
  length: number;
  /** Larghezza massima / lunghezza. */
  width: number;
  /** Piegatura lungo la lamina; positiva verso +y. */
  curl: number;
  /** Incavo trasversale. */
  cup: number;
  frill: number;
  rng: Rng;
}

export interface Blade {
  geometry: BufferGeometry;
  /** Coppie di punti [x,y,z, x,y,z] dei tratti di contorno e nervatura. */
  lines: number[];
}

/** Lamina di foglia: cresce lungo +x dall'origine, si piega verso +y, larghezza lungo z. */
export function bladeMesh(o: BladeOptions): Blade {
  const nS = 14;
  const nW = 8;
  const phase = o.rng.range(0, Math.PI * 2);
  const path: Vector3[] = [];
  const normals: Vector3[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i <= nS; i++) {
    const s = i / nS;
    const beta = o.curl * 1.3 * s;
    if (i > 0) {
      x += (Math.cos(beta) * o.length) / nS;
      y += (Math.sin(beta) * o.length) / nS;
    }
    path.push(new Vector3(x, y, 0));
    normals.push(new Vector3(-Math.sin(beta), Math.cos(beta), 0));
  }
  const point = (s: number, w: number): Vector3 => {
    const i = Math.min(Math.round(s * nS), nS);
    const half = o.width * o.length * 0.5 * Math.pow(Math.sin(Math.PI * Math.pow(Math.max(s, 0), 0.8)), 0.9);
    const p = path[i].clone();
    const nrm = normals[i];
    const cupAmt = o.cup * half * w * w;
    const ruffle = o.frill * 0.06 * o.length * Math.pow(Math.abs(w), 1.5) * Math.sin(w * 5 + s * 11 + phase);
    p.addScaledVector(nrm, cupAmt + ruffle);
    p.z += w * half;
    return p;
  };
  const b = new MeshBuilder();
  for (let i = 0; i <= nS; i++) {
    for (let j = 0; j <= nW; j++) {
      const w = (j / nW) * 2 - 1;
      const p = point(i / nS, w);
      b.vertex(p.x, p.y, p.z, j / nW, i / nS);
    }
  }
  for (let i = 0; i < nS; i++) {
    for (let j = 0; j < nW; j++) {
      const a0 = i * (nW + 1) + j;
      b.quad(a0, a0 + 1, a0 + nW + 1, a0 + nW + 2);
    }
  }
  const lines: number[] = [];
  const seg = (a: Vector3, c: Vector3) => lines.push(a.x, a.y, a.z, c.x, c.y, c.z);
  for (let i = 0; i < nS; i++) {
    seg(point(i / nS, -1), point((i + 1) / nS, -1));
    seg(point(i / nS, 1), point((i + 1) / nS, 1));
    seg(point(i / nS, 0), point((i + 1) / nS, 0));
  }
  return { geometry: b.toGeometry(), lines };
}
