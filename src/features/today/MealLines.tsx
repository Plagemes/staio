"use client";

// Gli alimenti della dispensa dentro i momenti del diario di Oggi: quantità, nutrienti (o «senza dato») e, per ciò che si
// è mangiato con un tocco in Dispensa, «Cambia momento» e «Togli». Un consumo vecchio, senza pasto, compare nel momento
// della sua ora e si mette in un momento con un tocco.
import { useMemo, useState } from "react";
import { QUICK_CONSUME_NOTE, addDays, dayBefore, isQuickConsume, localMoment, type DiaryState, type MealKind } from "@/core/diary";
import type { ConsumeEvent } from "@/core/ledger";
import type { IntakeLine, MealIntake } from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import { Button, Value } from "@/design";
import { buildUndo } from "../actions";
import { itemText } from "../meals";
import { MOMENT_CHOICES, buildChangeMoment } from "../pantry/eaten";
import { useIntake } from "../nutrition/useNutrition";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { lineNutrientText } from "./lineText";
import { inSentence } from "./summaries";
import styles from "./Today.module.css";

export interface DayIntakeLookup {
  /** I nutrienti di una riga di dispensa, per id del consumo. */
  lineOf: (consumeId: string) => IntakeLine | undefined;
  /** I nutrienti di un pasto, per `mealId`. */
  mealOf: (mealId: string) => MealIntake | undefined;
}

/** I nutrienti del giorno già calcolati, per riga e per pasto. Si ricalcola solo quando cambiano i dati. */
export function useDayIntake(date: string): DayIntakeLookup {
  const { intake } = useIntake();
  return useMemo(() => {
    const lines = new Map<string, IntakeLine>();
    const meals = new Map<string, MealIntake>();
    const day = intake?.days.find((d) => d.date === date);
    for (const meal of day?.meals ?? []) meals.set(meal.mealId, meal);
    for (const line of [...(day?.meals.flatMap((m) => m.lines) ?? []), ...(day?.standalone ?? [])]) {
      if (line.kind === "pantry") lines.set(line.eventId, line);
    }
    return { lineOf: (id) => lines.get(id), mealOf: (id) => meals.get(id) };
  }, [intake, date]);
}

interface LineProps {
  consume: ConsumeEvent;
  /** Il nome dell'alimento (dal lotto). */
  name: string;
  /** Il giorno mostrato, `YYYY-MM-DD`. */
  date: string;
  /** Oggi, `YYYY-MM-DD`: per dire «Ieri» solo quando è davvero ieri. */
  today: string;
  diary: DiaryState;
  line: IntakeLine | undefined;
  /** Il momento in cui il consumo sta adesso; assente se non è in nessun pasto. */
  kind?: MealKind;
  onError: (message: string | null) => void;
}

/** Prima di quest'ora (le 4 del mattino) ciò che si è mangiato può appartenere alla sera prima. */
const NIGHT_UNTIL_MINUTES = 4 * 60;

interface Target {
  kind: MealKind;
  date: string;
  label: string;
}

function useLineActions({ consume, name, date, diary, kind, onError }: LineProps) {
  const { recordWith, busy } = useRecord();
  const amount = formatQuantity(consume.quantity);

  async function move(to: Pick<Target, "kind" | "date">): Promise<boolean> {
    onError(null);
    const result = await recordWith((deviceId) => {
      const marked = { consumes: [{ ...consume, note: QUICK_CONSUME_NOTE }], mealId: consume.mealId ?? "", kind: kind ?? "snack", date, joined: false, name, amount };
      const built = buildChangeMoment(marked, to, { now: new Date().toISOString(), deviceId }, diary);
      if (!built.ok) throw new Error(built.error);
      return { events: built.events, message: built.message };
    });
    if (!result.ok) onError(result.error);
    return result.ok;
  }

  async function remove() {
    onError(null);
    const result = await recordWith((deviceId) => ({
      events: buildUndo([consume], { now: new Date().toISOString(), deviceId }),
      message: `Tolto: ${amount} di ${inSentence(name)}. Sono tornati in dispensa.`,
    }));
    if (!result.ok) onError(result.error);
  }

  return { busy, move, remove };
}

/**
 * I momenti in cui si può mettere un consumo: quelli del giorno in cui è stato mangiato e, se era notte (prima delle 4),
 * anche pranzo, cena e fuori pasto del giorno prima. Resta fuori il posto in cui sta già.
 */
function targetsOf({ consume, date, today, diary, kind }: LineProps, withNight: boolean): Target[] {
  const eaten = localMoment(consume.at, diary.timeZone);
  const eatenDay = eaten?.date ?? date;
  // l'etichetta nomina il giorno solo se non è quello che si sta guardando
  const dayWord = (target: string) =>
    target === date ? "" : target === dayBefore(date) ? (date === today ? "Ieri · " : "Il giorno prima · ") : target === addDays(date, 1) ? "Il giorno dopo · " : "";
  const label = (target: string, text: string) => (dayWord(target) === "" ? text : `${dayWord(target)}${text.toLowerCase()}`);
  const out: Target[] = MOMENT_CHOICES.map((m) => ({ kind: m.kind, date: eatenDay, label: label(eatenDay, m.label) }));
  if (withNight && eaten !== undefined && eaten.minutes < NIGHT_UNTIL_MINUTES) {
    const before = dayBefore(eatenDay);
    for (const m of MOMENT_CHOICES) if (m.kind !== "breakfast") out.push({ kind: m.kind, date: before, label: label(before, m.label) });
  }
  return out.filter((t) => !(t.kind === kind && t.date === date));
}

function MomentChips({ targets, busy, onPick }: { targets: readonly Target[]; busy: boolean; onPick: (target: Target) => void }) {
  return (
    <div className={styles.momentChoices} role="group" aria-label="Momento">
      {targets.map((t) => (
        <Button key={`${t.date}-${t.kind}`} variant="outline" disabled={busy} onClick={() => onPick(t)}>
          {t.label}
        </Button>
      ))}
    </div>
  );
}

const nutrientNote = (line: IntakeLine | undefined) => {
  const text = lineNutrientText(line);
  return text ? <span className={styles.note}>{text}</span> : null;
};

/** Un alimento della dispensa dentro un pasto, con i nutrienti; se è nato da «Mangiato» in Dispensa, si sposta o si toglie da qui. */
export function PantryLine(props: LineProps) {
  const { consume, name } = props;
  const { busy, move, remove } = useLineActions(props);
  const [moving, setMoving] = useState(false);
  const quick = isQuickConsume(consume);
  return (
    <li>
      <Value certainty={consume.certainty === "estimated" ? "estimated" : "measured"}>{itemText(name, consume.quantity)}</Value> {nutrientNote(props.line)}
      {quick ? (
        <>
          {" "}
          <Button variant="text" disabled={busy} onClick={() => setMoving(!moving)} aria-expanded={moving}>
            Cambia momento
          </Button>
          <Button variant="text" disabled={busy} onClick={() => void remove()}>
            Togli
          </Button>
          {moving ? <MomentChips targets={targetsOf(props, true)} busy={busy} onPick={(to) => void move(to).then((ok) => ok && setMoving(false))} /> : null}
        </>
      ) : null}
    </li>
  );
}

/** Un consumo senza pasto (di prima, o di una preparazione): dice a che momento appartiene e lo mette lì con un tocco. */
export function LooseLine(props: LineProps) {
  const { consume, name } = props;
  const { busy, move, remove } = useLineActions(props);
  return (
    <div className={styles.loose}>
      <div className={styles.mealHead}>
        <span className={styles.mealTitle}>
          <Value certainty={consume.certainty === "estimated" ? "estimated" : "measured"}>{itemText(name, consume.quantity)}</Value>
        </span>
        {nutrientNote(props.line)}
      </div>
      <p className={ui.hint}>Mangiato, ma non è in nessun pasto. In quale momento lo metti?</p>
      <MomentChips targets={targetsOf(props, false)} busy={busy} onPick={(to) => void move(to)} />
      <div>
        <Button variant="text" disabled={busy} onClick={() => void remove()}>
          Togli
        </Button>
      </div>
    </div>
  );
}
