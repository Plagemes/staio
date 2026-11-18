"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_TIME_ZONE } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { derivedOf, getAllEvents, sharedLog } from "@/data";
import { createBrowserEnv } from "./browser";
import { runOnOpen, type RunData } from "./delivery";
import { getNotifyStore } from "./useNotify";

/** Pausa minima tra due calcoli, per non rifarli a ogni piccola modifica dei dati. */
const MIN_RERUN_MS = 60_000;

const NO_EVENTS: readonly AnyEvent[] = [];

/** I quattro stati che servono al calcolo, dalle derivazioni condivise di quell'elenco di eventi. */
function runDataOf(events: readonly AnyEvent[]): RunData {
  const derived = derivedOf(events);
  return { pantry: derived.pantry, preps: derived.preps, plan: derived.plan, diary: derived.diary };
}

/**
 * Non rende nulla. All'apertura dell'app (e quando torni sulla pagina, o quando il registro cambia) mostra gli avvisi
 * dovuti e prepara il riepilogo per il service worker. Non chiede mai il permesso: lo si chiede solo dalla pagina
 * degli avvisi, con un tocco.
 * Non tiene ganci accesi: guarda il registro condiviso solo quando deve girare, al massimo una volta al minuto, e
 * solo se gli avvisi sono accesi e permessi (altrimenti non legge e non calcola niente).
 */
export function NotificationRunner() {
  const busy = useRef(false);
  const lastRun = useRef(0);

  useEffect(() => {
    let alive = true;
    const log = sharedLog();

    async function run() {
      if (busy.current || Date.now() - lastRun.current < MIN_RERUN_MS) return;
      busy.current = true;
      lastRun.current = Date.now();
      try {
        const env = await createBrowserEnv();
        const store = getNotifyStore();
        const prefs = await store.loadPrefs();
        const permission = env.permission();
        // con gli avvisi spenti o senza permesso `runOnOpen` non guarda i dati: non si preparano
        const wanted = prefs.enabled && permission === "granted";
        const events = wanted ? (log.getSnapshot().events ?? (await getAllEvents())) : NO_EVENTS;
        await runOnOpen({
          // ciò che si è appena letto è ciò che vale per tutto il giro: la decisione e il calcolo non si separano
          env: { ...env, permission: () => permission },
          store: { ...store, loadPrefs: async () => prefs },
          data: runDataOf(events),
          now: new Date().toISOString(),
          timeZone: DEFAULT_TIME_ZONE,
        });
      } catch {
        // gli avvisi non devono mai disturbare l'uso dell'app
      } finally {
        busy.current = false;
      }
    }

    // la prima lettura del registro (l'apertura) e ogni scrittura: come prima, con la pausa minima tra due giri
    const onLog = () => {
      if (alive && log.getSnapshot().events !== undefined) void run();
    };
    const unsubscribe = log.subscribe(onLog);
    onLog();
    const onVisible = () => {
      if (alive && document.visibilityState === "visible" && log.getSnapshot().events !== undefined) void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
