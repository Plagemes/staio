import { Matrix4 } from "three";
import type { BagParams } from "../recipe";
import { MeshBuilder, finishSmooth } from "../geometry";
import type { BuildContext, RawPart } from "./types";

const smoothstep = (x: number) => {
  const t = Math.min(Math.max(x, 0), 1);
  return t * t * (3 - 2 * t);
};

/** Sacchetto a cuscino: sezione ellittica che si schiaccia nelle saldature in testa e in fondo. */
export function buildBag(p: BagParams, ctx: BuildContext): RawPart[] {
  const { rng, variation: v } = ctx;
  const [w0, h0, d0] = p.size;
  const W = (w0 / h0) * (1 + rng.signed() * 0.05 * v);
  const D = (d0 / h0) * (1 + rng.signed() * 0.05 * v);
  const pinch = p.pinch ?? 0.08;
  const wrinkle = p.wrinkle ?? 0.3;
  const a1 = rng.range(0, 6.28);
  const a2 = rng.range(0, 6.28);
  const a3 = rng.range(0, 6.28);
  const M = 36;
  const K = 40;
  const b = new MeshBuilder();
  for (let j = 0; j <= M; j++) {
    const y = 0.5 - 0.5 * Math.cos((Math.PI * j) / M);
    const m = smoothstep(Math.min(y, 1 - y) / pinch);
    const belly = 0.75 + 0.25 * Math.sin(Math.PI * y);
    const t = 0.05 + 0.95 * Math.pow(m, 1.3) * belly;
    const wf = 1 - 0.1 * Math.pow(Math.sin(Math.PI * y), 1.5) * m;
    for (let k = 0; k <= K; k++) {
      const th = (k / K) * Math.PI * 2;
      const nz = wrinkle * 0.06 * (0.6 * Math.sin(th * 2 + a1 + y * 5) + 0.4 * Math.sin(th * 3 + a2 - y * 7)) * m;
      const x = Math.cos(th) * (W / 2) * wf;
      const ripple = 0.012 * D * Math.sin(Math.cos(th) * W * 24 + a3) * (1 - m);
      const z = Math.sin(th) * (D / 2) * t * (1 + nz) + ripple;
      b.vertex(x, y, z, k / K, y);
    }
  }
  for (let j = 0; j < M; j++) {
    for (let k = 0; k < K; k++) {
      const a0 = j * (K + 1) + k;
      b.tri(a0, a0 + 1, a0 + K + 1);
      b.tri(a0 + 1, a0 + K + 2, a0 + K + 1);
    }
  }
  for (const row of [0, M]) {
    const ci = b.vertex(0, row === 0 ? 0 : 1, 0, 0.5, row === 0 ? 0 : 1);
    for (let k = 0; k < K; k++) {
      const a0 = row * (K + 1) + k;
      if (row === 0) b.tri(ci, a0 + 1, a0);
      else b.tri(ci, a0, a0 + 1);
    }
  }
  return [{ name: "body", role: "body", geometry: finishSmooth(b.toGeometry()), matrix: new Matrix4(), outline: 0.01 }];
}
