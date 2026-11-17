"use client";

// La memoria delle porzioni letta e scritta nell'archivio del telefono. Le regole stanno in `../portions` (pure).
import type { Unit } from "@/core/ledger";
import { getSetting, setSetting, useSetting } from "../localSettings";
import { PORTIONS_KEY, readPortion, withPortion, type RememberedPortion } from "../portions";

const EMPTY: Record<string, unknown> = {};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** «Il solito» per quel nome, nell'unità dell'alimento; `undefined` se non c'è (o finché la memoria non è stata letta). */
export function useUsualPortion(name: string, unit: Unit): RememberedPortion | undefined {
  const memory = useSetting(PORTIONS_KEY, isRecord, EMPTY);
  return memory.ready ? readPortion(memory.value, name, unit) : undefined;
}

/** Ricorda quanto si è appena mangiato. Non lancia mai: la memoria propone soltanto, e un errore qui non deve far fallire l'azione. */
export async function rememberPortion(name: string, quantity: RememberedPortion, now: string): Promise<void> {
  try {
    const memory = await getSetting(PORTIONS_KEY);
    await setSetting(PORTIONS_KEY, withPortion(memory, name, quantity, now));
  } catch {
    // niente da fare: alla prossima apertura «Il solito» sarà quello di prima
  }
}
