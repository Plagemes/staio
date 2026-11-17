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
 * Una riga discreta, solo nel browser e solo finché l'app non è installata: dice come metterla nella schermata Home.
 * Riusa lo stato di installazione della pagina di presentazione (`beforeinstallprompt`, piattaforma, modalità a schermo intero).
 * Chiusa una volta, non torna.
 */
export function InstallHint() {
  const standalone = useSyncExternalStore(subscribeStandalone, getStandalone, () => true);
  const platform = useSyncExternalStore<Platform>(subscribeNothing, getPlatform, () => "unknown");
  const install = useSyncExternalStore(subscribeInstall, getInstallState, () => SERVER_INSTALL_STATE);
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => true);

  if (standalone || dismissed || install.installed) return null;
  if (!install.prompt && platform !== "ios" && platform !== "android") return null;

  return (
    <div className={styles.hint} role="note">
      <p className={styles.text}>
        {install.prompt
          ? "Puoi mettere l'app nella schermata Home e aprirla come le altre."
          : platform === "ios"
            ? "Per averla nella schermata Home: tocca Condividi, poi «Aggiungi alla schermata Home»."
            : "Per averla nella schermata Home: apri il menu del browser e scegli «Installa app»."}
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
