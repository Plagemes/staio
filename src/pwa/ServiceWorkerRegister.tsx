"use client";

import { useEffect, useSyncExternalStore } from "react";

const listeners = new Set<() => void>();
let updateAvailable = false;
let waitingWorker: ServiceWorker | null = null;
let applying = false;

function setWaiting(worker: ServiceWorker | null) {
  waitingWorker = worker;
  updateAvailable = worker !== null;
  listeners.forEach((l) => l());
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** True quando una nuova versione e' scaricata e attende di essere attivata. */
export function useUpdateAvailable(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => updateAvailable,
    () => false,
  );
}

/** Attiva la nuova versione e ricarica la pagina quando ha preso il controllo. */
export function applyServiceWorkerUpdate(): void {
  if (!waitingWorker) return;
  applying = true;
  waitingWorker.postMessage({ type: "SKIP_WAITING" });
}

function track(registration: ServiceWorkerRegistration) {
  if (registration.waiting && navigator.serviceWorker.controller) {
    setWaiting(registration.waiting);
  }
  registration.addEventListener("updatefound", () => {
    const installing = registration.installing;
    if (!installing) return;
    installing.addEventListener("statechange", () => {
      if (installing.state === "installed" && navigator.serviceWorker.controller) {
        setWaiting(installing);
      }
    });
  });
}

/** Registra /sw.js solo in produzione. Non rende nulla e non mostra errori. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    let registration: ServiceWorkerRegistration | undefined;
    const onControllerChange = () => {
      if (applying) window.location.reload();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        registration?.update().catch(() => {});
      }
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisible);
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        registration = reg;
        track(reg);
      })
      .catch(() => {});

    return () => {
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return null;
}
