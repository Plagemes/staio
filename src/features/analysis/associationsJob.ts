// Contratto tra la pagina e il worker delle associazioni: solo dati serializzabili, nessun React né Dexie.
// Il gestore è puro, così il worker e il ripiego sul thread principale eseguono lo stesso codice.
import type { AssociationsResult } from "@/core/analysis";
import type { DiaryState } from "@/core/diary";
import type { DayIntake } from "@/core/nutrition";
import { computeAssociations } from "./compute";

export interface AssociationsInputs {
  diary: DiaryState;
  intakeDays: readonly DayIntake[];
  today: string;
}

export type AssociationsRequest = ({ type: "run"; id: number } & AssociationsInputs) | { type: "cancel"; id: number };

export type AssociationsResponse =
  | { id: number; ok: true; result: AssociationsResult }
  | { id: number; ok: false; message: string };

/** Esegue una richiesta "run"; le eccezioni diventano una risposta d'errore, mai un crash del worker. */
export function handleAssociationsRequest(request: AssociationsRequest): AssociationsResponse | undefined {
  if (request.type !== "run") return undefined;
  try {
    return { id: request.id, ok: true, result: computeAssociations(request.diary, request.intakeDays, request.today) };
  } catch (e) {
    return { id: request.id, ok: false, message: e instanceof Error ? e.message : "errore sconosciuto" };
  }
}
