"use client";

// I dati degli abbinamenti si caricano solo qui, con un import dinamico: le pagine che non li usano non li scaricano.
// Oggi è l'insieme di prova scritto a mano; quando ci sarà una fonte con licenza chiara (vedi FONTI.md in
// src/core/taste) si cambia solo questo import.
import { useEffect, useState } from "react";
import type { TasteData } from "@/core/taste";

let promise: Promise<TasteData> | undefined;

export function loadTasteData(): Promise<TasteData> {
  promise ??= import("@/core/taste/sample").then((m) => m.SAMPLE_TASTE_DATA);
  return promise;
}

export type TasteDataState = { status: "loading" } | { status: "ready"; data: TasteData } | { status: "error" };

export function useTasteData(): TasteDataState {
  const [state, setState] = useState<TasteDataState>({ status: "loading" });
  useEffect(() => {
    let alive = true;
    loadTasteData().then(
      (data) => alive && setState({ status: "ready", data }),
      () => {
        promise = undefined;
        if (alive) setState({ status: "error" });
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
