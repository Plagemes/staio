"use client";

// Il foglio «Pasto», dietro «Altro» in fondo a un pasto aperto: aggiungere, cambiare momento giorno e ora, ripetere,
// togliere e, se un altro dispositivo l'ha corretto in un altro modo, scegliere quale versione tenere. Stessa regola
// del foglio «Voce»: una scrittura, il foglio si chiude, poi l'avviso con «Annulla».
import { useId, useState } from "react";
import {
  addDays,
  keepMealVersion,
  localMoment,
  momentOfMinutes,
  rewriteMeal,
  voidMeal,
  type DiaryState,
  type MealItem,
  type MealKind,
  type MealWithPantry,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { activeLots, type PantryState } from "@/core/ledger";
import { Button, Value, cx } from "@/design";
import { ActionList, Sheet, type ActionItem } from "../common";
import { shortTime } from "../drinks";
import { evaluateLots } from "../lots";
import { eatOrder } from "../meal/plate";
import { buildRepeatMeal } from "../mealEdit";
import { MEAL_KIND_LABELS, energyEstimateText, isOutOfHomeItem, itemText, minutesOfTime } from "../meals";
import { useNotice } from "../notice";
import { MOMENT_CHOICES } from "../pantry/eaten";
import ui from "../ui.module.css";
import {
  OTHER_VERSION_USED_TEXT,
  VERSION_KEPT_TEXT,
  dayTail,
  mealMovedText,
  mealRemovedText,
  mealSheetTitle,
  namesHint,
  repeatableNames,
} from "./editText";
import { useSheetWrite } from "./EntrySheet";
import styles from "./MealEntries.module.css";

export type MealSheetStep = "main" | "when" | "other";

interface Props {
  /** Il titolo con cui il foglio è stato aperto: resta anche se il pasto nel frattempo è sparito. */
  title: string;
  /** `undefined`: il pasto non c'è più (tolto da un altro telefono mentre il foglio era aperto). */
  meal: MealWithPantry | undefined;
  /** Il passo con cui il foglio si apre; «L'altra versione» quando ci si arriva dalla riga sotto il pasto. */
  initialStep?: MealSheetStep;
  today: string;
  /** Istante corrente: oggi un pasto non si mette a un'ora che deve ancora venire. */
  now: string;
  diary: DiaryState;
  log: readonly AnyEvent[];
  pantry: PantryState;
  /** Dal lotto al nome dell'alimento. */
  lotNames: ReadonlyMap<string, string>;
  onClose: () => void;
}

/** Fin dove si può riportare un pasto: gli stessi giorni che il diario di Oggi lascia sfogliare. */
const MAX_DAYS_BACK = 60;

const clock = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export function MealSheet({ title, meal: given, initialStep = "main", today, now, diary, log, pantry, lotNames, onClose }: Props) {
  const ids = useId();
  const { write, busy, error, clearError } = useSheetWrite(onClose);
  const notice = useNotice();
  const [step, setStep] = useState<MealSheetStep>(initialStep);
  // `null`: il campo non è stato toccato e vale ciò che il pasto ha adesso
  const [kindEdit, setKindEdit] = useState<MealKind | null>(null);
  const [dayEdit, setDayEdit] = useState<string | null>(null);
  const [timeEdit, setTimeEdit] = useState<string | null>(null);

  const timeZone = diary.timeZone;
  const was = given ? localMoment(given.at, timeZone) : undefined;

  if (!given || !was) {
    return (
      <Sheet title={title} onClose={onClose} busy={busy}>
        {/* durante una scrittura il pasto sparisce un attimo prima che il foglio si chiuda: non è un errore */}
        {busy ? null : <p className={ui.hint}>Questo pasto non c&apos;è più.</p>}
      </Sheet>
    );
  }

  const meal = given;
  const name = meal.title ?? MEAL_KIND_LABELS[meal.kind];
  const sheetTitle = mealSheetTitle(name, shortTime(meal.at, timeZone));
  const repeatNames = repeatableNames(meal, lotNames);
  const others = meal.otherVersions ?? [];
  // la più recente tra le versioni rimaste fuori: è quella che si mostra e che «Usa l'altra» mette al posto di questa
  const other = others[0];

  const go = (next: MealSheetStep) => {
    setStep(next);
    clearError();
  };

  const errorLine = error ? (
    <p className={ui.error} role="alert">
      {error}
    </p>
  ) : null;

  function repeat() {
    // Il pasto nuovo è di oggi. Se la pagina mostra un altro giorno non lo si vede nascere: l'avviso dice dove vederlo.
    let elsewhere: { events: readonly AnyEvent[]; message: string; mealEventId: string } | undefined;
    void write(({ deviceId, now: at }) => {
      // nell'ordine in cui si mangiano le confezioni, lo stesso di Registra pasto
      const lots = eatOrder(evaluateLots(activeLots(pantry), at)).map((e) => e.lot);
      const kind = momentOfMinutes(localMoment(at, timeZone)?.minutes ?? 0);
      const built = buildRepeatMeal({ meal, names: lotNames, lots, kind }, { deviceId, now: at });
      if (built.events.length === 0) return { ok: false, error: built.message };
      const created = built.events.find((e) => e.type === "meal");
      return {
        ok: true,
        events: built.events,
        message: built.message,
        afterWrite: () => {
          if (created && meal.date !== today) elsewhere = { events: built.events, message: built.message, mealEventId: created.id };
        },
      };
    }).then(() => {
      // la scrittura è riuscita e il suo avviso è appena nato: lo stesso avviso, con in più il collegamento
      if (elsewhere) {
        notice.show({ message: elsewhere.message, undo: elsewhere.events, link: { label: "Vedi in Oggi", href: `/app?voce=${encodeURIComponent(elsewhere.mealEventId)}` } });
      }
    });
  }

  function remove() {
    void write(({ deviceId, now: at }) => {
      // sempre per `mealId`: di un pasto tolto altrove e rimasto con una voce, l'evento mostrato è già annullato
      const voids = voidMeal(meal.mealId, log, { deviceId, now: () => at });
      return voids.length > 0 ? { ok: true, events: voids, message: mealRemovedText(name) } : { ok: false, error: "Questo pasto non c'è più." };
    });
  }

  /**
   * Chiude il doppione riscrivendo il pasto con il contenuto scelto: una versione in vigore resta sempre, anche se
   * sull'altro dispositivo, prima di unirsi, si sceglie al contrario.
   */
  function choose(keep: "shown" | "other") {
    if (!other) return;
    const chosen = keep === "shown" ? meal : other;
    void write(({ deviceId, now: at }) => {
      const edit = keepMealVersion(meal.mealId, { at: chosen.at, kind: chosen.kind, items: chosen.items }, log, { deviceId, now: at, timeZone });
      if (!edit.ok) return edit;
      return { ok: true, events: edit.events, message: keep === "shown" ? VERSION_KEPT_TEXT : OTHER_VERSION_USED_TEXT };
    });
  }

  if (step === "other" && other) {
    const choices: ActionItem[] = [
      { id: "keep", label: "Tieni questa", hint: "Resta ciò che vedi nel diario.", disabled: busy, onSelect: () => choose("shown") },
      { id: "use", label: "Usa l'altra", hint: "Il pasto prende momento, ora e voci dell'altra versione.", disabled: busy, onSelect: () => choose("other") },
    ];
    const version = (label: string, v: { kind: MealKind; at: string; items: readonly MealItem[] }) => {
      const day = localMoment(v.at, timeZone)?.date;
      return (
        <div className={styles.version}>
          <span className={ui.fieldLabel}>{label}</span>
          <span className={ui.hint}>
            {MEAL_KIND_LABELS[v.kind]}, {shortTime(v.at, timeZone)}
            {day ? dayTail(day, today) : ""}
          </span>
          {v.items.length > 0 ? (
            <ul className={styles.versionItems}>
              {v.items.map((i, index) => (
                <li key={`${i.name}-${index}`}>
                  {/* una stima «fuori casa» è fatta della sua energia: due versioni possono differire solo lì */}
                  {isOutOfHomeItem(i) ? (
                    `${i.name} · ${energyEstimateText(i.energyKcal ?? 0)}`
                  ) : (
                    <>
                      <Value certainty={i.certainty === "estimated" ? "estimated" : "measured"}>{itemText(i.name, i.quantity)}</Value>
                      {i.energyKcal !== undefined ? ` · ${energyEstimateText(i.energyKcal)}` : ""}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <span className={ui.hint}>Nessuna voce scritta a mano.</span>
          )}
        </div>
      );
    };
    return (
      <Sheet
        title={sheetTitle}
        onClose={onClose}
        busy={busy}
        onBack={() => go("main")}
        footer={
          <Button variant="text" className={styles.back} disabled={busy} onClick={() => go("main")}>
            Indietro
          </Button>
        }
      >
        <p className={ui.hint}>Due dispositivi hanno corretto questo pasto in modi diversi. Nel diario vale la correzione più recente.</p>
        {version("Questa, nel diario", meal)}
        {version("L'altra versione", other)}
        {meal.pantryConsumes.length > 0 ? <p className={ui.hint}>Gli alimenti presi dalla dispensa restano gli stessi in tutte e due.</p> : null}
        <ActionList items={choices} />
        {errorLine}
      </Sheet>
    );
  }

  if (step === "when") {
    const kind = kindEdit ?? meal.kind;
    const day = dayEdit ?? was.date;
    const time = timeEdit ?? clock(was.minutes);
    const minutes = minutesOfTime(time);
    const oldest = addDays(today, -MAX_DAYS_BACK);
    const firstDay = was.date < oldest ? was.date : oldest;
    const dayOk = /^\d{4}-\d{2}-\d{2}$/.test(day) && day <= today && day >= firstDay;
    const moved = day !== was.date || minutes !== was.minutes;
    const changed = kind !== meal.kind || moved;
    const nowMinutes = localMoment(now, timeZone)?.minutes;
    // un'ora già registrata nel futuro non blocca il cambio del solo momento: si ferma chi la sposta
    const future = moved && day === today && minutes !== undefined && nowMinutes !== undefined && minutes > nowMinutes;
    const timeError = minutes === undefined ? "Scegli un'ora." : future ? "Quest'ora deve ancora venire." : null;

    const save = () => {
      if (minutes === undefined || !dayOk || !changed || future) return;
      void write(({ deviceId, now: at }) => {
        const edit = rewriteMeal(meal.mealId, { kind, date: day, minutes }, log, { deviceId, now: at, timeZone });
        if (!edit.ok) return edit;
        return { ok: true, events: edit.events, message: mealMovedText({ kind, date: day, today, time: clock(minutes).replace(/^0/, "") }) };
      });
    };

    return (
      <Sheet
        title={sheetTitle}
        onClose={onClose}
        busy={busy}
        onBack={() => go("main")}
        footer={
          <div className={styles.stepFooter}>
            <Button variant="text" disabled={busy} onClick={() => go("main")}>
              Indietro
            </Button>
            <Button disabled={busy || !changed || !dayOk || timeError !== null} onClick={save}>
              Salva
            </Button>
          </div>
        }
      >
        <div className={cx(ui.fields, styles.sheetStep)}>
          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel}>Momento</legend>
            <div className={ui.choices}>
              {MOMENT_CHOICES.map((m) => (
                <label key={m.kind} className={ui.choice}>
                  <input
                    type="radio"
                    name={`${ids}-moment`}
                    value={m.kind}
                    checked={kind === m.kind}
                    onChange={() => {
                      setKindEdit(m.kind);
                      clearError();
                    }}
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-day`}>
              Giorno
            </label>
            <input
              id={`${ids}-day`}
              className={ui.input}
              type="date"
              value={day}
              min={firstDay}
              max={today}
              aria-invalid={dayOk ? undefined : true}
              aria-describedby={dayOk ? undefined : `${ids}-day-error`}
              onChange={(e) => {
                setDayEdit(e.target.value);
                clearError();
              }}
            />
            {dayOk ? null : (
              <p className={ui.error} id={`${ids}-day-error`} role="alert">
                Scegli un giorno tra gli ultimi 60, fino a oggi.
              </p>
            )}
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-time`}>
              Ora
            </label>
            <input
              id={`${ids}-time`}
              className={ui.input}
              type="time"
              value={time}
              aria-invalid={timeError ? true : undefined}
              aria-describedby={timeError ? `${ids}-time-error` : undefined}
              onChange={(e) => {
                setTimeEdit(e.target.value);
                clearError();
              }}
            />
            {timeError ? (
              <p className={ui.error} id={`${ids}-time-error`} role="alert">
                {timeError}
              </p>
            ) : null}
          </div>
        </div>
        {dayOk && day !== was.date ? (
          <p className={ui.hint}>La dispensa resta com&apos;è: gli alimenti sono stati scalati quando li hai registrati.</p>
        ) : null}
        {errorLine}
      </Sheet>
    );
  }

  const actions: ActionItem[] = [
    ...(other ? [{ id: "other", label: "L'altra versione", hint: "Corretto anche da un altro dispositivo", disabled: busy, onSelect: () => go("other") }] : []),
    { id: "add", label: "Aggiungi qui", href: `/app/pasto?pasto=${encodeURIComponent(meal.mealId)}` },
    { id: "when", label: "Cambia momento o ora", disabled: busy, onSelect: () => go("when") },
    ...(repeatNames.length > 0 ? [{ id: "repeat", label: "Ripeti adesso", hint: namesHint(repeatNames), disabled: busy, onSelect: repeat }] : []),
    { id: "remove", label: "Togli il pasto", danger: true, disabled: busy, onSelect: remove },
  ];

  return (
    <Sheet title={sheetTitle} onClose={onClose} busy={busy}>
      <ActionList items={actions} />
      {errorLine}
    </Sheet>
  );
}
