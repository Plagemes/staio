"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { MAIN_MEAL_KINDS, buildCatchUpEvents, stillEmpty, type CatchUpKind, type MealKind } from "@/core/diary";
import { createFoodMatcher, mealEnergyHistory } from "@/core/nutrition";
import { appendEvents, getDeviceId, getDiary, useDiary, useEventLog, usePantry } from "@/data";
import { Button } from "@/design";
import { Disclosure, Sheet, closeSheetThen } from "../common";
import { dayOf } from "../format";
import { MEAL_KIND_LABELS, OUT_OF_HOME_SIZE_LABELS, TYPICAL_MEAL_TIME, minutesOfTime } from "../meals";
import { useNotice } from "../notice";
import { useIntake } from "../nutrition/useNutrition";
import { mealsWithPantryOf } from "../today/dayRows";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import {
  CATCHUP_EXPLAIN,
  CATCHUP_TITLE,
  DISMISS_ERROR,
  NOTHING_LEFT,
  SAVE_ERROR,
  ESTIMATE_LABEL,
  SEE_IN_TODAY,
  alreadyThereText,
  catchUpDayHref,
  momentLine,
  rejectedText,
  savedMessage,
  stepTitle,
} from "./catchupText";
import {
  DEFAULT_SIZE,
  chosenOption,
  pantryFoodsOfConsumes,
  isEstimate,
  momentOptions,
  optionText,
  splitWritten,
  toEntry,
  type CatchUpOption,
  type CatchUpPick,
  type ChoiceSources,
} from "./choices";
import { STEP_SETTLE_MS, onPrimaryTap } from "./steps";
import { dismissCatchUp } from "./useCatchUp";
import styles from "./catchup.module.css";

const KINDS: readonly CatchUpKind[] = MAIN_MEAL_KINDS;
const FALLBACK_MINUTES: Record<MealKind, number> = { breakfast: 8 * 60, lunch: 13 * 60, dinner: 20 * 60, snack: 16 * 60 + 30 };
const MINUTES_OF = Object.fromEntries(
  (Object.keys(FALLBACK_MINUTES) as MealKind[]).map((kind) => [kind, minutesOfTime(TYPICAL_MEAL_TIME[kind]) ?? FALLBACK_MINUTES[kind]]),
) as Record<MealKind, number>;

const pickKey = (date: string, kind: CatchUpKind): string => `${date}|${kind}`;
// letto solo nei gestori dei tocchi, mai nel disegno
const clockMs = (): number => Date.now();

interface Props {
  /** I giorni da recuperare, dal più vecchio: fissati quando il foglio si apre. */
  days: readonly string[];
  onClose: () => void;
}

/**
 * «Mettiamoci in pari»: un passo per giorno, colazione, pranzo e cena con la scelta già fatta (il solito, come l'ultima
 * volta, «Non ricordo»). Niente si scrive prima di «Salva»; «Salva» rilegge l'archivio e scrive tutti i giorni in una
 * volta, poi il foglio si chiude e l'avviso offre «Annulla». Nulla tocca la dispensa.
 */
export function CatchUpSheet({ days, onClose }: Props) {
  const ids = useId();
  const notice = useNotice();
  const now = useNow();
  const diary = useDiary().data;
  const log = useEventLog().data;
  const pantry = usePantry().data;
  const { intake, foods } = useIntake();
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState<CatchUpKind | null>(null);
  const [picks, setPicks] = useState<Record<string, CatchUpPick>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // un doppio tocco arriva prima che `busy` si veda: la guardia vera è questa
  const working = useRef(false);
  // il passo in vista e quando è cambiato: un tocco sul pulsante pieno si legge da qui, non dal disegno su cui arriva
  const shownStep = useRef(0);
  const changedAt = useRef<number | null>(null);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    if (!settling) return;
    const timer = window.setTimeout(() => setSettling(false), STEP_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [settling, step]);

  const timeZone = diary?.timeZone;
  const today = now && timeZone ? dayOf(now, timeZone) : undefined;
  // si aspettano anche i nutrienti: servono alla stima «fuori casa» e a ripetere un pasto con gli alimenti di allora
  const options = useMemo(() => {
    if (!diary || !log || !pantry || !today || !intake || !foods) return undefined;
    const histories = new Map<CatchUpKind, readonly number[]>();
    // un prodotto letto dall'etichetta si ripete con l'alimento della tabella che ha il suo nome
    const pantryFoods = pantryFoodsOfConsumes(intake, createFoodMatcher(foods));
    const sources: ChoiceSources = {
      habits: diary.habits,
      meals: mealsWithPantryOf(diary, log),
      lotNames: new Map(pantry.lots.map((l) => [l.lotId, l.productRef])),
      energyHistory: (kind) => {
        let history = histories.get(kind);
        if (!history) histories.set(kind, (history = mealEnergyHistory(intake, kind, today)));
        return history;
      },
      foodOf: (consumeId) => pantryFoods.get(consumeId),
      today,
      firstDay: days[0],
    };
    return Object.fromEntries(KINDS.map((kind) => [kind, momentOptions(sources, kind)])) as Record<CatchUpKind, CatchUpOption[]>;
  }, [diary, log, pantry, intake, foods, today, days]);

  const date = days[step];
  const last = step === days.length - 1;

  const chosen = (d: string, kind: CatchUpKind): { option: CatchUpOption; size: CatchUpPick["size"] } | undefined => {
    if (!options) return undefined;
    const pick = picks[pickKey(d, kind)];
    return { option: chosenOption(options[kind], pick), size: pick?.size ?? DEFAULT_SIZE };
  };

  const choose = (kind: CatchUpKind, pick: CatchUpPick) => setPicks((all) => ({ ...all, [pickKey(date, kind)]: pick }));

  const goTo = (next: number) => {
    shownStep.current = next;
    changedAt.current = clockMs();
    setSettling(true);
    setOpen(null);
    setError(null);
    setStep(next);
  };

  const primaryTap = () => {
    const action = onPrimaryTap({ step: shownStep.current, total: days.length, changedAt: changedAt.current, now: clockMs() });
    if (action === "next") goTo(shownStep.current + 1);
    else if (action === "save") void save();
  };

  async function save() {
    if (working.current || !options || !timeZone) return;
    working.current = true;
    setBusy(true);
    setError(null);
    let done = false;
    try {
      // ciò che è a schermo, giorno per giorno: la scelta fatta o quella di partenza
      const plan = days.flatMap((d) =>
        KINDS.map((kind) => {
          const c = chosen(d, kind) as { option: CatchUpOption; size: CatchUpPick["size"] };
          return toEntry(d, kind, c.option, c.size);
        }),
      );
      // un altro telefono o un'altra scheda può aver scritto nel frattempo: si rilegge e quei momenti restano com'erano
      const fresh = await getDiary({ timeZone });
      const { entries, filled } = stillEmpty(fresh, plan);
      if (entries.length === 0) {
        done = true;
        closeSheetThen(() => notice.show({ message: NOTHING_LEFT }));
        return;
      }
      const events = buildCatchUpEvents(entries, { deviceId: await getDeviceId(), now: new Date().toISOString(), timeZone: fresh.timeZone, minutesOf: MINUTES_OF });
      // tutti i giorni in una sola scrittura: una riga in «Ultime azioni», un solo «Annulla»
      const written = await appendEvents(events);
      if (written.added === 0) {
        setError(SAVE_ERROR);
        return;
      }
      // ciò che è entrato è scritto: il foglio si chiude, così un nuovo tentativo non lo riscrive (riparte da Oggi e rilegge)
      done = true;
      const { entries: keptEntries, events: kept, refused: refusedEntries } = splitWritten(entries, events, written.rejected.map((r) => r.index));
      const message = [savedMessage(keptEntries), alreadyThereText(filled), rejectedText(refusedEntries)].filter((t) => t !== "").join(" ");
      closeSheetThen(() => notice.show({ message, undo: kept, link: { label: SEE_IN_TODAY, href: catchUpDayHref(days[0]) } }));
    } catch {
      // un piano non valido (`InvalidCatchUpError`) o l'archivio che non risponde: non è stato scritto niente
      setError(SAVE_ERROR);
    } finally {
      // dopo una scrittura riuscita il foglio si sta chiudendo: un altro tocco non deve scrivere di nuovo
      if (!done) working.current = false;
      setBusy(false);
    }
  }

  async function leave() {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try {
      await dismissCatchUp(days);
      closeSheetThen(() => undefined);
    } catch {
      working.current = false;
      setError(DISMISS_ERROR);
    } finally {
      setBusy(false);
    }
  }

  const primary = (
    <Button disabled={busy || settling || !options} onClick={primaryTap}>
      {last ? (busy ? "Salvo…" : "Salva") : "Avanti"}
    </Button>
  );
  const footer =
    step > 0 ? (
      <div className={styles.stepFooter}>
        <Button variant="text" disabled={busy} onClick={() => goTo(shownStep.current - 1)}>
          Indietro
        </Button>
        {primary}
      </div>
    ) : (
      primary
    );

  return (
    <Sheet
      title={CATCHUP_TITLE}
      onClose={onClose}
      busy={busy}
      onBack={step > 0 ? () => goTo(shownStep.current - 1) : undefined}
      head={<p className={styles.step}>{stepTitle(date, step, days.length)}</p>}
      footer={footer}
    >
      <div className={ui.form}>
        {options ? (
          <ul className={styles.moments} aria-label={stepTitle(date, step, days.length)}>
            {KINDS.map((kind) => {
              const c = chosen(date, kind) as { option: CatchUpOption; size: CatchUpPick["size"] };
              const isOpen = open === kind;
              const groupId = `${ids}-${kind}`;
              return (
                <li key={kind} className={styles.moment}>
                  <button
                    type="button"
                    className={styles.momentRow}
                    aria-expanded={isOpen}
                    aria-controls={isOpen ? groupId : undefined}
                    disabled={busy}
                    onClick={() => setOpen(isOpen ? null : kind)}
                  >
                    <span>{momentLine(kind, optionText(c.option, c.size))}</span>
                    {isEstimate(c.option) ? <span className={styles.estimate}>{ESTIMATE_LABEL}</span> : null}
                  </button>
                  {isOpen ? (
                    <fieldset id={groupId} className={styles.options} disabled={busy}>
                      <legend className={ui.srOnly}>{MEAL_KIND_LABELS[kind]}</legend>
                      {options[kind].map((option) => (
                        <div key={option.id}>
                          <label className={styles.option}>
                            <input
                              type="radio"
                              name={`${groupId}-${date}`}
                              checked={c.option.id === option.id}
                              onChange={() => choose(kind, { option: option.id, size: c.size })}
                            />
                            <span>{option.label}</span>
                          </label>
                          {option.type === "out" && c.option.id === option.id ? (
                            <div className={styles.sizes} role="radiogroup" aria-label={option.label}>
                              {option.sizes.map((s) => (
                                <label key={s.size} className={styles.option}>
                                  <input type="radio" name={`${groupId}-${date}-size`} checked={c.size === s.size} onChange={() => choose(kind, { option: option.id, size: s.size })} />
                                  <span className={styles.sizeText}>
                                    <span>{OUT_OF_HOME_SIZE_LABELS[s.size]}</span>
                                    <span className={ui.hint}>{s.hint}</span>
                                  </span>
                                </label>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </fieldset>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className={ui.hint}>Un attimo…</p>
        )}
        {error ? (
          <p className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
        {step === 0 ? (
          <Button variant="text" className={styles.leave} disabled={busy} onClick={() => void leave()}>
            Lascia così
          </Button>
        ) : null}
        <Disclosure title="Che cosa significa" quiet>
          {CATCHUP_EXPLAIN}
        </Disclosure>
      </div>
    </Sheet>
  );
}
