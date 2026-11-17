// Orologi sfasati tra dispositivi: si segnalano, i dati non si toccano mai.
import { instantMs } from "../ledger/time";

/** Sotto questa soglia lo scarto è normale (latenza, piccoli errori dell'orologio). */
export const CLOCK_TOLERANCE_MS = 10 * 60_000;

export type ClockWarningKind =
  /** L'orologio del dispositivo differisce da quello del servizio remoto. */
  | "device_clock"
  /** Eventi registrati "nel futuro" rispetto al momento in cui sono arrivati. */
  | "future_records";

export interface ClockWarning {
  deviceId: string;
  kind: ClockWarningKind;
  /** Positivo: il dispositivo è avanti. Millisecondi. */
  skewMs: number;
}

/** Scarto tra l'istante dichiarato dal dispositivo e quello del servizio, se entrambi validi. */
export function clockSkewMs(deviceAt: string | undefined, serviceAt: string | undefined): number | undefined {
  const a = instantMs(deviceAt);
  const b = instantMs(serviceAt);
  return Number.isNaN(a) || Number.isNaN(b) ? undefined : a - b;
}

/** Di quanto il `recordedAt` più avanzato supera il riferimento (0 se nessuno lo supera). */
export function futureRecordsMs(events: readonly unknown[], referenceMs: number): number {
  let max = 0;
  for (const e of events) {
    const ms = instantMs(typeof e === "object" && e !== null ? (e as { recordedAt?: unknown }).recordedAt : undefined);
    if (!Number.isNaN(ms)) max = Math.max(max, ms - referenceMs);
  }
  return max;
}

/** Tiene, per dispositivo e tipo, lo scarto più grande oltre la soglia. Ordine stabile. */
export function collectClockWarnings(candidates: readonly ClockWarning[], toleranceMs = CLOCK_TOLERANCE_MS): ClockWarning[] {
  const best = new Map<string, ClockWarning>();
  for (const c of candidates) {
    if (!Number.isFinite(c.skewMs) || Math.abs(c.skewMs) <= toleranceMs) continue;
    const k = `${c.kind}\u0000${c.deviceId}`;
    const prev = best.get(k);
    if (!prev || Math.abs(c.skewMs) > Math.abs(prev.skewMs)) best.set(k, c);
  }
  return [...best.values()].sort((a, b) =>
    a.deviceId < b.deviceId ? -1 : a.deviceId > b.deviceId ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0,
  );
}
