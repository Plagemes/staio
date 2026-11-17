// Consegna degli avvisi. Tutto passa da un ambiente iniettato (permesso, visualizzazione,
// sincronizzazione periodica, archivio), così la logica si prova con API finte.

import { DEFAULT_TIME_ZONE } from "@/core/diary";
import {
  buildSavedSummary,
  planNotifications,
  recordShown,
  safeAppPath,
  type HoldReason,
  type NoticeMessage,
  type NotifyInput,
  type NotifyResult,
} from "@/core/notify";
import type { NotifyStore } from "./store";

export type PermissionState = "granted" | "denied" | "default" | "unsupported";

export interface PeriodicSyncApi {
  register(): Promise<void>;
  unregister(): Promise<void>;
}

export interface DeliveryEnv {
  permission(): PermissionState;
  /** Mostra la notifica (di norma con registration.showNotification). Può lanciare. */
  show(message: NoticeMessage): Promise<void>;
  /** Assente dove la sincronizzazione periodica non esiste. */
  periodic?: PeriodicSyncApi;
}

export type RunData = Omit<NotifyInput, "now" | "prefs" | "shown" | "timeZone">;

export type RunStatus =
  | "disabled" // avvisi spenti dall'utente
  | "unsupported" // l'API non c'è
  | "denied" // permesso negato
  | "not_asked" // permesso mai concesso
  | "shown"
  | "held" // c'è qualcosa ma non è il momento (silenzio, limiti)
  | "nothing" // niente di dovuto
  | "error";

export type PeriodicStatus = "registered" | "removed" | "unsupported" | "error";

export interface RunReport {
  status: RunStatus;
  message: NoticeMessage | null;
  hold?: HoldReason;
  result?: NotifyResult;
  periodic: PeriodicStatus;
}

export const PERIODIC_SYNC_TAG = "staio-daily-summary";

/** Il bordo del messaggio: l'indirizzo che arriva al sistema è sempre un percorso interno valido. */
export function sanitizeMessage(message: NoticeMessage): NoticeMessage {
  return { ...message, url: safeAppPath(message.url) };
}

async function syncPeriodic(env: DeliveryEnv, wanted: boolean): Promise<PeriodicStatus> {
  if (!env.periodic) return "unsupported";
  try {
    if (wanted) {
      await env.periodic.register();
      return "registered";
    }
    await env.periodic.unregister();
    return "removed";
  } catch {
    return "error";
  }
}

async function safely(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch {
    // l'archivio può non esserci (navigazione privata): gli avvisi funzionano lo stesso, senza memoria
  }
}

/**
 * All'apertura dell'app: mostra ciò che è dovuto (se il permesso c'è e non è silenzio), lo
 * registra, e prepara il riepilogo per il service worker. Non chiede mai il permesso.
 */
export async function runOnOpen(args: {
  env: DeliveryEnv;
  store: NotifyStore;
  data: RunData;
  now: string;
  timeZone?: string;
}): Promise<RunReport> {
  const { env, store, data, now } = args;
  const timeZone = args.timeZone ?? DEFAULT_TIME_ZONE;
  let prefs;
  let ledger;
  try {
    prefs = await store.loadPrefs();
    ledger = await store.loadLedger();
  } catch {
    return { status: "error", message: null, periodic: "unsupported" };
  }

  const permission = env.permission();
  if (!prefs.enabled || permission !== "granted") {
    await safely(() => store.saveSummary(null));
    const periodic = prefs.enabled ? "unsupported" : await syncPeriodic(env, false);
    const status: RunStatus = !prefs.enabled
      ? "disabled"
      : permission === "unsupported"
        ? "unsupported"
        : permission === "denied"
          ? "denied"
          : "not_asked";
    return { status, message: null, periodic };
  }

  const input: NotifyInput = { ...data, now, timeZone, prefs, shown: ledger };
  const result = planNotifications(input);
  let status: RunStatus = result.hold === "nothing" ? "nothing" : "held";
  let message: NoticeMessage | null = null;

  if (result.message) {
    const safe = sanitizeMessage(result.message);
    try {
      await env.show(safe);
      message = safe;
      status = "shown";
      ledger = recordShown(ledger, safe, result.day, now);
      const saved = ledger;
      await safely(() => store.saveLedger(saved));
    } catch {
      status = "error";
    }
  }

  const summary = buildSavedSummary({ ...input, shown: ledger });
  await safely(() => store.saveSummary(summary));
  const periodic = await syncPeriodic(env, true);
  return { status, message, ...(result.hold ? { hold: result.hold } : {}), result, periodic };
}
