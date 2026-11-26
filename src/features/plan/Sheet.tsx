"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/design";
import { Sheet as CommonSheet } from "../common";
import styles from "./plan.module.css";

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Fisso in fondo: il pulsante principale. */
  footer?: ReactNode;
  busy?: boolean;
  /** Il foglio è in un passo interno: il tasto indietro torna al passo prima. */
  onBack?: () => void;
}

/** I fogli del piano: il foglio dal basso comune, che risponde anche al tasto indietro del telefono. */
export function Sheet({ title, onClose, children, footer, busy, onBack }: SheetProps) {
  return (
    <CommonSheet title={title} onClose={onClose} footer={footer} busy={busy} onBack={onBack}>
      {children}
    </CommonSheet>
  );
}

interface Hosting {
  slot: HTMLElement | null;
  onBack: (() => void) | undefined;
}

const FooterSlot = createContext<Hosting>({ slot: null, onBack: undefined });

/**
 * Un foglio con più passi nello stesso foglio (mai un foglio sopra un foglio): il piede è uno solo e ogni passo ci mette il
 * suo pulsante principale, con «Indietro» a sinistra, così non finisce mai in fondo al corpo che scorre.
 */
export function SteppedSheet({ title, onClose, onBack, busy, withFooter = true, children }: Omit<SheetProps, "footer"> & { withFooter?: boolean }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <Sheet title={title} onClose={onClose} onBack={onBack} busy={busy} footer={withFooter ? <div ref={setSlot} className={styles.footerSlot} /> : undefined}>
      <FooterSlot.Provider value={{ slot, onBack }}>{children}</FooterSlot.Provider>
    </Sheet>
  );
}

interface FrameProps {
  /** Dentro un `SteppedSheet`: il passo non fa un foglio suo, mette il pulsante nel piede di quello che lo contiene. */
  embedded?: boolean;
  title: string;
  onClose: () => void;
  footer: ReactNode;
  busy?: boolean;
  children: ReactNode;
}

/** Il contenuto di un passo: un foglio suo se sta da solo, un passo del foglio che lo contiene se `embedded`. */
export function StepFrame({ embedded = false, title, onClose, footer, busy, children }: FrameProps) {
  const { slot, onBack } = useContext(FooterSlot);
  if (embedded) {
    return (
      <>
        {children}
        {slot
          ? createPortal(
              <div className={styles.stepFooter}>
                {onBack ? (
                  <Button variant="text" onClick={onBack} disabled={busy}>
                    Indietro
                  </Button>
                ) : null}
                {footer}
              </div>,
              slot,
            )
          : null}
      </>
    );
  }
  return (
    <Sheet title={title} onClose={onClose} footer={footer} busy={busy}>
      {children}
    </Sheet>
  );
}
