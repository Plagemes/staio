"use client";

// Le voci dentro i momenti del diario di Oggi. Una voce di un pasto, della dispensa o libera, è una riga che si tocca:
// a sinistra nome e quantità, a destra i nutrienti (o «senza dato»); il tocco apre il foglio «Voce». Un consumo senza
// pasto compare nel momento della sua ora e si mette in un momento con un tocco.
import { useMemo } from "react";
import { QUICK_CONSUME_NOTE, localMoment, removeConsume, type DiaryState, type MealKind } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { Certainty, ConsumeEvent, Quantity } from "@/core/ledger";
import { mealEnergyHistory, type IntakeLine, type MealIntake } from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import { Button, Value } from "@/design";
import { itemText } from "../meals";
import { buildChangeMoment } from "../pantry/eaten";
import { useIntake } from "../nutrition/useNutrition";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { consumeRemovedText, momentTargets, type MomentTarget } from "./editText";
import { lineNutrientText } from "./lineText";
import entries from "./MealEntries.module.css";
import styles from "./Today.module.css";

export interface DayIntakeLookup {
  /** I nutrienti di una riga di dispensa, per id del consumo. */
  lineOf: (consumeId: string) => IntakeLine | undefined;
  /** I nutrienti di un pasto, per `mealId`. */
  mealOf: (mealId: string) => MealIntake | undefined;
  /**
   * Per la stima «fuori casa»: l'energia dei pasti registrati in quel momento negli ultimi 30 giorni fino a `today`
   * (`mealEnergyHistory`). Si calcola solo quando la si chiede, sui nutrienti che Oggi ha già: `undefined` finché non
   * sono pronti.
   */
  energyHistory: (kind: MealKind, today: string) => readonly number[] | undefined;
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
    const histories = new Map<string, readonly number[]>();
    const energyHistory = (kind: MealKind, today: string) => {
      if (!intake) return undefined;
      const key = `${kind} ${today}`;
      let history = histories.get(key);
      if (!history) histories.set(key, (history = mealEnergyHistory(intake, kind, today)));
      return history;
    };
    return { lineOf: (id) => lines.get(id), mealOf: (id) => meals.get(id), energyHistory };
  }, [intake, date]);
}

/** I nutrienti di una voce libera: la riga del pasto alla stessa posizione. */
export function freeItemLine(intake: DayIntakeLookup, mealId: string, index: number): IntakeLine | undefined {
  return intake.mealOf(mealId)?.lines.find((l) => l.kind === "mealItem" && l.itemIndex === index);
}

interface EntryRowProps {
  /** `voce-<id del consumo>` oppure `voce-<id dell'evento meal>-<posizione>`: lo cerca `/app?voce=…`. */
  id: string;
  name: string;
  quantity: Quantity;
  certainty: Certainty;
  line: IntakeLine | undefined;
  onOpen: () => void;
}

/** Una voce di un pasto: una riga sola, senza comandi. Il tocco apre il foglio «Voce». */
export function EntryRow({ id, name, quantity, certainty, line, onOpen }: EntryRowProps) {
  const note = lineNutrientText(line);
  return (
    <li id={id}>
      <button type="button" className={entries.entry} aria-haspopup="dialog" onClick={onOpen}>
        <Value certainty={certainty === "estimated" ? "estimated" : "measured"} className={entries.entryText}>
          <span className={entries.entryName}>{name}</span>
          <span className={entries.entryAmount}>{formatQuantity(quantity)}</span>
        </Value>
        {note ? <span className={entries.entryNote}>{note}</span> : null}
      </button>
    </li>
  );
}

interface LooseLineProps {
  consume: ConsumeEvent;
  /** Il nome dell'alimento (dal lotto). */
  name: string;
  /** Il giorno mostrato, `YYYY-MM-DD`. */
  date: string;
  today: string;
  diary: DiaryState;
  log: readonly AnyEvent[];
  line: IntakeLine | undefined;
  onError: (message: string | null) => void;
}

/** Un consumo senza pasto (di prima, o di una preparazione): dice a che momento appartiene e lo mette lì con un tocco. */
export function LooseLine({ consume, name, date, today, diary, log, line, onError }: LooseLineProps) {
  const { recordWith, busy } = useRecord();
  const amount = formatQuantity(consume.quantity);
  const note = lineNutrientText(line);

  async function move(to: Pick<MomentTarget, "kind" | "date">) {
    onError(null);
    const result = await recordWith((deviceId) => {
      const marked = { consumes: [{ ...consume, note: QUICK_CONSUME_NOTE }], mealId: consume.mealId ?? "", kind: "snack" as const, date, joined: false, name, amount };
      const built = buildChangeMoment(marked, to, { now: new Date().toISOString(), deviceId }, diary);
      if (!built.ok) throw new Error(built.error);
      return { events: built.events, message: built.message };
    });
    if (!result.ok) onError(result.error);
  }

  async function remove() {
    onError(null);
    const result = await recordWith((deviceId) => {
      // tutta la famiglia del consumo, non solo quello mostrato: vedi `removeConsume`
      const built = removeConsume(consume, log, { deviceId, now: new Date().toISOString(), timeZone: diary.timeZone });
      if (!built.ok) throw new Error(built.error);
      return { events: built.events, message: consumeRemovedText(name, consume.quantity) };
    });
    if (!result.ok) onError(result.error);
  }

  return (
    <div className={styles.loose}>
      <div className={styles.mealHead}>
        <span className={styles.mealTitle}>
          <Value certainty={consume.certainty === "estimated" ? "estimated" : "measured"}>{itemText(name, consume.quantity)}</Value>
        </span>
        {note ? <span className={styles.note}>{note}</span> : null}
      </div>
      <p className={ui.hint}>Mangiato, ma non è in nessun pasto. In quale momento lo metti?</p>
      <div className={styles.momentChoices} role="group" aria-label="Momento">
        {/* un consumo senza pasto sta nel giorno e all'ora in cui è stato mangiato */}
        {momentTargets({ date, minutes: localMoment(consume.at, diary.timeZone)?.minutes, today }, false).map((t) => (
          <Button key={`${t.date}-${t.kind}`} variant="outline" disabled={busy} onClick={() => void move(t)}>
            {t.label}
          </Button>
        ))}
      </div>
      <div>
        <Button variant="text" disabled={busy} onClick={() => void remove()}>
          Togli
        </Button>
      </div>
    </div>
  );
}
