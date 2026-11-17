import { Matrix4, Vector3 } from "three";
import type { LatheParams } from "../recipe";
import { latheMesh, sampleSpline, type Pt } from "../geometry";
import { capPart, labelBand, leafParts, stemPart } from "./details";
import type { BuildContext, RawPart } from "./types";

export function buildLathe(p: LatheParams, ctx: BuildContext): RawPart[] {
  const { rng, variation: v, details } = ctx;
  const n = p.profile.length;
  const yMin = Math.min(...p.profile.map((q) => q[1]));
  const height = Math.max(...p.profile.map((q) => q[1])) - yMin;
  const width = 1 + rng.signed() * 0.06 * v;
  let pts: Pt[] = p.profile.map(([r, y], i) => {
    const jitter = r > 0 && i > 0 && i < n - 1 ? 1 + rng.signed() * 0.015 * v : 1;
    return [(r / height) * width * jitter, (y - yMin) / height];
  });
  const smooth = p.smooth !== false;
  if (smooth) pts = sampleSpline(pts, 72);

  const parts: RawPart[] = [
    {
      name: "body",
      role: "body",
      geometry: latheMesh(pts, { segments: p.segments ?? 56, creaseDeg: smooth ? 50 : 35 }),
      matrix: new Matrix4(),
      outline: 0.012,
    },
  ];

  const top = pts[pts.length - 1];
  const maxR = Math.max(...pts.map((q) => q[0]));
  const base = new Vector3(0, top[1], 0);

  if (details.label) {
    const label = labelBand(pts, details.label);
    if (label) parts.push(label);
  }
  if (details.cap) {
    const radius = details.cap.radius ?? (top[0] > 0.01 ? top[0] * 1.08 : maxR * 0.3);
    parts.push(capPart(0, top[1], 0, radius, details.cap, ctx));
  }
  let leafBase = base;
  if (details.stem) {
    const stem = stemPart(base, details.stem, ctx);
    parts.push(...stem.parts);
    leafBase = stem.tip;
  }
  if (details.leaf) parts.push(...leafParts(leafBase, details.leaf, 35, ctx));
  return parts;
}
