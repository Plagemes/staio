import { Matrix4, type BufferGeometry } from "three";
import type { WedgeParams } from "../recipe";
import { MeshBuilder, orientByNormals } from "../geometry";
import type { BuildContext, RawPart } from "./types";

function finish(b: MeshBuilder): BufferGeometry {
  const g = b.toGeometry();
  orientByNormals(g);
  return g;
}

/** Settore di cilindro con apice nell'origine, aperto verso +x, alto 1. */
export function buildWedge(p: WedgeParams, ctx: BuildContext): RawPart[] {
  const { rng, variation: v } = ctx;
  const R = p.radius * (1 + rng.signed() * 0.05 * v);
  const A = ((p.angleDeg + rng.signed() * 3 * v) * Math.PI) / 180;
  const bulge = (p.bulge ?? 0.04) * (1 + rng.signed() * 0.2 * v);
  const radiusAt = (y: number) => R * (1 + bulge * Math.sin(Math.PI * y));
  const dRadius = (y: number) => R * bulge * Math.PI * Math.cos(Math.PI * y);
  const nA = Math.max(8, Math.ceil((A / Math.PI) * 24));
  const nY = 10;
  const nR = 6;

  const outer = new MeshBuilder();
  for (let j = 0; j <= nY; j++) {
    const y = j / nY;
    for (let i = 0; i <= nA; i++) {
      const phi = -A / 2 + (A * i) / nA;
      const r = radiusAt(y);
      const l = Math.hypot(Math.cos(phi), dRadius(y), Math.sin(phi));
      outer.vertex(r * Math.cos(phi), y, r * Math.sin(phi), i / nA, y, [Math.cos(phi) / l, -dRadius(y) / l, Math.sin(phi) / l]);
    }
  }
  for (let j = 0; j < nY; j++) {
    for (let i = 0; i < nA; i++) {
      const a0 = j * (nA + 1) + i;
      outer.quad(a0, a0 + 1, a0 + nA + 1, a0 + nA + 2);
    }
  }

  const flat = new MeshBuilder();
  for (const y of [0, 1]) {
    const first = flat.count;
    for (let k = 0; k <= nR; k++) {
      for (let i = 0; i <= nA; i++) {
        const phi = -A / 2 + (A * i) / nA;
        const r = (k / nR) * radiusAt(y);
        flat.vertex(r * Math.cos(phi), y, r * Math.sin(phi), r * Math.cos(phi), r * Math.sin(phi), [0, y === 1 ? 1 : -1, 0]);
      }
    }
    for (let k = 0; k < nR; k++) {
      for (let i = 0; i < nA; i++) {
        const a0 = first + k * (nA + 1) + i;
        flat.quad(a0, a0 + 1, a0 + nA + 1, a0 + nA + 2);
      }
    }
  }
  for (const side of [-1, 1]) {
    const phi = (side * A) / 2;
    const first = flat.count;
    // normale uscente dal piano di taglio, perpendicolare al bordo
    const nn: [number, number, number] = [-side * Math.sin(phi), 0, side * Math.cos(phi)];
    for (let j = 0; j <= nY; j++) {
      const y = j / nY;
      for (let k = 0; k <= nR; k++) {
        const r = (k / nR) * radiusAt(y);
        flat.vertex(r * Math.cos(phi), y, r * Math.sin(phi), r, y, nn);
      }
    }
    for (let j = 0; j < nY; j++) {
      for (let k = 0; k < nR; k++) {
        const a0 = first + j * (nR + 1) + k;
        flat.quad(a0, a0 + 1, a0 + nR + 1, a0 + nR + 2);
      }
    }
  }

  if (p.rind !== false) {
    return [
      { name: "body", role: "body", geometry: finish(flat), matrix: new Matrix4(), outline: 0.008, edgeAngle: 30 },
      { name: "rind", role: "rind", geometry: finish(outer), matrix: new Matrix4(), outline: 0.008, edgeAngle: 30, densityMul: 1.3 },
    ];
  }
  const merged = new MeshBuilder();
  merged.append(finish(flat), new Matrix4());
  merged.append(finish(outer), new Matrix4());
  return [{ name: "body", role: "body", geometry: merged.toGeometry(), matrix: new Matrix4(), outline: 0.008, edgeAngle: 30 }];
}
