// I minuti dalla mezzanotte, ora del telefono, di un istante (0 se non si sa). Logica pura.
import { localMoment } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";

export function localMinutes(now: string | null, timeZone: string = DEFAULT_TIME_ZONE): number {
  return now ? (localMoment(now, timeZone)?.minutes ?? 0) : 0;
}
