"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import styles from "./sheet.module.css";

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Foglio dal basso su un vero `dialog`: fuoco intrappolato dal browser, Esc lo chiude. */
export function Sheet({ title, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  return (
    <dialog ref={ref} className={styles.sheet} aria-labelledby={titleId} onClose={onClose}>
      <div className={styles.body}>
        <div className={styles.top}>
          <h2 className={styles.title} id={titleId}>
            {title}
          </h2>
          <button type="button" className={styles.close} onClick={() => ref.current?.close()}>
            Chiudi
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
