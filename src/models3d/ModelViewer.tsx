"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Recipe } from "./recipe";
import type { ViewerEngine } from "./viewer-engine";
import { readThemeColors, watchTheme } from "./theme";
import styles from "./ModelViewer.module.css";

export interface ModelViewerProps {
  recipe: Recipe;
  /** Seme della variazione naturale. Predefinito: l'id della ricetta. */
  seed?: string;
  /** Disegna il modello nel colore segnale. */
  signal?: boolean;
  /** Rotazione lenta. Si ferma comunque con prefers-reduced-motion. Predefinito true. */
  autoRotate?: boolean;
  /** Trascinamento per ruotare. Predefinito true. */
  interactive?: boolean;
  className?: string;
}

/** Dopo quanto fuori schermo si rilascia il contesto WebGL (i telefoni ne concedono pochi). */
const RELEASE_DELAY_MS = 2000;
/** Attesa prima di riprovare quando i contesti WebGL consentiti sono tutti occupati da figure visibili. */
const RETRY_DELAY_MS = 400;

interface LiveViewer {
  release(): void;
  isVisible(): boolean;
}

/** Visualizzatori con un contesto WebGL aperto, in tutta la pagina. */
const live = new Set<LiveViewer>();

function maxLive(): number {
  return window.matchMedia?.("(pointer: coarse)").matches ? 8 : 12;
}

/** Fa posto a un nuovo contesto liberando figure fuori schermo; false se sono tutte visibili. */
function makeRoom(): boolean {
  const max = maxLive();
  if (live.size < max) return true;
  for (const viewer of [...live]) {
    if (!viewer.isVisible()) {
      viewer.release();
      if (live.size < max) return true;
    }
  }
  return live.size < max;
}

export default function ModelViewer({ recipe, seed, signal = false, autoRotate = true, interactive = true, className }: ModelViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<ViewerEngine | null>(null);
  const latest = useRef({ recipe, seed: seed ?? recipe.id, signal, autoRotate, interactive });
  const [unsupported, setUnsupported] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);

  // Nuove proprietà: la scena si aggiorna senza ricreare il contesto.
  useEffect(() => {
    latest.current = { recipe, seed: seed ?? recipe.id, signal, autoRotate, interactive };
    const engine = engineRef.current;
    if (!engine) return;
    engine.setModel(recipe, seed ?? recipe.id, signal);
    engine.setAutoRotate(autoRotate && !window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, [recipe, seed, signal, autoRotate, interactive]);

  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) return;

    let disposed = false;
    let creating = false;
    let failed = false;
    let visible = false;
    let pageVisible = !document.hidden;
    let releaseTimer: number | undefined;
    let retryTimer: number | undefined;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const handle: LiveViewer = { release: () => release(), isVisible: () => visible };

    const release = () => {
      window.clearTimeout(releaseTimer);
      releaseTimer = undefined;
      const engine = engineRef.current;
      if (!engine) return;
      const shot = engine.snapshot();
      engine.dispose();
      engineRef.current = null;
      live.delete(handle);
      setPoster(shot);
    };

    const sync = () => {
      const engine = engineRef.current;
      if (visible && pageVisible) {
        window.clearTimeout(releaseTimer);
        releaseTimer = undefined;
        if (engine) engine.setActive(true);
        else void create();
      } else if (engine) {
        engine.setActive(false);
        // la scheda nascosta si ferma soltanto; fuori schermo, dopo un po', libera il contesto
        if (!visible && releaseTimer === undefined) releaseTimer = window.setTimeout(release, RELEASE_DELAY_MS);
      }
    };

    const create = async () => {
      if (creating || failed || engineRef.current) return;
      creating = true;
      try {
        const { createViewerEngine } = await import("./viewer-engine");
        if (disposed) return;
        if (!makeRoom()) {
          // tutti i contesti sono su figure visibili: si riprova fra poco
          retryTimer = window.setTimeout(sync, RETRY_DELAY_MS);
          return;
        }
        const p = latest.current;
        const engine = createViewerEngine(host, {
          colors: readThemeColors(root),
          autoRotate: p.autoRotate && !reduced.matches,
          interactive: p.interactive,
        });
        if (!engine) {
          failed = true;
          setUnsupported(true);
          return;
        }
        engine.setModel(p.recipe, p.seed, p.signal);
        engineRef.current = engine;
        live.add(handle);
        setPoster(null);
        sync();
      } catch {
        failed = true;
        setUnsupported(true);
      } finally {
        creating = false;
      }
    };

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[entries.length - 1].isIntersecting;
        sync();
      },
      { rootMargin: "100px" },
    );
    io.observe(root);

    const onVisibility = () => {
      pageVisible = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const unwatchTheme = watchTheme(() => engineRef.current?.setColors(readThemeColors(root)));
    const onMotion = () => engineRef.current?.setAutoRotate(latest.current.autoRotate && !reduced.matches);
    reduced.addEventListener("change", onMotion);

    return () => {
      disposed = true;
      window.clearTimeout(releaseTimer);
      window.clearTimeout(retryTimer);
      live.delete(handle);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      unwatchTheme();
      reduced.removeEventListener("change", onMotion);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent) => {
    if (!interactive) return;
    if (e.key === "ArrowLeft") engineRef.current?.nudge(-0.2);
    else if (e.key === "ArrowRight") engineRef.current?.nudge(0.2);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={rootRef}
      className={className ? `${styles.root} ${className}` : styles.root}
      role="img"
      aria-label={`Modello tridimensionale: ${recipe.name}`}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={onKeyDown}
    >
      {/* il canvas è creato e rimosso dal motore: React non ne gestisce i figli */}
      <div ref={hostRef} className={styles.host} />
      {/* istantanea locale (data URL): next/image non serve */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {poster ? <img className={styles.poster} src={poster} alt="" /> : null}
      {unsupported ? <p className={styles.fallback}>{recipe.name}: l&apos;anteprima 3D non è disponibile su questo dispositivo.</p> : null}
    </div>
  );
}
