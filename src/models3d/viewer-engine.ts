/**
 * Motore di visualizzazione imperativo: scena three, ciclo di disegno, trascinamento.
 * Si carica con un import dinamico da `ModelViewer`, così three entra nel bundle solo quando serve.
 */
import { Group, PerspectiveCamera, Scene, WebGLRenderer } from "three";
import { buildModel } from "./generate";
import { applyColors, createGroundShadow, createSharedUniforms, type InkColors, type SharedUniforms } from "./materials";
import type { Recipe } from "./recipe";
import { createModelObject, type ModelObject } from "./three-model";
import type { Mesh } from "three";

export interface EngineOptions {
  colors: InkColors;
  autoRotate: boolean;
  interactive: boolean;
}

export interface ViewerEngine {
  setModel(recipe: Recipe, seed: string, signal: boolean): void;
  setColors(colors: InkColors): void;
  setAutoRotate(on: boolean): void;
  /** Avvia o ferma il ciclo di disegno. Da fermo non consuma nulla. */
  setActive(on: boolean): void;
  /** Ruota di `radians` attorno all'asse verticale (tastiera). */
  nudge(radians: number): void;
  /** Immagine dell'ultimo fotogramma, o null se non disponibile. */
  snapshot(): string | null;
  dispose(): void;
}

// Inquadratura della prova approvata: il suolo sta a y = -1.05, la figura sale fino a circa 1.05.
const GROUND_Y = -1.05;
const FIT_HEIGHT = 2.1;
const FIT_WIDTH = 3.2;
const ROTATION_SPEED = 0.35;
const FOV = 30;

/** Crea il motore dentro `container`; restituisce null se WebGL non è disponibile. */
export function createViewerEngine(container: HTMLElement, options: EngineOptions): ViewerEngine | null {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = `position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:pan-y;cursor:${options.interactive ? "grab" : "default"}`;
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
  const camera = new PerspectiveCamera(FOV, 1, 0.1, 50);
  camera.position.set(0, 0.95, 6.6);
  camera.lookAt(0, 0.05, 0);

  const shared: SharedUniforms = createSharedUniforms(options.colors);
  const pivot = new Group();
  pivot.rotation.y = -0.5;
  scene.add(pivot);

  let current: ModelObject | null = null;
  let shadow: Mesh | null = null;
  let autoRotate = options.autoRotate;
  let active = false;
  let dirty = true;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let raf = 0;
  let last = 0;
  let disposed = false;

  const clearModel = () => {
    if (current) {
      pivot.remove(current.group);
      current.dispose();
      current = null;
    }
    if (shadow) {
      scene.remove(shadow);
      shadow.geometry.dispose();
      (shadow.material as { dispose(): void }).dispose();
      shadow = null;
    }
  };

  const resize = () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    const aspect = w / h;
    camera.aspect = aspect;
    camera.fov = aspect < 1 ? (2 * Math.atan(Math.tan((FOV * Math.PI) / 360) / aspect) * 180) / Math.PI : FOV;
    camera.updateProjectionMatrix();
    dirty = true;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (autoRotate && !dragging) {
      pivot.rotation.y += dt * ROTATION_SPEED;
      dirty = true;
    }
    if (dirty) {
      dirty = false;
      renderer.render(scene, camera);
    }
  };

  const onDown = (e: PointerEvent) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture?.(e.pointerId);
    canvas.style.cursor = "grabbing";
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging) return;
    pivot.rotation.y += (e.clientX - lastX) * 0.01;
    pivot.rotation.x = Math.max(-0.35, Math.min(0.35, pivot.rotation.x + (e.clientY - lastY) * 0.004));
    lastX = e.clientX;
    lastY = e.clientY;
    dirty = true;
  };
  const onUp = () => {
    dragging = false;
    canvas.style.cursor = "grab";
  };
  const onLost = (e: Event) => e.preventDefault();
  const onRestored = () => {
    dirty = true;
  };

  if (options.interactive) {
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
  }
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);

  const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
  observer?.observe(container);
  if (!observer) window.addEventListener("resize", resize);
  resize();

  return {
    setModel(recipe, seed, signal) {
      if (disposed) return;
      clearModel();
      try {
        const model = buildModel(recipe, seed);
        current = createModelObject(model, shared, { signal, cross: recipe.hatch?.cross });
        const diag = Math.hypot(model.size[0], model.size[2]);
        const fit = Math.min(FIT_HEIGHT / model.size[1], FIT_WIDTH / diag);
        current.group.scale.setScalar(fit);
        current.group.position.y = GROUND_Y;
        pivot.add(current.group);
        shadow = createGroundShadow(shared, Math.min(5, Math.max(2.6, 2.3 * diag * fit)));
        shadow.position.y = GROUND_Y - 0.002;
        scene.add(shadow);
      } catch (error) {
        console.error("Modello 3D non generato", error);
      }
      dirty = true;
    },
    setColors(colors) {
      applyColors(shared, colors);
      dirty = true;
    },
    setAutoRotate(on) {
      autoRotate = on;
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
    nudge(radians) {
      pivot.rotation.y += radians;
      dirty = true;
    },
    snapshot() {
      try {
        renderer.render(scene, camera);
        return canvas.toDataURL("image/png");
      } catch {
        return null;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
      clearModel();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
