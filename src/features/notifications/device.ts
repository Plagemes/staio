// Cosa può fare questo dispositivo, detto onestamente. Funzioni pure: i dati arrivano da browser.ts.

import type { PermissionState } from "./delivery";

export type Platform = "ios" | "android" | "desktop";

export interface DeviceInfo {
  platform: Platform;
  /** Aperta come app installata (schermata Home), non in una scheda del browser. */
  installed: boolean;
  /** Esiste l'API delle notifiche. */
  notifications: boolean;
  serviceWorker: boolean;
  /** Il browser offre la sincronizzazione periodica in sottofondo (Chrome su Android, app installata). */
  periodicSync: boolean;
  permission: PermissionState;
}

export interface DeviceStatus {
  /** Frase principale, sempre vera per questo dispositivo. */
  headline: string;
  /** Dettagli in più, brevi. */
  details: string[];
  /** Si può chiedere il permesso adesso. */
  canAsk: boolean;
  /** Gli avvisi possono comparire con l'app chiusa. */
  background: boolean;
}

export function platformOf(userAgent: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  // iPad con Safari "sito desktop" si presenta come Mac con il tocco
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "desktop";
}

const WHEN_OPEN = "Senza un server gli avvisi arrivano quando apri l'app.";

export function describeDevice(d: DeviceInfo): DeviceStatus {
  if (!d.notifications || (d.platform !== "desktop" && !d.serviceWorker)) {
    return {
      headline: "Questo dispositivo non può mostrare avvisi.",
      details: ["Quello che ti avviserei adesso lo vedi qui sotto e nella schermata Oggi."],
      canAsk: false,
      background: false,
    };
  }
  if (d.platform === "ios" && !d.installed) {
    return {
      headline: "Su iPhone gli avvisi funzionano solo con l'app aggiunta alla schermata Home.",
      details: [
        "Aprila da Safari, tocca Condividi e poi «Aggiungi alla schermata Home». Serve iOS 16.4 o successivo.",
        "Da una scheda di Safari non si possono attivare.",
      ],
      canAsk: false,
      background: false,
    };
  }

  const details: string[] = [];
  let headline: string;
  let background = false;
  if (d.platform === "ios") {
    headline = `${WHEN_OPEN} Su iPhone non arrivano ad app chiusa.`;
    details.push("Quando la apri, vedi gli avvisi dovuti in quel momento.");
  } else if (d.platform === "android") {
    if (d.installed && d.periodicSync) {
      headline = `${WHEN_OPEN} Su Android con l'app installata anche circa una volta al giorno.`;
      details.push("L'ora la decide Android e dipende da quanto usi l'app: non è garantita.");
      background = true;
    } else if (d.installed) {
      headline = `${WHEN_OPEN} Questo browser non permette l'avviso in sottofondo.`;
    } else {
      headline = `${WHEN_OPEN} Installando l'app su Android possono arrivare anche circa una volta al giorno.`;
    }
  } else {
    headline = "Gli avvisi arrivano quando l'app è aperta.";
  }

  let canAsk = false;
  if (d.permission === "denied") {
    details.unshift("Hai bloccato gli avvisi per questo sito. Per riattivarli apri le impostazioni del sito nel browser: qui non te lo chiedo più.");
  } else if (d.permission === "default") {
    canAsk = true;
    details.push("Il telefono ti chiederà il permesso solo quando attivi gli avvisi.");
  } else if (d.permission === "granted") {
    details.push("Il permesso è concesso.");
  }
  return { headline, details, canAsk, background };
}
