"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, type MouseEvent, type ReactElement, type ReactNode } from "react";
import { cx } from "@/design";
import ui from "../ui.module.css";
import styles from "./Sheet.module.css";
import { isInternalHref, useSheetHistory } from "./sheetHistory";

export interface SheetProps {
  title: string;
  /** Chiamata una sola volta, quando il foglio va chiuso (da «Chiudi», dal tocco fuori, da Esc, dal tasto indietro). */
  onClose: () => void;
  /** Il corpo: è l'unica parte che scorre. */
  children: ReactNode;
  /** Il titolo resta per il lettore dello schermo ma non si vede: lo mostra `head` a modo suo (la scheda dell'alimento, con figura e nome affiancati). */
  titleHidden?: boolean;
  /** Sotto il titolo, dentro la testa: figura, stato, avviso. Non scorre. */
  head?: ReactNode;
  /** Fisso in fondo: pulsante principale e, al massimo, una riga di secondari. */
  footer?: ReactNode;
  /** Azione in corso: «Chiudi», il tocco fuori ed Esc non chiudono. */
  busy?: boolean;
}

/**
 * Il foglio dal basso, unico per tutta l'app. È aperto finché è montato: chi lo usa lo rende solo quando serve e,
 * in `onClose`, smette di renderlo. Il tasto indietro del telefono lo chiude (vedi `sheetHistory.ts`).
 * Una navigazione da codice che segue la chiusura va fatta con `closeSheetThen(() => router.push(…))`.
 */
export function Sheet({ title, onClose, children, titleHidden = false, head, footer, busy = false }: SheetProps): ReactElement {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const router = useRouter();
  const closedRef = useRef(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /** L'unica porta d'uscita: tutte le chiusure passano da qui. */
  const close = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current();
  }, []);

  const step = useSheetHistory(close);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  const requestClose = () => {
    if (!busy) close();
  };

  /** Un collegamento interno chiude il foglio e parte quando il suo passo è stato tolto: tornando indietro non resta un passo vuoto. */
  const followLink = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!(link instanceof HTMLAnchorElement)) return;
    const href = link.getAttribute("href");
    if (!isInternalHref(href) || href === null) return;
    if ((link.target !== "" && link.target !== "_self") || link.hasAttribute("download")) return;
    event.preventDefault();
    const elsewhere = new URL(href, window.location.href).href !== window.location.href;
    step.closeThen(() => {
      if (elsewhere) router.push(href);
    });
  };

  const closeButton = (
    <button type="button" className={styles.close} onClick={requestClose} aria-disabled={busy || undefined}>
      Chiudi
    </button>
  );

  return (
    <dialog
      ref={dialogRef}
      className={styles.sheet}
      aria-labelledby={titleId}
      // in sviluppo React monta due volte: un evento di chiusura che arriva a foglio già riaperto va ignorato
      onClose={(event) => {
        if (!event.currentTarget.open) close();
      }}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
      onClickCapture={followLink}
    >
      <div className={styles.top}>
        <span className={styles.grip} aria-hidden="true" />
        {titleHidden ? (
          <div className={styles.bar}>
            <h2 className={ui.srOnly} id={titleId}>
              {title}
            </h2>
            <div className={styles.headBeside}>{head}</div>
            {closeButton}
          </div>
        ) : (
          <>
            <div className={styles.bar}>
              <h2 className={styles.title} id={titleId}>
                {title}
              </h2>
              {closeButton}
            </div>
            {head ? <div className={styles.head}>{head}</div> : null}
          </>
        )}
      </div>
      <div className={cx(styles.body, footer ? styles.bodyAboveFooter : undefined)}>{children}</div>
      {footer ? <div className={styles.footer}>{footer}</div> : null}
    </dialog>
  );
}
