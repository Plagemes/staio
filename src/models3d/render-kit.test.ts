import { Color, Mesh, ShaderMaterial, type BufferGeometry, type Material, type Object3D } from "three";
import { describe, expect, it } from "vitest";
import { getRecipe } from "./catalog";
import { buildModel, type Model } from "./generate";
import { FALLBACK_COLORS, createSharedUniforms } from "./materials";
import { createStyleKit } from "./render-kit";
import type { ThemeSnapshot } from "./theme";
import { createModelObject } from "./three-model";

const light = (style: ThemeSnapshot["style"]): ThemeSnapshot => ({ style, dark: false, colors: FALLBACK_COLORS });

function meshesOf(root: Object3D): Mesh[] {
  const out: Mesh[] = [];
  root.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

/** Conta quante volte vengono liberati i materiali e le geometrie indicati. */
function watchDispose(materials: Iterable<Material>, geometries: Iterable<BufferGeometry>) {
  const counts = { materials: 0, geometries: 0 };
  for (const m of new Set(materials)) m.addEventListener("dispose", () => counts.materials++);
  for (const g of new Set(geometries)) g.addEventListener("dispose", () => counts.geometries++);
  return counts;
}

function modelOf(id: string): Model {
  return buildModel(getRecipe(id)!);
}

describe("corredo a incisione", () => {
  it("costruisce lo stesso oggetto di prima: stessi materiali e stesso numero di mesh", () => {
    const model = modelOf("fr-mela-golden");
    const direct = createModelObject(model, createSharedUniforms(FALLBACK_COLORS), { cross: undefined });
    const viaKit = createStyleKit(light("engraving")).createObject(model, {});
    expect(meshesOf(viaKit.group).length).toBe(meshesOf(direct.group).length);
    const names = (obj: Object3D) => meshesOf(obj).map((m) => Object.keys((m.material as ShaderMaterial).uniforms).sort().join());
    expect(names(viaKit.group)).toEqual(names(direct.group));
    expect(names(viaKit.group).every((n) => n.includes("uInk"))).toBe(true);
  });
});

describe("corredo a colori", () => {
  it("una mesh per parte, con il colore della parte", () => {
    const model = modelOf("fr-mela-golden");
    const obj = createStyleKit(light("color")).createObject(model, {});
    const meshes = meshesOf(obj.group);
    expect(meshes).toHaveLength(model.parts.length);
    meshes.forEach((mesh, i) => {
      const uniforms = (mesh.material as ShaderMaterial).uniforms;
      expect((uniforms.uColor.value as Color).getHexString()).toBe(new Color(model.parts[i].color).getHexString());
    });
  });

  it("disegna meno mesh dell'incisione, che per ogni parte aggiunge contorno e spigoli", () => {
    for (const id of ["fr-mela-golden", "fr-anguria-fetta", "ds-pelati-lattina", "vd-broccolo"]) {
      const model = modelOf(id);
      const color = meshesOf(createStyleKit(light("color")).createObject(model, {}).group).length;
      const ink = meshesOf(createStyleKit(light("engraving")).createObject(model, {}).group).length;
      expect(color, id).toBeLessThanOrEqual(ink);
    }
  });

  it("i colori restano quelli della ricetta anche con i parametri del tema", () => {
    const kit = createStyleKit({ style: "color", dark: true, colors: FALLBACK_COLORS });
    const obj = kit.createObject(modelOf("fr-limone-spicchio"), {});
    expect(meshesOf(obj.group).every((m) => (m.material as ShaderMaterial).uniforms.uColor)).toBe(true);
    kit.setTheme(light("color"));
  });

  it("ciò che scade ha contorno e punto esclamativo, non solo un colore", () => {
    const model = modelOf("fr-pesca");
    const kit = createStyleKit(light("color"));
    const plain = kit.createObject(model, {});
    const urgent = kit.createObject(model, { signal: true });
    expect(meshesOf(urgent.group).length).toBeGreaterThan(meshesOf(plain.group).length);
    expect(urgent.group.getObjectByName("alert-mark")).toBeDefined();
    expect(plain.group.getObjectByName("alert-mark")).toBeUndefined();
    // il segnale sta sopra al modello
    expect(urgent.group.getObjectByName("alert-mark")!.position.y).toBeGreaterThan(model.bounds.max[1]);
  });

  it("i mobili hanno una tinta attenuabile nel tema scuro", () => {
    const kit = createStyleKit(light("color"));
    const model = modelOf("fr-mela-rossa");
    const furniture = kit.createObject(model, { furniture: true });
    const food = kit.createObject(model, {});
    const dim = (o: Object3D) => (meshesOf(o)[0].material as ShaderMaterial).uniforms.uDim;
    expect(dim(furniture.group)).not.toBe(dim(food.group));
    expect(dim(food.group).value).toBe(1);
    const before = dim(furniture.group).value;
    kit.setTheme({ style: "color", dark: true, colors: FALLBACK_COLORS });
    expect(dim(furniture.group).value).toBeLessThan(before);
  });

  it("il fondo è trasparente: l'ombra di contatto è una mesh trasparente senza scrittura di profondità", () => {
    const shadow = createStyleKit(light("color")).createGroundShadow(3);
    const material = shadow.material as ShaderMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
  });
});

describe("cambio di stile senza perdite", () => {
  it("disposeMaterials libera i materiali ma non le geometrie del modello; dispose libera tutto", () => {
    for (const style of ["engraving", "color"] as const) {
      for (const signal of [false, true]) {
        const model = modelOf("fr-anguria-fetta");
        const kit = createStyleKit(light(style));
        const obj = kit.createObject(model, { signal });
        const materials = meshesOf(obj.group).map((m) => m.material as Material);
        const counts = watchDispose(materials, model.parts.map((p) => p.geometry));
        obj.disposeMaterials();
        expect(counts.geometries, `${style} signal=${signal}`).toBe(0);
        expect(counts.materials, `${style} signal=${signal}`).toBeGreaterThanOrEqual(new Set(materials).size);

        // lo stesso modello serve al nuovo stile, e alla fine si libera tutto
        const other = createStyleKit(light(style === "color" ? "engraving" : "color")).createObject(model, { signal });
        const more = watchDispose(meshesOf(other.group).map((m) => m.material as Material), model.parts.map((p) => p.geometry));
        other.dispose();
        expect(more.geometries).toBeGreaterThanOrEqual(model.parts.length);
        expect(more.materials).toBeGreaterThan(0);
      }
    }
  });

  it("ogni materiale creato dal corredo a colori viene liberato, segnale compreso", () => {
    const model = modelOf("fr-pesca");
    const obj = createStyleKit(light("color")).createObject(model, { signal: true });
    const materials = new Set<Material>();
    obj.group.traverse((o) => {
      const m = (o as Mesh).material as Material | undefined;
      if (m) materials.add(m);
    });
    const counts = watchDispose(materials, []);
    obj.disposeMaterials();
    expect(counts.materials).toBe(materials.size);
  });
});
