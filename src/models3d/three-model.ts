/** Trasforma un `Model` (dati puri) in oggetti three pronti da mettere in scena. */
import { EdgesGeometry, Group, LineSegments, Mesh, type BufferGeometry, type Material } from "three";
import type { Model } from "./generate";
import { createEngravingMaterial, createLineMaterial, createOutlineMaterial, type SharedUniforms } from "./materials";

export interface ModelObjectOptions {
  /** Disegna tutto il modello nel colore segnale. */
  signal?: boolean;
  /** Secondo tratteggio incrociato nelle zone scure. Predefinito true. */
  cross?: boolean;
}

export interface ModelObject {
  group: Group;
  /** Libera geometrie dei modelli, geometrie degli spigoli e materiali. */
  dispose(): void;
}

export function createModelObject(model: Model, shared: SharedUniforms, opts: ModelObjectOptions = {}): ModelObject {
  const group = new Group();
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];

  for (const part of model.parts) {
    const holder = new Group();
    holder.name = part.name;
    holder.position.fromArray(part.transform.position);
    holder.rotation.set(...part.transform.rotation);
    holder.scale.setScalar(part.transform.scale);
    const signal = opts.signal === true || part.signal;

    const body = createEngravingMaterial(shared, { strokeScale: part.strokeScale, signal, doubleSided: part.doubleSided, cross: opts.cross });
    materials.push(body);
    holder.add(new Mesh(part.geometry, body));

    if (part.outline > 0 && !part.doubleSided) {
      // la larghezza è nello spazio locale della parte, che ha una sua scala
      const outline = createOutlineMaterial(shared, part.outline / part.transform.scale, signal);
      materials.push(outline);
      holder.add(new Mesh(part.geometry, outline));
    }
    if (part.edgeAngle !== null || part.lines) {
      const lineMat = createLineMaterial(shared, signal);
      materials.push(lineMat);
      if (part.edgeAngle !== null) {
        const edges = new EdgesGeometry(part.geometry, part.edgeAngle);
        geometries.push(edges);
        holder.add(new LineSegments(edges, lineMat));
      }
      if (part.lines) holder.add(new LineSegments(part.lines, lineMat));
    }
    group.add(holder);
  }

  return {
    group,
    dispose() {
      for (const part of model.parts) {
        part.geometry.dispose();
        part.lines?.dispose();
      }
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
