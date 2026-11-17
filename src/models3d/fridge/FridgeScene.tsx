"use client";

import { useEffect, useRef, useState } from "react";
import { readThemeColors, watchTheme } from "../theme";
import type { FurnitureKind } from "./furniture";
import type { FridgeEngine, SceneItem } from "./fridge-engine";
import styles from "./FridgeScene.module.css";

export interface FridgeSceneProps {
  kind: FurnitureKind;
  items: readonly SceneItem[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Chiamata a ogni nuova disposizione: quali alimenti sono in scena e quali restano fuori. */
  onLayout?: (summary: { shown: string[]; hidden: string[] }) => void;
  /** Descrizione della scena per chi non la vede. */
  label: string;
  /** Rapporto larghezza / altezza della tela (vedi `FurnitureSpec.aspect`). Predefinito 0.9. */
  aspect?: number;
  className?: string;
}

/** Scena del mobile con gli alimenti. Un solo contesto grafico, in pausa fuori schermo o a scheda nascosta. */
export default function FridgeScene({ kind, items, selectedId, onSelect, onLayout, label, aspect = 0.9, className }: FridgeSceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<FridgeEngine | null>(null);
  const latest = useRef({ kind, items, selectedId, onSelect, onLayout });
  const [unsupported, setUnsupported] = useState(false);

  // Nuovi dati: la scena si ridisegna senza ricreare il contesto.
  useEffect(() => {
    latest.current = { kind, items, selectedId, onSelect, onLayout };
    const engine = engineRef.current;
    if (!engine) return;
    const summary = engine.setScene(kind, items);
    engine.setSelected(selectedId);
    onLayout?.({ shown: summary.shown, hidden: summary.hidden });
  }, [kind, items, selectedId, onSelect, onLayout]);

  useEffect(() => {
    const root = rootRef.current;
    const host = hostRef.current;
    if (!root || !host) return;

    let disposed = false;
    let creating = false;
    let failed = false;
    let visible = false;
    let pageVisible = !document.hidden;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");

    const sync = () => {
      const engine = engineRef.current;
      if (visible && pageVisible) {
        if (engine) engine.setActive(true);
        else void create();
      } else {
        engine?.setActive(false);
      }
    };

    const create = async () => {
      if (creating || failed || engineRef.current) return;
      creating = true;
      try {
        const { createFridgeEngine } = await import("./fridge-engine");
        if (disposed) return;
        const engine = createFridgeEngine(host, {
          colors: readThemeColors(root),
          onSelect: (id) => latest.current.onSelect(id),
        });
        if (!engine) {
          failed = true;
          setUnsupported(true);
          return;
        }
        engine.setSway(!reduced.matches);
        engineRef.current = engine;
        const p = latest.current;
        const summary = engine.setScene(p.kind, p.items);
        engine.setSelected(p.selectedId);
        p.onLayout?.({ shown: summary.shown, hidden: summary.hidden });
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
      { rootMargin: "80px" },
    );
    io.observe(root);

    const onVisibility = () => {
      pageVisible = !document.hidden;
      sync();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const unwatchTheme = watchTheme(() => engineRef.current?.setColors(readThemeColors(root)));
    const onMotion = () => engineRef.current?.setSway(!reduced.matches);
    reduced.addEventListener("change", onMotion);

    return () => {
      disposed = true;
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      unwatchTheme();
      reduced.removeEventListener("change", onMotion);
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, []);

  return (
    <div className={className ? `${styles.root} ${className}` : styles.root}>
      <div ref={rootRef} className={styles.stage} style={{ aspectRatio: String(aspect) }} role="img" aria-label={label}>
        <div ref={hostRef} className={styles.host} />
        {unsupported ? <p className={styles.notice}>La scena in 3D non è disponibile su questo dispositivo: ecco l&apos;elenco.</p> : null}
      </div>
      {/* elenco testuale: visibile se la grafica non parte, altrimenti solo per lo screen reader e la tastiera */}
      <ul className={unsupported ? styles.list : styles.srOnly} aria-label="Alimenti">
        {items.map((item) => (
          <li key={item.id}>
            <button type="button" aria-pressed={item.id === selectedId} onClick={() => onSelect(item.id === selectedId ? null : item.id)}>
              {item.caption ?? item.name}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
