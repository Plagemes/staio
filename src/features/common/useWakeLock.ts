"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const subscribeNever = () => () => undefined;
const hasWakeLock = () => typeof navigator !== "undefined" && "wakeLock" in navigator;
// sul server non si sa: si presume di sì, così la riga «può spegnersi» non lampeggia al primo disegno
const assumeYes = () => true;

/** Tiene acceso lo schermo finché `active` è vero e la pagina è in vista. `supported` è falso dove il telefono non lo permette. */
export function useWakeLock(active: boolean): { supported: boolean } {
  const available = useSyncExternalStore(subscribeNever, hasWakeLock, assumeYes);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    if (!active || !available) return;
    let sentinel: WakeLockSentinel | undefined;
    let cancelled = false;
    let asking = false;

    async function acquire() {
      if (cancelled || asking || document.visibilityState !== "visible" || (sentinel && !sentinel.released)) return;
      asking = true;
      try {
        const s = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void s.release().catch(() => undefined);
          return;
        }
        sentinel = s;
        setRefused(false);
      } catch {
        // un rifiuto a pagina nascosta è normale; a pagina in vista vuol dire che il telefono non lo permette
        if (!cancelled && document.visibilityState === "visible") setRefused(true);
      } finally {
        asking = false;
      }
    }

    // il telefono rilascia lo schermo acceso quando si cambia app: al ritorno lo si chiede di nuovo
    const again = () => void acquire();
    void acquire();
    document.addEventListener("visibilitychange", again);
    window.addEventListener("pageshow", again);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", again);
      window.removeEventListener("pageshow", again);
      void sentinel?.release().catch(() => undefined);
    };
  }, [active, available]);

  return { supported: available && !refused };
}
