import { Euler, Matrix4, Vector3 } from "three";
import type { FloretsParams } from "../recipe";
import { MeshBuilder, bladeMesh, finishSmooth, tubeAlong } from "../geometry";
import type { Rng } from "../rng";
import type { BuildContext, RawPart } from "./types";

const GOLDEN = 2.39996;
const deg = (d: number) => (d * Math.PI) / 180;

/** Pallina di raggio 1 con la superficie bernoccoluta. */
function floretMesh(bump: number, rng: Rng) {
  const rings = 9;
  const segs = 14;
  const ph = [rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28)];
  const b = new MeshBuilder();
  for (let j = 0; j <= rings; j++) {
    const polar = (j / rings) * Math.PI;
    for (let i = 0; i <= segs; i++) {
      const az = (i / segs) * Math.PI * 2;
      const lump = 0.5 * Math.sin(3 * az + ph[0]) * Math.sin(4 * polar + ph[1]) + 0.5 * Math.sin(7 * az + ph[2]) * Math.sin(6 * polar + ph[3]);
      const r = 1 + bump * 0.22 * lump;
      b.vertex(r * Math.sin(polar) * Math.cos(az), r * Math.cos(polar), r * Math.sin(polar) * Math.sin(az), i / segs, j / rings);
    }
  }
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < segs; i++) {
      const a = j * (segs + 1) + i;
      b.quad(a, a + 1, a + segs + 1, a + segs + 2);
    }
  }
  return finishSmooth(b.toGeometry());
}

/** Testa a cupola di cimette su un gambo (broccolo, cavolfiore). Larghezza della testa = 1. */
export function buildFlorets(p: FloretsParams, ctx: BuildContext): RawPart[] {
  const { rng, variation: v } = ctx;
  const n = p.count;
  const dome = p.dome ?? 0.6;
  const bump = p.bump ?? 0.5;
  const stalk = (p.stalk ?? 0.5) * (1 + rng.signed() * 0.1 * v);
  const trunk = p.trunk ?? 0.12;
  const size = p.floretSize ?? 1;

  const headR = 0.5 * (1 + rng.signed() * 0.05 * v);
  const h = headR * (0.15 + 0.85 * dome);
  const sphere = (headR * headR + h * h) / (2 * h);
  const cosMax = (sphere - h) / sphere;
  const cy = stalk + h - sphere;
  const capArea = 2 * Math.PI * sphere * h;
  const rf = size * Math.sqrt(capArea / (n * Math.PI)) * 1.15;

  const heads = new MeshBuilder();
  const branches = new MeshBuilder();
  const top = new Vector3(0, stalk, 0);
  const turn = rng.range(0, Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const u = (i + 0.5) / n;
    const theta = Math.acos(1 - u * (1 - cosMax));
    const phi = turn + i * GOLDEN + rng.signed() * 0.2 * v;
    const dir = new Vector3(Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi));
    const r = rf * (1 + rng.signed() * 0.12 * v);
    const centre = new Vector3(0, cy, 0).addScaledVector(dir, sphere - r * 0.35);
    const ball = floretMesh(bump, rng);
    const m = new Matrix4()
      .makeTranslation(centre.x, centre.y, centre.z)
      .multiply(new Matrix4().makeRotationFromEuler(new Euler(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28))))
      .multiply(new Matrix4().makeScale(r, r * 0.92, r));
    heads.append(ball, m);
    ball.dispose();
    const start = top.clone().add(new Vector3(0, -0.02, 0));
    const end = centre.clone().addScaledVector(dir, -r * 0.9);
    const mid = start.clone().lerp(end, 0.5).add(new Vector3(0, 0.03, 0));
    branches.append(tubeAlong([start, mid, end], () => 0.022 * size, 5), new Matrix4());
  }

  const trunkGeo = tubeAlong(
    [new Vector3(0, 0, 0), new Vector3(0, stalk * 0.5, 0), top.clone().add(new Vector3(0, 0.03, 0))],
    (t) => trunk * (1 + 0.35 * Math.pow(1 - t, 2)) * (1 - 0.1 * t),
    12,
  );
  branches.append(trunkGeo, new Matrix4());
  trunkGeo.dispose();

  const parts: RawPart[] = [
    { name: "florets", role: "body", geometry: heads.toGeometry(), matrix: new Matrix4(), outline: 0.008 },
    { name: "stalk", role: "stem", geometry: branches.toGeometry(), matrix: new Matrix4(), outline: 0.006 },
  ];

  const wrap = p.wrap ?? 0;
  if (wrap > 0) {
    const blades = new MeshBuilder();
    const lines: number[] = [];
    const length = (p.wrapLength ?? 0.9) * (1 + rng.signed() * 0.08 * v);
    const p3 = new Vector3();
    for (let k = 0; k < wrap; k++) {
      const phi = turn + (k / wrap) * Math.PI * 2 + rng.signed() * 0.2 * v;
      const lean = deg(72 + rng.signed() * 8 * v);
      const blade = bladeMesh({ length, width: 0.55, curl: -0.25, cup: 0.5, frill: 0.1, rng });
      const m = new Matrix4()
        .makeTranslation(Math.cos(phi) * trunk, stalk * 0.45, Math.sin(phi) * trunk)
        .multiply(new Matrix4().makeRotationFromEuler(new Euler(0, phi, lean, "YXZ")));
      blades.append(blade.geometry, m);
      blade.geometry.dispose();
      for (let i = 0; i < blade.lines.length; i += 3) {
        p3.set(blade.lines[i], blade.lines[i + 1], blade.lines[i + 2]).applyMatrix4(m);
        lines.push(p3.x, p3.y, p3.z);
      }
    }
    parts.push({ name: "wrap", role: "leaf", geometry: blades.toGeometry(), lines, matrix: new Matrix4(), outline: 0, doubleSided: true, densityMul: 1.5 });
  }
  return parts;
}
