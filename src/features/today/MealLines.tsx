"use client";

// Gli alimenti della dispensa dentro i momenti di Oggi: quantità, nutrienti (o «senza dato») e, per ciò che si è mangiato
// con un tocco dalla scheda di un alimento, «Cambia momento» e «Annulla». Un consumo vecchio, senza pasto, compare nel
// momento della sua ora e si mette in un momento con un tocco.
import { useMemo, useState } from "react";
import { QUICK_CONSUME_NOTE, isQuickConsume, type DiaryState, type MealKind } from "@/core/diary";
import type { ConsumeEvent } from "@/core/ledger";
import type { IntakeLine } from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import { Button, Value } from "@/design";
import { buildUndo } from "../actions";
import { itemText } from "../meals";
import { MOMENT_CHOICES, buildChangeMoment } from "../pantry/eaten";
import { useIntake } from "../nutrition/useNutrition";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { lineNutrientText } from "./lineText";
import styles from "./Today.module.css";

/** Le righe di dispensa del giorno con i loro nutrienti, per id del consumo. Si ricalcola solo quando cambiano i dati. */
export function useLineIntake(date: string): (consumeId: string) => IntakeLine | undefined {
  const { intake } = useIntake();
  return useMemo(() => {
    const byId = new Map<string, IntakeLine>();
    const day = intake?.days.find((d) => d.date === date);
    for (const line of [...(day?.meals.flatMap((m) => m.lines) ?? []), ...(day?.standalone ?? [])]) {
      if (line.kind === "pantry") byId.set(line.eventId, line);
    }
    return (id) => byId.get(id);
  }, [intake, date]);
}

interface LineProps {
  consume: ConsumeEvent;
  /** Il nome dell'alimento (dal lotto). */
  name: string;
  /** Il giorno mostrato, `YYYY-MM-DD`. */
  date: string;
  diary: DiaryState;
  line: IntakeLine | undefined;
  /** Il momento in cui il consumo sta adesso; assente se non è in nessun pasto. */
  kind?: MealKind;
  onError: (message: string | null) => void;
}

function useLineActions({ consume, name, date, diary, kind, onError }: LineProps) {
  const { recordWith, busy } = useRecord();
  const amount = formatQuantity(consume.quantity);

  async function move(to: MealKind): Promise<boolean> {
    onError(null);
    const result = await recordWith((deviceId) => {
      const marked = { consumes: [{ ...consume, note: QUICK_CONSUME_NOTE }], mealId: consume.mealId ?? "", kind: kind ?? "snack", date, joined: false, name, amount };
      const built = buildChangeMoment(marked, { kind: to, date }, { now: new Date().toISOString(), deviceId }, diary);
      if (!built.ok) throw new Error(built.error);
      return { events: built.events, message: built.message };
    });
    if (!result.ok) onError(result.error);
    return result.ok;
  }

  async function undo() {
    onError(null);
    const result = await recordWith((deviceId) => ({
      events: buildUndo([consume], { now: new Date().toISOString(), deviceId }),
      message: `Annullato: ${amount} di ${name.toLowerCase()}. Sono tornati in dispensa.`,
    }));
    if (!result.ok) onError(result.error);
  }

  return { busy, move, undo };
}

function MomentChips({ exclude, busy, onPick }: { exclude?: MealKind; busy: boolean; onPick: (kind: MealKind) => void }) {
  return (
    <div className={ui.row} role="group" aria-label="Momento">
      {MOMENT_CHOICES.filter((m) => m.kind !== exclude).map((m) => (
        <Button key={m.kind} variant="outline" disabled={busy} onClick={() => onPick(m.kind)}>
          {m.label}
        </Button>
      ))}
    </div>
  );
}

const nutrientNote = (line: IntakeLine | undefined) => {
  const text = lineNutrientText(line);
  return text ? <span className={styles.note}>{text}</span> : null;
};

/** Un alimento della dispensa dentro un pasto, con i nutrienti; se è nato da un tocco sulla scheda, si sposta o si annulla da qui. */
export function PantryLine(props: LineProps) {
  const { consume, name } = props;
  const { busy, move, undo } = useLineActions(props);
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
          <Button variant="text" disabled={busy} onClick={() => void undo()}>
            Annulla
          </Button>
          {moving ? <MomentChips exclude={props.kind} busy={busy} onPick={(to) => void move(to).then((ok) => ok && setMoving(false))} /> : null}
        </>
      ) : null}
    </li>
  );
}

/** Un consumo senza pasto (di prima, o di una preparazione): dice a che momento appartiene e lo mette lì con un tocco. */
export function LooseLine(props: LineProps) {
  const { consume, name } = props;
  const { busy, move, undo } = useLineActions(props);
  return (
    <div className={styles.meal}>
      <div className={styles.mealHead}>
        <span className={styles.mealTitle}>
          <Value certainty={consume.certainty === "estimated" ? "estimated" : "measured"}>{itemText(name, consume.quantity)}</Value>
        </span>
        {nutrientNote(props.line)}
      </div>
      <p className={styles.note}>Mangiato, ma non è in nessun pasto. In quale momento lo metti?</p>
      <MomentChips busy={busy} onPick={(to) => void move(to)} />
      <div>
        <Button variant="text" disabled={busy} onClick={() => void undo()}>
          Annulla
        </Button>
      </div>
    </div>
  );
}
