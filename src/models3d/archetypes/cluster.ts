import { Matrix4, Vector3 } from "three";
import type { ClusterParams } from "../recipe";
import { MeshBuilder, ellipsoidProfile, latheMesh, tubeAlong } from "../geometry";
import type { BuildContext, RawPart } from "./types";

const GOLDEN = 2.39996;

/** Spinge gli elementi sovrapposti finché non si toccano appena. */
function relax(pos: Vector3[], rad: number[], elong: number) {
  const d = new Vector3();
  for (let it = 0; it < 30; it++) {
    for (let i = 0; i < pos.length; i++) {
      for (let j = i + 1; j < pos.length; j++) {
        d.copy(pos[j]).sub(pos[i]);
        d.y /= elong;
        const dist = d.length();
        const min = (rad[i] + rad[j]) * 0.92;
        if (dist >= min || dist < 1e-6) continue;
        d.multiplyScalar((min - dist) / dist / 2);
        d.y *= elong;
        pos[i].sub(d);
        pos[j].add(d);
      }
    }
  }
}

export function buildCluster(p: ClusterParams, ctx: BuildContext): RawPart[] {
  const { rng, variation: v } = ctx;
  const n = p.count;
  const r0 = p.elementRadius;
  const elong = p.elongation ?? 1;
  const spread = p.spread ?? 0.5;
  const stalk = p.stalk ?? 0.2;
  const pos: Vector3[] = [];
  const rad: number[] = [];
  const spineX = (t: number) => 0.18 * Math.sin(t * Math.PI * 0.9);

  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    rad.push(r0 * (1 + rng.signed() * 0.1 * v));
    const phi = i * GOLDEN + rng.signed() * 0.3 * v;
    if (p.layout === "hanging") {
      const y = 1 - 0.9 * Math.pow(t, 0.85);
      const rho = Math.sqrt(rng.next()) * spread * 0.5 * (0.15 + 0.85 * Math.pow(y, 0.9));
      pos.push(new Vector3(rho * Math.cos(phi), y, rho * Math.sin(phi)));
    } else if (p.layout === "heap") {
      const rho = Math.sqrt(t) * spread * 0.5;
      const y = r0 * elong + (1 - t) * Math.min(0.3, r0 * 3);
      pos.push(new Vector3(rho * Math.cos(phi), y, rho * Math.sin(phi)));
    } else {
      const side = i % 2 === 0 ? 1 : -1;
      const y = 1 - 0.85 * t;
      pos.push(new Vector3(spineX(t) + side * (r0 * 1.3 + 0.03), y, rng.signed() * r0 * 0.5));
    }
  }
  relax(pos, rad, elong);

  const base = latheMesh(ellipsoidProfile(1, elong, 12), { segments: 18, creaseDeg: 80 });
  const elements = new MeshBuilder();
  let topY = -Infinity;
  pos.forEach((c, i) => {
    const m = new Matrix4()
      .makeTranslation(c.x, c.y, c.z)
      .multiply(new Matrix4().makeRotationY(rng.range(0, Math.PI * 2)))
      .multiply(new Matrix4().makeScale(rad[i], rad[i], rad[i]))
      .multiply(new Matrix4().makeTranslation(0, -elong, 0));
    elements.append(base, m);
    topY = Math.max(topY, c.y + rad[i] * elong);
  });
  base.dispose();

  const parts: RawPart[] = [{ name: "elements", role: "body", geometry: elements.toGeometry(), matrix: new Matrix4(), outline: 0.01 }];
  const stems = new MeshBuilder();
  if (p.layout === "hanging") {
    const pts = [
      new Vector3(0, topY - 0.25, 0),
      new Vector3(0.01, topY, 0),
      new Vector3(0.03, topY + stalk * 0.6, 0),
      new Vector3(0.07, topY + stalk, 0),
    ];
    stems.append(tubeAlong(pts, (t) => 0.016 * (1 - 0.3 * t), 8), new Matrix4());
  } else if (p.layout === "truss") {
    const top = Math.max(topY, 1) + stalk;
    const pts = [0, 0.25, 0.5, 0.75, 1].map((t) => new Vector3(spineX(t * 0.9) * 0.9, top - (top - 0.1) * t, 0));
    stems.append(tubeAlong(pts, () => 0.014, 8), new Matrix4());
    pos.forEach((c, i) => {
      const y = c.y + rad[i] * elong * 0.9;
      const t = Math.min(1, Math.max(0, (top - y) / (top - 0.1)));
      const sx = spineX(t * 0.9) * 0.9;
      const ped = [new Vector3(sx, y + 0.03, 0), new Vector3((sx + c.x) / 2, y + 0.015, c.z / 2), new Vector3(c.x, y, c.z)];
      stems.append(tubeAlong(ped, () => 0.008, 5), new Matrix4());
    });
  }
  if (stems.count > 0) parts.push({ name: "stalk", role: "stem", geometry: stems.toGeometry(), matrix: new Matrix4(), outline: 0.005 });
  return parts;
}
