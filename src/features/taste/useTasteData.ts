"use client";

// I dati degli abbinamenti (src/core/taste/data/flavorgraph.json, vedi FONTI.md) si caricano solo qui, con un import
// dinamico: le pagine che non li usano non li scaricano.
import { useEffect, useState } from "react";
import { decodeTasteData, type CompactTasteData, type TasteData } from "@/core/taste";

let promise: Promise<TasteData> | undefined;

export function loadTasteData(): Promise<TasteData> {
  promise ??= import("@/core/taste/data/flavorgraph.json").then((m) => decodeTasteData(m.default as unknown as CompactTasteData));
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
