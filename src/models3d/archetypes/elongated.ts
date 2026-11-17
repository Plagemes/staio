import { Matrix4, Vector3 } from "three";
import type { ElongatedParams } from "../recipe";
import { interpolateStops, sweepMesh } from "../geometry";
import { leafParts, stemPart } from "./details";
import type { BuildContext, RawPart } from "./types";

/** Forma allungata lungo un asse curvo (lunghezza 1, dal basso verso l'alto) con raggio variabile. */
export function buildElongated(p: ElongatedParams, ctx: BuildContext): RawPart[] {
  const { rng, variation: v, details } = ctx;
  const bend = Math.min(1, Math.max(-1, (p.bend ?? 0) + rng.signed() * 0.12 * v));
  const wobble = p.wobble ?? 0.04;
  const girth = 1 + rng.signed() * 0.06 * v;
  const ph1 = rng.range(0, 6.28);
  const ph2 = rng.range(0, 6.28);
  const spine = (t: number) => new Vector3(bend * 1.2 * t * (1 - t), t, 0);
  const geometry = sweepMesh({
    rings: 56,
    radial: 28,
    spine,
    ratio: p.ratio ?? 1,
    radius: (t, phi) => {
      const w = 1 + wobble * (0.6 * Math.sin(phi * 2 + ph1 + t * 6) + 0.4 * Math.sin(phi * 3 + ph2 - t * 9));
      return interpolateStops(p.radii, t) * girth * w;
    },
  });
  const parts: RawPart[] = [{ name: "body", role: "body", geometry, matrix: new Matrix4(), outline: 0.012 }];
  const top = spine(1);
  let leafBase = top;
  if (details.stem) {
    const stem = stemPart(top, details.stem, ctx);
    parts.push(...stem.parts);
    leafBase = stem.tip;
  }
  if (details.leaf) parts.push(...leafParts(leafBase, details.leaf, 68, ctx));
  return parts;
}
