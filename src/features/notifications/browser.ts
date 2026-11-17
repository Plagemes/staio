// Collegamento con le API del browser. Niente logica: la logica sta in delivery.ts e in core/notify.

import { safeAppPath, type NoticeMessage } from "@/core/notify";
import { PERIODIC_SYNC_TAG, type DeliveryEnv, type PeriodicSyncApi, type PermissionState } from "./delivery";
import { platformOf, type DeviceInfo } from "./device";

/** Tipi minimi della sincronizzazione periodica, che non è nei tipi standard del DOM. */
interface PeriodicSyncManager {
  register(tag: string, options?: { minInterval?: number }): Promise<void>;
  unregister(tag: string): Promise<void>;
}
type RegistrationWithSync = ServiceWorkerRegistration & { periodicSync?: PeriodicSyncManager };

const MIN_INTERVAL_MS = 12 * 60 * 60 * 1000;
const ICON = "/icons/icon-192.png";

export function readPermission(): PermissionState {
  if (typeof Notification === "undefined") return "unsupported";
  const p = Notification.permission;
  return p === "granted" || p === "denied" ? p : "default";
}

async function registrationOrUndefined(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return undefined;
  try {
    return await navigator.serviceWorker.getRegistration();
  } catch {
    return undefined;
  }
}

export function isInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

export async function detectDevice(): Promise<DeviceInfo> {
  const reg = (await registrationOrUndefined()) as RegistrationWithSync | undefined;
  return {
    platform: platformOf(navigator.userAgent, navigator.maxTouchPoints),
    installed: isInstalled(),
    notifications: typeof Notification !== "undefined",
    serviceWorker: reg !== undefined,
    periodicSync: reg?.periodicSync !== undefined,
    permission: readPermission(),
  };
}

/** Mostra la notifica col service worker (l'unico modo che vale su Android); senza worker, solo dove il browser lo permette. */
export async function showMessage(message: NoticeMessage): Promise<void> {
  const url = safeAppPath(message.url);
  const options: NotificationOptions = {
    body: message.body,
    tag: message.tag,
    icon: ICON,
    badge: ICON,
    data: { url, keys: message.keys },
  };
  const reg = await registrationOrUndefined();
  if (reg) {
    await reg.showNotification(message.title, options);
    return;
  }
  new Notification(message.title, options);
}

export function browserEnv(registration?: RegistrationWithSync): DeliveryEnv {
  const periodic: PeriodicSyncApi | undefined = registration?.periodicSync
    ? {
        register: () => registration.periodicSync!.register(PERIODIC_SYNC_TAG, { minInterval: MIN_INTERVAL_MS }),
        unregister: () => registration.periodicSync!.unregister(PERIODIC_SYNC_TAG),
      }
    : undefined;
  return { permission: readPermission, show: showMessage, ...(periodic ? { periodic } : {}) };
}

/** Ambiente reale. Il worker è quello già registrato: in sviluppo non c'è e la sincronizzazione periodica manca. */
export async function createBrowserEnv(): Promise<DeliveryEnv> {
  return browserEnv((await registrationOrUndefined()) as RegistrationWithSync | undefined);
}

/**
 * Chiede il permesso. Da chiamare solo dal gestore di un tocco dell'utente: i browser ignorano
 * (o bloccano) la richiesta fuori da un gesto.
 */
export async function requestPermission(): Promise<PermissionState> {
  if (typeof Notification === "undefined") return "unsupported";
  try {
    const result = await Notification.requestPermission();
    return result === "granted" || result === "denied" ? result : "default";
  } catch {
    return readPermission();
  }
}
