// Che cosa propone «Adesso», in cima a Oggi: il pasto del momento in corso, oppure uno spuntino. Logica pura.
import { momentOfMinutes, type DiaryDay, type DiaryHabit } from "@/core/diary";
import { momentsOf, type DeclarableKind } from "../meals";

export type NowAction =
  | { kind: "habit"; moment: DeclarableKind; habit: DiaryHabit }
  | { kind: "register"; moment: DeclarableKind }
  | { kind: "snack" };

/** La proposta del pasto abituale vale per tutta la fascia del momento: va passata a `habitsToPropose`. */
export const HABIT_WINDOW_MINUTES = 24 * 60;

/**
 * Il pulsante di «Adesso». Se il momento in corso (colazione, pranzo o cena) non ha ancora niente, propone di
 * registrarlo: con il pasto abituale di quel momento se c'è (`habits` arriva già in ordine, dal più vicino all'ora),
 * altrimenti aprendo la pagina del pasto. Se il momento è già registrato o dichiarato, o l'ora è fuori dai tre momenti,
 * resta lo spuntino.
 */
export function nowAction(args: { nowMinutes: number; day: DiaryDay | undefined; habits: readonly DiaryHabit[] }): NowAction {
  const moment = momentOfMinutes(args.nowMinutes);
  if (moment === "snack") return { kind: "snack" };
  const status = momentsOf(args.day).find((m) => m.kind === moment)?.status ?? "none";
  if (status !== "none") return { kind: "snack" };
  const habit = args.habits.find((h) => h.kind === moment);
  return habit ? { kind: "habit", moment, habit } : { kind: "register", moment };
}

const REGISTER_LABEL: Record<DeclarableKind, string> = {
  breakfast: "Registra colazione",
  lunch: "Registra pranzo",
  dinner: "Registra cena",
};

/** Il testo del pulsante: «Registra: Solita colazione», «Registra pranzo», «Registra uno spuntino». */
export function nowActionLabel(action: NowAction): string {
  switch (action.kind) {
    case "habit":
      return `Registra: ${action.habit.title}`;
    case "register":
      return REGISTER_LABEL[action.moment];
    case "snack":
      return "Registra uno spuntino";
  }
}

/** La pagina del pasto a cui porta «Adesso»: sul momento in corso, o sullo spuntino. */
export function nowActionHref(action: NowAction): string {
  return `/app/pasto?momento=${action.kind === "snack" ? "snack" : action.moment}`;
}
