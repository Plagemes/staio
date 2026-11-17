"use client";

import { useEffect, useRef } from "react";
import { DEFAULT_TIME_ZONE } from "@/core/diary";
import { createBrowserEnv } from "./browser";
import { runOnOpen } from "./delivery";
import { getNotifyStore, useNotifyData } from "./useNotify";

/** Pausa minima tra due calcoli, per non rifarli a ogni piccola modifica dei dati. */
const MIN_RERUN_MS = 60_000;

/**
 * Non rende nulla. All'apertura dell'app (e quando torni sulla pagina) mostra gli avvisi dovuti
 * e prepara il riepilogo per il service worker. Non chiede mai il permesso: lo si chiede solo
 * dalla pagina degli avvisi, con un tocco.
 */
export function NotificationRunner() {
  const data = useNotifyData();
  const dataRef = useRef(data);
  const busy = useRef(false);
  const lastRun = useRef(0);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    let alive = true;
    async function run() {
      const current = dataRef.current;
      if (!current || busy.current || Date.now() - lastRun.current < MIN_RERUN_MS) return;
      busy.current = true;
      lastRun.current = Date.now();
      try {
        await runOnOpen({
          env: await createBrowserEnv(),
          store: getNotifyStore(),
          data: current,
          now: new Date().toISOString(),
          timeZone: DEFAULT_TIME_ZONE,
        });
      } catch {
        // gli avvisi non devono mai disturbare l'uso dell'app
      } finally {
        busy.current = false;
      }
    }
    void run();
    const onVisible = () => {
      if (alive && document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [data]);

  return null;
}
