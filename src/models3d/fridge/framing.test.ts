import { describe, expect, it } from "vitest";
import { PerspectiveCamera, Vector3 } from "three";
import { buildModel } from "../generate";
import { FURNITURE_KINDS, furnitureSpec } from "./furniture";
import { frameCamera } from "./framing";

const FOV = 14;

function ndcOf(position: number[], target: number[], aspect: number, pts: Vector3[]) {
  const cam = new PerspectiveCamera(FOV, aspect, 0.1, 100);
  cam.position.set(position[0], position[1], position[2]);
  cam.lookAt(target[0], target[1], target[2]);
  cam.updateMatrixWorld(true);
  const proj = pts.map((p) => p.clone().project(cam));
  return {
    minX: Math.min(...proj.map((p) => p.x)),
    maxX: Math.max(...proj.map((p) => p.x)),
    minY: Math.min(...proj.map((p) => p.y)),
    maxY: Math.max(...proj.map((p) => p.y)),
  };
}

const boxPoints = (min: readonly number[], max: readonly number[]) =>
  [min[0], max[0]].flatMap((x) => [min[1], max[1]].flatMap((y) => [min[2], max[2]].map((z) => new Vector3(x, y, z))));

describe("frameCamera", () => {
  it("tiene tutto l'ingombro nella tela e lo centra", () => {
    const b = { min: [-1, 0, -0.5], max: [2, 2, 1] } as const;
    for (const aspect of [0.6, 1, 1.6]) {
      const f = frameCamera(b, aspect, FOV);
      expect(f.ndc.minX).toBeGreaterThanOrEqual(-1);
      expect(f.ndc.maxX).toBeLessThanOrEqual(1);
      expect(f.ndc.minY).toBeGreaterThanOrEqual(-1);
      expect(f.ndc.maxY).toBeLessThanOrEqual(1);
      expect(f.ndc.maxX + f.ndc.minX).toBeCloseTo(0, 2);
      expect(f.ndc.maxY + f.ndc.minY).toBeCloseTo(0, 2);
      expect(Math.max(f.ndc.maxX - f.ndc.minX, f.ndc.maxY - f.ndc.minY) / 2).toBeCloseTo(0.94, 2);
    }
  });

  it("un ingombro più grande richiede la camera più lontana", () => {
    const small = frameCamera({ min: [-1, 0, -1], max: [1, 1, 1] }, 1, FOV);
    const big = frameCamera({ min: [-2, 0, -2], max: [2, 2, 2] }, 1, FOV);
    expect(big.position[2]).toBeGreaterThan(small.position[2]);
  });
});

describe("inquadratura dei mobili", () => {
  for (const kind of FURNITURE_KINDS) {
    it(`${kind}: sportelli compresi sta tutto in vista e il mobile occupa gran parte della tela`, () => {
      const spec = furnitureSpec(kind);
      const model = buildModel(spec.recipe, "m", { normalize: false });
      const f = frameCamera(model.bounds, spec.aspect, FOV);
      expect(f.ndc.maxX).toBeLessThanOrEqual(0.95);
      expect(f.ndc.minX).toBeGreaterThanOrEqual(-0.95);
      expect(f.ndc.maxY).toBeLessThanOrEqual(0.95);
      expect(f.ndc.minY).toBeGreaterThanOrEqual(-0.95);
      const cabinet = ndcOf(f.position, f.target, spec.aspect, boxPoints([-spec.width / 2, 0, -spec.depth / 2], [spec.width / 2, spec.height, spec.depth / 2]));
      const occupied = Math.max((cabinet.maxY - cabinet.minY) / 2, (cabinet.maxX - cabinet.minX) / 2);
      expect(occupied).toBeGreaterThan(kind === "pantry" ? 0.6 : 0.7);
    });
  }
});
