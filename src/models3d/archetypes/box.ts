import { Matrix4, type BufferGeometry } from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { BoxParams } from "../recipe";
import { MeshBuilder, orientByNormals } from "../geometry";
import { capPart } from "./details";
import type { BuildContext, RawPart } from "./types";

/** Scatola centrata nell'origine con UV in unità fisiche (stesso passo di tratto su ogni faccia). */
export function boxMesh(w: number, h: number, d: number): BufferGeometry {
  const b = new MeshBuilder();
  const faces: { n: [number, number, number]; u: [number, number, number]; v: [number, number, number]; su: number; sv: number }[] = [
    { n: [1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], su: d, sv: h },
    { n: [-1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], su: d, sv: h },
    { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1], su: w, sv: d },
    { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, -1], su: w, sv: d },
    { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], su: w, sv: h },
    { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], su: w, sv: h },
  ];
  const half = [w / 2, h / 2, d / 2];
  for (const f of faces) {
    const idx: number[] = [];
    for (const [a, c] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) {
      const p = [0, 1, 2].map((i) => f.n[i] * half[i] + f.u[i] * a * (f.su / 2) + f.v[i] * c * (f.sv / 2));
      idx.push(b.vertex(p[0], p[1], p[2], (a + 1) * 0.5 * f.su, (c + 1) * 0.5 * f.sv, f.n));
    }
    b.quad(idx[0], idx[1], idx[2], idx[3]);
  }
  const g = b.toGeometry();
  orientByNormals(g);
  return g;
}

function roundedBox(w: number, h: number, d: number, radius: number): BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 3, radius) as unknown as BufferGeometry;
  const uv = g.getAttribute("uv");
  const per = uv.count / 6;
  const sizes: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let i = 0; i < uv.count; i++) {
    const [su, sv] = sizes[Math.min(5, Math.floor(i / per))];
    uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  }
  return g;
}

export function buildBox(p: BoxParams, ctx: BuildContext): RawPart[] {
  const { rng, variation: v, details } = ctx;
  const [w0, h0, d0] = p.size;
  const w = (w0 / h0) * (1 + rng.signed() * 0.04 * v);
  const d = (d0 / h0) * (1 + rng.signed() * 0.04 * v);
  const bevel = p.bevel ?? 0;
  const body = bevel > 0 ? roundedBox(w, 1, d, bevel * Math.min(w, 1, d)) : boxMesh(w, 1, d);
  const parts: RawPart[] = [
    {
      name: "body",
      role: "body",
      geometry: body,
      matrix: new Matrix4().makeTranslation(0, 0.5, 0),
      outline: 0.008,
      edgeAngle: bevel > 0 ? undefined : 30,
    },
  ];
  if (details.label) {
    const { from, to } = details.label;
    const lw = w * 0.8;
    parts.push({
      name: "label",
      role: "label",
      geometry: boxMesh(lw, to - from, 0.008),
      matrix: new Matrix4().makeTranslation(0, (from + to) / 2, d / 2 + 0.003),
      outline: 0,
      edgeAngle: 30,
      signal: details.label.signal === true,
      densityMul: 0.5,
    });
  }
  if (details.cap) {
    const [ox, oz] = details.cap.offset ?? [0, 0];
    const radius = details.cap.radius ?? Math.min(w, d) * 0.14;
    parts.push(capPart(ox * w * 0.4, 1, oz * d * 0.4, radius, details.cap, ctx));
  }
  return parts;
}
