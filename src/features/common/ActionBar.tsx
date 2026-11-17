"use client";

import { useEffect, useRef, type ReactElement, type ReactNode } from "react";
import styles from "./ActionBar.module.css";

const HEIGHT_VARIABLE = "--action-bar-height";

/**
 * La barra con l'azione principale di un modulo, fissa sopra la barra di navigazione. Va messa in coda alla schermata:
 * lascia da sola lo spazio che copre e dice la propria altezza all'avviso a comparsa, che così le sta sopra.
 */
export function ActionBar({ children }: { children: ReactNode }): ReactElement {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty(HEIGHT_VARIABLE, `${bar.offsetHeight}px`);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(bar);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(HEIGHT_VARIABLE);
    };
  }, []);

  return (
    <>
      <div className={styles.space} aria-hidden="true" />
      <div ref={barRef} className={styles.bar}>
        {children}
      </div>
    </>
  );
}
