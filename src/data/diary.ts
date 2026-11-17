import { liveQuery, type Observable } from "dexie";
import { deriveDiary, type DeriveDiaryOptions, type DiaryState } from "@/core/diary";
import { getAllEvents } from "./eventStore";

export async function getDiary(options?: DeriveDiaryOptions): Promise<DiaryState> {
  return deriveDiary(await getAllEvents(), options);
}

/** Osservabile del diario: si aggiorna quando cambiano gli eventi. */
export function liveDiary(options?: DeriveDiaryOptions): Observable<DiaryState> {
  return liveQuery(() => getDiary(options));
}
