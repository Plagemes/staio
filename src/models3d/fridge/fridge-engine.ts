/**
 * Motore della scena del mobile: un solo contesto grafico, un solo ciclo di disegno. Alimenti uguali condividono
 * geometrie e materiali (si clonano i gruppi, non le geometrie). Si carica con import dinamico da `FridgeScene`.
 */
import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineLoop,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type Mesh,
  type Object3D,
} from "three";
import { buildModel, type Model } from "../generate";
import { applyColors, createGroundShadow, createLineMaterial, createSharedUniforms, type InkColors, type SharedUniforms } from "../materials";
import type { Recipe } from "../recipe";
import { createModelObject, type ModelObject } from "../three-model";
import { frameCamera, type Bounds } from "./framing";
import { furnitureSpec, type FurnitureKind } from "./furniture";
import { itemScale, layoutItems, typicalHeadroom, type Placement } from "./layout";

export interface SceneItem {
  id: string;
  name: string;
  recipe: Recipe;
  seed: string;
  /** Scade presto: disegnato nel colore segnale. */
  signal: boolean;
  /** Quanto resta, da 0 a 1. */
  level: number;
  /** Più basso = più urgente. */
  priority: number;
  prefer?: "drawer" | "door";
  /** Testo per l'elenco accessibile (nome e scadenza). */
  caption?: string;
}

export interface SceneSummary {
  shown: string[];
  hidden: string[];
  placements: Placement[];
}

export interface FridgeEngineOptions {
  colors: InkColors;
  onSelect: (id: string | null) => void;
}

export interface FridgeEngine {
  setScene(kind: FurnitureKind, items: readonly SceneItem[]): SceneSummary;
  setSelected(id: string | null): void;
  setColors(colors: InkColors): void;
  /** Leggero dondolio della scena; da spegnere con prefers-reduced-motion. */
  setSway(on: boolean): void;
  setActive(on: boolean): void;
  dispose(): void;
}

// Campo stretto: la prospettiva resta lieve, così lo sportello che sporge non diventa enorme e il mobile riempie la tela.
const FOV = 14;
const MAX_YAW = 0.55;
const TAP_PX = 6;
const TAP_MS = 600;

interface CachedModel {
  model: Model;
  variants: Map<string, ModelObject>;
}

/** Crea il motore dentro `container`; null se WebGL non è disponibile. */
export function createFridgeEngine(container: HTMLElement, options: FridgeEngineOptions): FridgeEngine | null {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:pan-y;cursor:grab";
  canvas.setAttribute("aria-hidden", "true");

  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "low-power" });
  } catch {
    return null;
  }
  if (!renderer.getContext()) {
    renderer.dispose();
    return null;
  }
  container.appendChild(canvas);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 60);
  const shared: SharedUniforms = createSharedUniforms(options.colors);
  const world = new Group();
  const itemsRoot = new Group();
  world.add(itemsRoot);
  scene.add(world);

  const raycaster = new Raycaster();
  if (raycaster.params.Line) raycaster.params.Line.threshold = 0.0005;

  const models = new Map<string, CachedModel>();
  let furniture: { kind: FurnitureKind; object: ModelObject; shadow: Mesh; bounds: Bounds } | null = null;
  let ring: LineLoop | null = null;
  let layoutById = new Map<string, { world: [number, number, number]; radius: number }>();
  let selected: string | null = null;

  let sway = true;
  let active = false;
  let dirty = true;
  let disposed = false;
  let raf = 0;
  let last = 0;
  let elapsed = 0;
  let yaw = 0;
  let down: { x: number; y: number; t: number; moved: boolean } | null = null;

  const getModel = (item: SceneItem): CachedModel => {
    const key = `${item.recipe.id}|${item.seed}`;
    let entry = models.get(key);
    if (!entry) {
      entry = { model: buildModel(item.recipe, item.seed), variants: new Map() };
      models.set(key, entry);
    }
    return entry;
  };

  const variant = (entry: CachedModel, item: SceneItem): ModelObject => {
    const key = `${item.signal ? "s" : "n"}${item.recipe.hatch?.cross === false ? "0" : "1"}`;
    let obj = entry.variants.get(key);
    if (!obj) {
      obj = createModelObject(entry.model, shared, { signal: item.signal, cross: item.recipe.hatch?.cross });
      entry.variants.set(key, obj);
    }
    return obj;
  };

  const clearRing = () => {
    if (!ring) return;
    world.remove(ring);
    ring.geometry.dispose();
    (ring.material as { dispose(): void }).dispose();
    ring = null;
  };

  const clearItems = () => {
    clearRing();
    for (const child of [...itemsRoot.children]) itemsRoot.remove(child);
  };

  const fit = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (furniture) {
      // l'ingombro comprende gli sportelli aperti: la camera lo inquadra per intero, il più grande possibile
      const framing = frameCamera(furniture.bounds, camera.aspect, FOV, { fill: 0.93 });
      camera.position.set(...framing.position);
      camera.lookAt(...framing.target);
    }
    dirty = true;
  };

  const setFurniture = (next: FurnitureKind) => {
    if (furniture?.kind === next) return;
    if (furniture) {
      world.remove(furniture.object.group, furniture.shadow);
      furniture.object.dispose();
      furniture.shadow.geometry.dispose();
      (furniture.shadow.material as { dispose(): void }).dispose();
    }
    const spec = furnitureSpec(next);
    // mobili a misura: niente normalizzazione, le coordinate sono quelle scritte
    const model = buildModel(spec.recipe, "mobile", { normalize: false });
    const object = createModelObject(model, shared, { soft: 0.85, cross: false });
    const spanX = model.bounds.max[0] - model.bounds.min[0];
    const shadow = createGroundShadow(shared, Math.max(spanX, spec.depth * 2.4) * 1.1);
    shadow.position.set((model.bounds.min[0] + model.bounds.max[0]) / 2, -0.003, 0);
    world.add(object.group, shadow);
    furniture = { kind: next, object, shadow, bounds: model.bounds };
    fit();
  };

  const select = (id: string | null) => {
    selected = id;
    clearRing();
    const found = id ? layoutById.get(id) : undefined;
    if (found) {
      const pts: number[] = [];
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        pts.push(Math.cos(a) * found.radius, 0, Math.sin(a) * found.radius);
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new Float32BufferAttribute(pts, 3));
      ring = new LineLoop(g, createLineMaterial(shared, false));
      ring.position.set(found.world[0], found.world[1] + 0.004, found.world[2]);
      world.add(ring);
    }
    dirty = true;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (sway) {
      elapsed += dt;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      world.rotation.y = yaw + (sway ? 0.09 * Math.sin(elapsed * 0.55) : 0);
      renderer.render(scene, camera);
    }
  };

  const hitItem = (clientX: number, clientY: number): string | null => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    world.rotation.y = yaw + (sway ? 0.09 * Math.sin(elapsed * 0.55) : 0);
    world.updateMatrixWorld(true);
    raycaster.setFromCamera(ndc, camera);
    for (const hit of raycaster.intersectObjects(itemsRoot.children, true)) {
      if (!(hit.object as Mesh).isMesh) continue;
      let o: Object3D | null = hit.object;
      while (o && o.userData.itemId === undefined) o = o.parent;
      if (o) return o.userData.itemId as string;
    }
    return null;
  };

  const onDown = (e: PointerEvent) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = "grabbing";
  };
  const onMove = (e: PointerEvent) => {
    if (!down) return;
    const dx = e.clientX - down.x;
    if (Math.hypot(dx, e.clientY - down.y) > TAP_PX) down.moved = true;
    if (down.moved) {
      yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, yaw + (e.movementX ?? 0) * 0.005));
      dirty = true;
    }
  };
  const onUp = (e: PointerEvent) => {
    const d = down;
    down = null;
    canvas.style.cursor = "grab";
    if (d && !d.moved && performance.now() - d.t < TAP_MS) {
      const id = hitItem(e.clientX, e.clientY);
      select(id);
      options.onSelect(id);
    }
  };
  const onCancel = () => {
    down = null;
    canvas.style.cursor = "grab";
  };
  const onLost = (e: Event) => e.preventDefault();
  const onRestored = () => {
    dirty = true;
  };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(fit) : null;
  observer?.observe(container);
  if (!observer) window.addEventListener("resize", fit);
  fit();

  return {
    setScene(nextKind, items) {
      if (disposed) return { shown: [], hidden: [], placements: [] };
      setFurniture(nextKind);
      clearItems();
      const spec = furnitureSpec(nextKind);
      const prepared = new Map<string, { item: SceneItem; entry: CachedModel; k: number }>();
      const headroom = typicalHeadroom(spec);
      const layoutInput = items.map((item) => {
        const entry = getModel(item);
        const { k, size } = itemScale(item.recipe.heightCm, entry.model.size, item.level, headroom);
        prepared.set(item.id, { item, entry, k });
        return { id: item.id, name: item.name, size, priority: item.priority, prefer: item.prefer };
      });
      const result = layoutItems(spec, layoutInput);
      layoutById = new Map();
      for (const placement of result.placements) {
        const p = prepared.get(placement.id)!;
        const holder = new Group();
        const model = variant(p.entry, p.item).group.clone(true);
        model.scale.setScalar(p.k * placement.scale);
        holder.add(model);
        // i balconcini dello sportello hanno un sistema locale: si porta nel mondo con la loro posizione e rotazione
        const frame = spec.slots.find((sl) => sl.id === placement.slot)?.frame;
        const local = new Vector3(...placement.position);
        if (frame) local.applyAxisAngle(new Vector3(0, 1, 0), frame.rotY).add(new Vector3(...frame.position));
        holder.position.copy(local);
        holder.rotation.y = placement.rotationY + (frame?.rotY ?? 0);
        holder.userData.itemId = placement.id;
        itemsRoot.add(holder);
        const size = p.entry.model.size;
        layoutById.set(placement.id, {
          world: [local.x, local.y, local.z],
          radius: 0.5 * Math.hypot(size[0], size[2]) * p.k * placement.scale + 0.03,
        });
      }
      // la cache tiene solo i modelli della scena corrente: gli altri si liberano (geometrie e materiali compresi)
      const keep = new Set(items.map((i) => `${i.recipe.id}|${i.seed}`));
      for (const [key, entry] of [...models]) {
        if (keep.has(key)) continue;
        for (const obj of entry.variants.values()) obj.dispose();
        for (const part of entry.model.parts) {
          part.geometry.dispose();
          part.lines?.dispose();
        }
        models.delete(key);
      }
      if (selected && layoutById.has(selected)) select(selected);
      else selected = null;
      dirty = true;
      return { shown: result.placements.map((p) => p.id), hidden: result.hidden, placements: result.placements };
    },
    setSelected(id) {
      select(id);
    },
    setColors(colors) {
      applyColors(shared, colors);
      dirty = true;
    },
    setSway(on) {
      sway = on;
      dirty = true;
    },
    setActive(on) {
      if (disposed || on === active) return;
      active = on;
      if (on) {
        last = performance.now();
        dirty = true;
        raf = requestAnimationFrame(frame);
      } else {
        cancelAnimationFrame(raf);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", fit);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onCancel);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      clearItems();
      for (const entry of models.values()) {
        for (const obj of entry.variants.values()) obj.dispose();
        // le geometrie stanno nel modello: se nessuna variante è stata creata vanno liberate da qui
        for (const part of entry.model.parts) {
          part.geometry.dispose();
          part.lines?.dispose();
        }
      }
      models.clear();
      if (furniture) {
        furniture.object.dispose();
        furniture.shadow.geometry.dispose();
        (furniture.shadow.material as { dispose(): void }).dispose();
        furniture = null;
      }
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
