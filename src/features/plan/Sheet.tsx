"use client";

import type { ReactNode } from "react";
import { Sheet as CommonSheet } from "../common";

interface SheetProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** I fogli del piano: il foglio dal basso comune, che risponde anche al tasto indietro del telefono. */
export function Sheet({ title, onClose, children }: SheetProps) {
  return (
    <CommonSheet title={title} onClose={onClose}>
      {children}
    </CommonSheet>
  );
}
