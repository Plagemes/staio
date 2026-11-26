"use client";

import { useSyncExternalStore } from "react";
import {
  SERVER_INSTALL_STATE,
  getInstallState,
  getPlatform,
  getStandalone,
  promptInstall,
  subscribeInstall,
  subscribeNothing,
  subscribeStandalone,
  type Platform,
} from "@/vetrina/install-store";
import { dayOf } from "@/features/format";
import { useOnboardingMemory } from "@/features/onboarding";
import styles from "./InstallHint.module.css";

const DISMISS_KEY = "installHint.dismissed";
const listeners = new Set<() => void>();

function subscribeDismissed(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    // senza memoria locale non si potrebbe ricordare la chiusura: meglio non mostrarla
    return true;
  }
}

function dismiss(): void {
  try {
    window.localStorage.setItem(DISMISS_KEY, "1");
  } catch {
    // già trattato in lettura
  }
  listeners.forEach((l) => l());
}

/**
 * Una riga discreta, solo nel browser, solo finché l'app non è installata e non il giorno in cui finisce l'introduzione:
 * dice come metterla nella schermata Home.
 * Riusa lo stato di installazione della pagina di presentazione (`beforeinstallprompt`, piattaforma, modalità a schermo intero).
 * Chiusa una volta, non torna.
 */
export function InstallHint() {
  const standalone = useSyncExternalStore(subscribeStandalone, getStandalone, () => true);
  const platform = useSyncExternalStore<Platform>(subscribeNothing, getPlatform, () => "unknown");
  const install = useSyncExternalStore(subscribeInstall, getInstallState, () => SERVER_INSTALL_STATE);
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => true);
  const memory = useOnboardingMemory();

  if (standalone || dismissed || install.installed) return null;
  // il giorno in cui finisce l'introduzione c'è già «Primi passi»: l'invito arriva dal giorno dopo
  if (memory === undefined || memory.since === dayOf(new Date().toISOString())) return null;
  if (!install.prompt && platform !== "ios" && platform !== "android") return null;

  return (
    <div className={styles.hint} role="note">
      <p className={styles.text}>
        {install.prompt
          ? "Installa l'app: si apre come le altre."
          : platform === "ios"
            ? "Per installarla: Condividi › Aggiungi alla schermata Home."
            : "Per installarla: menu del browser › Installa app."}
      </p>
      <div className={styles.actions}>
        {install.prompt ? (
          <button type="button" className={styles.action} onClick={() => void promptInstall()}>
            Installa
          </button>
        ) : null}
        <button type="button" className={styles.action} onClick={dismiss}>
          Chiudi
        </button>
      </div>
    </div>
  );
}
