/**
 * Impronta numerica della geometria di un modello, per i test che garantiscono che i modelli a incisione non cambino.
 * Considera tutto ciò che il disegno a incisione legge (vertici, normali, UV, tratti, scala dei tratti, trasformazioni);
 * non considera i colori.
 */
import type { BufferGeometry } from "three";
import type { Model } from "./generate";

const QUANT = 1e4;

class Hasher {
  private a = 0x811c9dc5;
  private b = 0x9747b28c;
  int(v: number) {
    this.a = Math.imul(this.a ^ v, 0x01000193);
    this.b = Math.imul(this.b ^ (v + 0x9e3779b9), 0x85ebca6b);
    this.b ^= this.b >>> 13;
  }
  num(v: number) {
    this.int(Math.round(v * QUANT) | 0);
  }
  text(s: string) {
    for (let i = 0; i < s.length; i++) this.int(s.charCodeAt(i));
    this.int(0);
  }
  array(values: ArrayLike<number>) {
    this.int(values.length);
    for (let i = 0; i < values.length; i++) this.num(values[i]);
  }
  geometry(g: BufferGeometry) {
    for (const name of ["position", "normal", "uv", "aOutline"]) {
      const attr = g.getAttribute(name);
      this.text(name);
      if (attr) this.array(attr.array as ArrayLike<number>);
    }
    const index = g.getIndex();
    this.int(index ? index.count : -1);
    if (index) for (let i = 0; i < index.count; i++) this.int(index.getX(i));
  }
  digest(): string {
    return (this.a >>> 0).toString(16).padStart(8, "0") + (this.b >>> 0).toString(16).padStart(8, "0");
  }
}

export function hashModel(model: Model): string {
  const h = new Hasher();
  h.int(model.parts.length);
  for (const part of model.parts) {
    h.text(part.name);
    h.text(part.role);
    h.int((part.signal ? 1 : 0) | (part.doubleSided ? 2 : 0) | (part.cross ? 4 : 0));
    h.num(part.outline);
    h.num(part.edgeAngle ?? -1);
    h.array(part.strokeScale);
    h.array(part.transform.position);
    h.array(part.transform.rotation);
    h.num(part.transform.scale);
    h.geometry(part.geometry);
    h.int(part.lines ? 1 : 0);
    if (part.lines) h.array(part.lines.getAttribute("position").array as ArrayLike<number>);
  }
  h.array(model.size);
  return h.digest();
}
