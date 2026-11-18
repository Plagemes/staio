"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appendEvents, getDeviceId } from "@/data";
import type { AnyEvent } from "@/core/events";
import { buildUndo } from "./actions";
import styles from "./notice.module.css";

interface NoticeInput {
  message: string;
  /** Eventi appena scritti: «Annulla» li annulla con un `void` ciascuno. */
  undo?: readonly AnyEvent[];
  /** In alternativa agli eventi: un'azione che rimette le cose com'erano (per esempio per le impostazioni). */
  onUndo?: () => Promise<void>;
  /** Un rimando con un tocco, per esempio «Vedi in Oggi»: dopo il tocco l'avviso si chiude. */
  link?: { label: string; href: string };
}

interface NoticeState {
  id: number;
  message: string;
  undo?: readonly AnyEvent[];
  onUndo?: () => Promise<void>;
  link?: { label: string; href: string };
  busy: boolean;
}

interface NoticeApi {
  show: (notice: NoticeInput) => void;
}

const NoticeContext = createContext<NoticeApi | null>(null);

const VISIBLE_MS = 15_000;

export function useNotice(): NoticeApi {
  const api = useContext(NoticeContext);
  if (!api) throw new Error("useNotice va usato dentro NoticeProvider");
  return api;
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const counter = useRef(0);

  const show = useCallback((input: NoticeInput) => {
    counter.current += 1;
    setNotice({ id: counter.current, message: input.message, undo: input.undo, onUndo: input.onUndo, link: input.link, busy: false });
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  // si chiude da sola, ma non mentre si sta usando il pulsante
  useEffect(() => {
    if (!notice || notice.busy) return;
    const timer = window.setTimeout(() => setNotice(null), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function undo() {
    if (!notice?.undo && !notice?.onUndo) return;
    const { undo: events, onUndo } = notice;
    setNotice({ ...notice, busy: true });
    try {
      if (onUndo) await onUndo();
      if (events) {
        const deviceId = await getDeviceId();
        await appendEvents(buildUndo(events, { now: new Date().toISOString(), deviceId }));
      }
      show({ message: "Annullato." });
    } catch {
      show({ message: "Non sono riuscito ad annullare. Riprova." });
    }
  }

  return (
    <NoticeContext.Provider value={api}>
      {children}
      {notice ? (
        <div className={styles.dock}>
          <div className={notice.link && (notice.undo || notice.onUndo) ? `${styles.notice} ${styles.twoCommands}` : styles.notice} role="status" aria-live="polite" key={notice.id}>
            <p className={styles.message}>{notice.message}</p>
            {notice.undo || notice.onUndo ? (
              <button type="button" className={styles.undo} onClick={undo} disabled={notice.busy}>
                Annulla
              </button>
            ) : null}
            {notice.link ? (
              <Link href={notice.link.href} className={styles.link} onClick={() => setNotice(null)}>
                {notice.link.label}
              </Link>
            ) : null}
            <button type="button" className={styles.close} onClick={() => setNotice(null)} aria-label="Chiudi avviso">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </NoticeContext.Provider>
  );
}
