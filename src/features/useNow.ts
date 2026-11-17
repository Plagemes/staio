"use client";

import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;

let current: string | null = null;
const listeners = new Set<() => void>();
let timer: number | undefined;

function refresh() {
  const next = new Date().toISOString();
  // al minuto: basta per i giorni di calendario e non rifà il rendering a ogni tick
  if (current === null || next.slice(0, 16) !== current.slice(0, 16)) {
    current = next;
    listeners.forEach((l) => l());
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  if (listeners.size === 1) {
    timer = window.setInterval(refresh, TICK_MS);
    document.addEventListener("visibilitychange", refresh);
  }
  return () => {
    listeners.delete(onChange);
    if (listeners.size === 0) {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
      current = null;
    }
  };
}

function getSnapshot(): string {
  if (current === null) current = new Date().toISOString();
  return current;
}

/**
 * Istante corrente (ISO UTC), aggiornato ogni minuto e al ritorno sulla pagina.
 * Null sul server e durante l'idratazione: chi lo usa mostra lo stato di caricamento.
 */
export function useNow(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
