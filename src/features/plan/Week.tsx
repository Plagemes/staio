"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { ALLERGEN_CHECK_NOTICE, deriveConfirmations } from "@/core/allergens";
import type { MealKind } from "@/core/diary";
import {
  checkPlanWeek,
  dayTypeOf,
  getWeek,
  weekDates,
  type PlannedEntry,
  type Slot,
  type PlannedItem,
} from "@/core/plan";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { Button, Label, Tabs } from "@/design";
import { readQuantity } from "../capture";
import { MEAL_KIND_LABELS, MEAL_KIND_ORDER } from "../meals";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { AddEntry } from "./AddEntry";
import { WEEK_LABELS, dayHeading, dayMonth, weekChoices, weekRangeText, type WeekChoice } from "./dates";
import { itemLabel } from "./describe";
import {
  buildClearDayType,
  buildDayType,
  buildWeek,
  copyDay,
  copyWeek,
  entryOf,
  withAmount,
  withEntry,
  withItem,
  withoutEntry,
} from "./edit";
import { EatSheet } from "./EatSheet";
import { MoveSheet } from "./MoveSheet";
import { buildMoveMeal, slotsToMoveTo } from "./moveMeal";
import { Sheet } from "./Sheet";
import { parseAmount } from "./targets";
import { usePlanData, type PlanData } from "./usePlanData";
import { useWriter } from "./useWriter";
import { checkWeekConstraints } from "./safety";
import { constraintLines, dayCheckView, daySummaryText } from "./verify";
import styles from "./plan.module.css";

type SheetState =
  | { type: "add"; date: string }
  | { type: "eat"; entry: PlannedEntry }
  | { type: "move"; from: Slot }
  | { type: "amount"; index: number }
  | { type: "copyDay"; date: string }
  | { type: "copyWeek" }
  | { type: "dayType"; date: string };

const SHOWN_WEEKS = ["current", "next"] as const;

export function Week() {
  const data = usePlanData();
  const [weekId, setWeekId] = useState<(typeof SHOWN_WEEKS)[number]>("current");
  const [sheet, setSheet] = useState<SheetState | null>(null);

  if (data.error) return <StorageError />;
  if (!data.ready || !data.plan) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Settimana</h1>
        <LoadingLine />
      </div>
    );
  }
  const weeks = weekChoices(data.today);
  const week = weeks.find((w) => w.id === weekId) as WeekChoice;
  return <WeekView key={week.start} data={data} weeks={weeks} week={week} weekId={weekId} setWeekId={setWeekId} sheet={sheet} setSheet={setSheet} />;
}

interface ViewProps {
  data: PlanData;
  weeks: WeekChoice[];
  week: WeekChoice;
  weekId: (typeof SHOWN_WEEKS)[number];
  setWeekId: (id: (typeof SHOWN_WEEKS)[number]) => void;
  sheet: SheetState | null;
  setSheet: (s: SheetState | null) => void;
}

function WeekView({ data, weeks, week, weekId, setWeekId, sheet, setSheet }: ViewProps) {
  const plan = data.plan!;
  const write = useWriter();
  const [error, setError] = useState<string | null>(null);
  const state = getWeek(plan, week.start);
  const entries = useMemo(() => state?.entries ?? [], [state]);
  const dates = weekDates(week.start);
  const mealOrder: MealKind[] = plan.structure ? plan.structure.meals.map((m) => m.kind) : [...MEAL_KIND_ORDER];
  const mealTime = new Map((plan.structure?.meals ?? []).map((m) => [m.kind, m.time]));
  const nameOfRef = (via: { kind: "recipe" | "prep"; id: string }) =>
    via.kind === "recipe" ? (data.recipes.find((r) => r.recipeId === via.id)?.title ?? "una ricetta") : (data.preps.find((p) => p.prepId === via.id)?.title ?? "una preparazione");

  const check = useMemo(() => (data.nutrientsOf ? checkPlanWeek(plan, week.start, data.nutrientsOf) : undefined), [plan, week.start, data.nutrientsOf]);
  const confirmations = useMemo(() => deriveConfirmations(data.log ?? []).byKey, [data.log]);
  const constraints = useMemo(
    () => checkWeekConstraints(plan.structure, state, { expandForChecks: data.expandForChecks, linkOf: data.linkOf, confirmations }),
    [plan.structure, state, data.expandForChecks, data.linkOf, confirmations],
  );
  const constraintItems = constraintLines(constraints, nameOfRef);
  const violations = constraintItems.filter((l) => l.kind === "violation");
  const unverified = constraintItems.filter((l) => l.kind === "unverified");
  const confirmedItems = constraintItems.filter((l) => l.kind === "confirmed");

  async function save(next: readonly PlannedEntry[], message: string, weekStart = week.start): Promise<string | null> {
    const failure = await write((ctx) => buildWeek(weekStart, next, ctx, message));
    setError(failure);
    return failure;
  }

  const close = () => setSheet(null);
  const sheetEntry = sheet?.type === "amount" ? entries[sheet.index] : undefined;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Settimana</h1>
        <Label>{weekRangeText(week.start)}</Label>
      </div>

      <Tabs
        label="Settimana"
        items={SHOWN_WEEKS.map((id) => ({ id, label: WEEK_LABELS[id] }))}
        value={weekId}
        onChange={(id) => setWeekId(id as (typeof SHOWN_WEEKS)[number])}
      />

      <div className={ui.row}>
        <Button variant="outline" onClick={() => setSheet({ type: "copyWeek" })}>
          Copia un&apos;altra settimana qui
        </Button>
        <Link href="/app/piano/verifica" className={ui.textLink}>
          Verifica e confronto
        </Link>
      </div>

      {violations.length > 0 ? (
        <div className={styles.alert} role="alert">
          <strong>Nel piano c&apos;è qualcosa che hai escluso</strong>
          <ul className={styles.alertList}>
            {violations.map((v, i) => (
              <li key={i}>
                {dayMonth(v.date)}: {v.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {unverified.length > 0 ? (
        <div className={styles.alert}>
          <strong>Non ho potuto controllare tutto</strong>
          <ul className={styles.alertList}>
            {unverified.map((v, i) => (
              <li key={i}>
                {dayMonth(v.date)}: {v.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {confirmedItems.length > 0 ? (
        <div className={styles.alert}>
          <strong>Confermato da te</strong>
          <ul className={styles.alertList}>
            {confirmedItems.map((v, i) => (
              <li key={i}>
                {dayMonth(v.date)}: {v.text}
              </li>
            ))}
          </ul>
          <p className={ui.hint}>Puoi revocare le conferme in «Obiettivi», dove dichiari gli allergeni.</p>
        </div>
      ) : null}
      {violations.length + unverified.length + confirmedItems.length > 0 ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          title="Niente di pianificato"
          text="Aggiungi alimenti, ricette o preparazioni ai pasti di ogni giorno: qui compariranno giorno per giorno, e da qui si registrano come mangiati."
          actionLabel="Aggiungi un pasto"
          actionHref="#giorni"
        />
      ) : null}

      <ol className={styles.days} id="giorni">
        {dates.map((date) => {
          const dayEntries = entries.map((entry, index) => ({ entry, index })).filter((x) => x.entry.date === date);
          const dayType = dayTypeOf(plan, date);
          const fromDefault = !plan.dayTypes.some((d) => d.date === date);
          const view = check ? dayCheckView(check.days.find((d) => d.date === date)!) : undefined;
          const summary = view && view.checked ? daySummaryText(view) : "";
          return (
            <li key={date} className={styles.day}>
              <div className={styles.dayHead}>
                <h2 className={styles.dayTitle}>{dayHeading(date, data.today)}</h2>
                <button type="button" className={styles.action} onClick={() => setSheet({ type: "dayType", date })}>
                  {dayType ? `Giornata: ${dayType}${dayType && fromDefault ? " (predefinita)" : ""}` : "Tipo di giornata"}
                </button>
              </div>
              {summary ? <p className={styles.dayNote}>{summary}. Sono stime sui dati che ci sono.</p> : null}

              {dayEntries.length === 0 ? <p className={styles.dayNote}>Niente di pianificato.</p> : null}
              {mealOrder.concat(MEAL_KIND_ORDER.filter((k) => !mealOrder.includes(k))).map((meal) => {
                const here = dayEntries.filter((x) => x.entry.meal === meal);
                if (here.length === 0) return null;
                return (
                  <div key={meal} className={styles.mealBlock}>
                    <Label>
                      {MEAL_KIND_LABELS[meal]}
                      {mealTime.get(meal) ? ` · ${mealTime.get(meal)}` : ""}
                    </Label>
                    <ul className={styles.entries}>
                      {here.map(({ entry, index }) => (
                        <li key={index} className={styles.entry}>
                          <span className={styles.entryName}>{itemLabel(entry.item, data.catalog)}</span>
                          {entry.note ? <span className={styles.entryNote}>{entry.note}</span> : null}
                          <div className={styles.actions}>
                            <button type="button" className={styles.action} onClick={() => setSheet({ type: "eat", entry })}>
                              Registralo come mangiato
                            </button>
                            <button type="button" className={styles.action} onClick={() => setSheet({ type: "move", from: { date: entry.date, meal: entry.meal } })}>
                              Sposta
                            </button>
                            <button type="button" className={styles.action} onClick={() => setSheet({ type: "amount", index })}>
                              Quantità
                            </button>
                            <button type="button" className={styles.actionDanger} onClick={() => void save(withoutEntry(entries, index), `Tolto dal piano: ${itemLabel(entry.item, data.catalog)}.`)}>
                              Togli
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
              <div className={styles.actions}>
                <button type="button" className={styles.action} onClick={() => setSheet({ type: "add", date })}>
                  Aggiungi
                </button>
                {dayEntries.length > 0 ? (
                  <button type="button" className={styles.action} onClick={() => setSheet({ type: "copyDay", date })}>
                    Copia il giorno
                  </button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      {sheet?.type === "add" ? (
        <Sheet title={`Aggiungi, ${dayMonth(sheet.date)}`} onClose={close}>
          <AddEntry
            data={data}
            date={sheet.date}
            meals={mealOrder}
            defaultMeal={mealOrder[0] ?? "lunch"}
            onAdd={async (meal: MealKind, item: PlannedItem) => {
              const date = sheet.date;
              const failure = await save(withEntry(entries, entryOf(date, meal, item)), `Aggiunto al piano: ${itemLabel(item, data.catalog)}.`);
              if (!failure) close();
              return failure;
            }}
          />
        </Sheet>
      ) : null}

      {sheet?.type === "move" && data.diary && data.now ? (
        <MoveSheet
          what={entries
            .filter((e) => e.date === sheet.from.date && e.meal === sheet.from.meal)
            .map((e) => itemLabel(e.item, data.catalog))
            .join(", ")}
          from={sheet.from}
          today={data.today}
          options={slotsToMoveTo({
            weekEntries: entries,
            diary: data.diary,
            now: data.now,
            timeZone: data.diary.timeZone ?? DEFAULT_TIME_ZONE,
            today: data.today,
            weekStart: week.start,
            kinds: plan.structure?.meals.map((m) => m.kind),
            from: sheet.from,
          })}
          onClose={close}
          onMove={async (to) => {
            const failure = await write((ctx) => buildMoveMeal(week.start, entries, sheet.from, to, ctx));
            setError(failure);
            if (!failure) close();
            return failure;
          }}
        />
      ) : null}

      {sheet?.type === "eat" ? <EatSheet data={data} entry={sheet.entry} onClose={close} /> : null}

      {sheet?.type === "amount" && sheetEntry ? (
        <AmountSheet
          entry={sheetEntry}
          data={data}
          onClose={close}
          onSave={async (item) => {
            const failure = await save(item.kind === "food" ? withItem(entries, sheet.index, item) : withAmount(entries, sheet.index, item.servings), `Piano aggiornato: ${itemLabel(item, data.catalog)}.`);
            if (!failure) close();
            return failure;
          }}
        />
      ) : null}

      {sheet?.type === "copyDay" ? (
        <CopyDaySheet
          from={sheet.date}
          today={data.today}
          weeks={weeks}
          onClose={close}
          onCopy={async (to) => {
            const target = weeks.find((w) => to >= w.start && to <= weekDates(w.start)[6]) as WeekChoice;
            const sourceEntries = entries;
            const targetEntries = target.start === week.start ? entries : (getWeek(plan, target.start)?.entries ?? []);
            const failure = await save(copyDay(sourceEntries, targetEntries, sheet.date, to), `Copiato il ${dayMonth(sheet.date)} sul ${dayMonth(to)}.`, target.start);
            if (!failure) close();
            return failure;
          }}
        />
      ) : null}

      {sheet?.type === "copyWeek" ? (
        <CopyWeekSheet
          weeks={weeks.filter((w) => w.start !== week.start)}
          plan={plan}
          target={week}
          onClose={close}
          onCopy={async (from) => {
            const source = getWeek(plan, from.start)?.entries ?? [];
            const failure = await save(copyWeek(source, from.start, week.start), `Copiata la settimana ${weekRangeText(from.start)}.`);
            if (!failure) close();
            return failure;
          }}
        />
      ) : null}

      {sheet?.type === "dayType" ? (
        <DayTypeSheet
          date={sheet.date}
          data={data}
          onClose={close}
          onSet={async (name) => {
            const failure = await write((ctx) => buildDayType(sheet.date, name, ctx));
            if (!failure) close();
            return failure;
          }}
          onClear={async () => {
            const current = plan.dayTypes.find((d) => d.date === sheet.date);
            if (!current) return null;
            const failure = await write((ctx) => buildClearDayType(current.eventId, sheet.date, ctx));
            if (!failure) close();
            return failure;
          }}
        />
      ) : null}
    </div>
  );
}

function AmountSheet({
  entry,
  data,
  onClose,
  onSave,
}: {
  entry: PlannedEntry;
  data: PlanData;
  onClose: () => void;
  onSave: (item: PlannedItem) => Promise<string | null>;
}) {
  const id = useId();
  const item = entry.item;
  const [text, setText] = useState(item.kind === "food" ? `${item.quantity.value} ${item.quantity.unit}` : String(item.servings).replace(".", ","));
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    let next: PlannedItem;
    if (item.kind === "food") {
      const q = readQuantity(text);
      if (!q.ok) return setError(q.error);
      next = { ...item, quantity: q.quantity };
    } else {
      const n = parseAmount(text);
      if (n === null || n <= 0) return setError("Scrivi quante porzioni, per esempio 2.");
      next = { ...item, servings: n };
    }
    const failure = await onSave(next);
    if (failure) setError(failure);
  }

  return (
    <Sheet title="Quantità" onClose={onClose}>
      <p className={ui.lead}>{itemLabel(item, data.catalog)}</p>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={id}>
          {item.kind === "food" ? "Quantità" : "Porzioni"}
        </label>
        <input id={id} className={ui.input} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" inputMode={item.kind === "food" ? "text" : "decimal"} />
      </div>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <Button onClick={() => void submit()}>Salva</Button>
    </Sheet>
  );
}

function CopyDaySheet({
  from,
  today,
  weeks,
  onClose,
  onCopy,
}: {
  from: string;
  today: string;
  weeks: WeekChoice[];
  onClose: () => void;
  onCopy: (to: string) => Promise<string | null>;
}) {
  const ids = useId();
  const [to, setTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const options = weeks.filter((w) => w.id !== "previous").flatMap((w) => weekDates(w.start)).filter((d) => d !== from && d >= today);
  return (
    <Sheet title={`Copia il ${dayMonth(from)}`} onClose={onClose}>
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Su quale giorno</legend>
        <div className={ui.choices}>
          {options.map((d) => (
            <label key={d} className={ui.choice}>
              <input type="radio" name={`${ids}-to`} checked={to === d} onChange={() => setTo(d)} />
              <span>{dayHeading(d, today).replace(/, (oggi|domani)$/, "")}</span>
            </label>
          ))}
        </div>
        <p className={ui.hint}>I pasti già pianificati nel giorno scelto vengono sostituiti. Con «Annulla» tornano.</p>
      </fieldset>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <Button
        disabled={to === null}
        onClick={async () => {
          if (to) setError(await onCopy(to));
        }}
      >
        Copia
      </Button>
    </Sheet>
  );
}

function CopyWeekSheet({
  weeks,
  plan,
  target,
  onClose,
  onCopy,
}: {
  weeks: WeekChoice[];
  plan: NonNullable<PlanData["plan"]>;
  target: WeekChoice;
  onClose: () => void;
  onCopy: (from: WeekChoice) => Promise<string | null>;
}) {
  const ids = useId();
  const [from, setFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const usable = weeks.filter((w) => (getWeek(plan, w.start)?.entries.length ?? 0) > 0);
  const chosen = usable.find((w) => w.start === from);
  return (
    <Sheet title="Copia una settimana" onClose={onClose}>
      {usable.length === 0 ? (
        <p className={ui.lead}>Nelle altre settimane non c&apos;è ancora niente di pianificato da copiare.</p>
      ) : (
        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Quale settimana copio su {weekRangeText(target.start)}</legend>
          <div className={ui.choices}>
            {usable.map((w) => (
              <label key={w.start} className={ui.choice}>
                <input type="radio" name={`${ids}-from`} checked={from === w.start} onChange={() => setFrom(w.start)} />
                <span>
                  {WEEK_LABELS[w.id]}, {weekRangeText(w.start)}
                </span>
              </label>
            ))}
          </div>
          <p className={ui.hint}>Sostituisce tutto ciò che è pianificato in questa settimana. Con «Annulla» torna com&apos;era.</p>
        </fieldset>
      )}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <Button
        disabled={!chosen}
        onClick={async () => {
          if (chosen) setError(await onCopy(chosen));
        }}
      >
        Copia la settimana
      </Button>
    </Sheet>
  );
}

function DayTypeSheet({
  date,
  data,
  onClose,
  onSet,
  onClear,
}: {
  date: string;
  data: PlanData;
  onClose: () => void;
  onSet: (name: string) => Promise<string | null>;
  onClear: () => Promise<string | null>;
}) {
  const ids = useId();
  const plan = data.plan!;
  const known = [...new Set([...plan.targets.map((t) => t.dayType), ...plan.dayTypes.map((d) => d.dayType), ...(plan.structure?.defaultDayType ? [plan.structure.defaultDayType] : [])])].sort();
  const current = plan.dayTypes.find((d) => d.date === date);
  const [choice, setChoice] = useState<string>(current?.dayType ?? "");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const name = choice === "__new" ? custom : choice;
  return (
    <Sheet title={`Tipo di giornata, ${dayMonth(date)}`} onClose={onClose}>
      <p className={ui.lead}>Per esempio «allenamento» o «riposo»: i nomi li scegli tu, e gli obiettivi si scrivono per ogni tipo.</p>
      <fieldset className={ui.field}>
        <legend className={ui.srOnly}>Tipo di giornata</legend>
        <div className={ui.choices}>
          {known.map((k) => (
            <label key={k} className={ui.choice}>
              <input type="radio" name={`${ids}-t`} checked={choice === k} onChange={() => setChoice(k)} />
              <span>{k}</span>
            </label>
          ))}
          <label className={ui.choice}>
            <input type="radio" name={`${ids}-t`} checked={choice === "__new"} onChange={() => setChoice("__new")} />
            <span>Un altro</span>
          </label>
        </div>
        {choice === "__new" ? (
          <input className={ui.input} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Nome del tipo di giornata" placeholder="allenamento" autoComplete="off" />
        ) : null}
      </fieldset>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={ui.row}>
        <Button disabled={name.trim() === ""} onClick={async () => setError(await onSet(name))}>
          Salva
        </Button>
        {current ? (
          <Button variant="outline" onClick={async () => setError(await onClear())}>
            Togli
          </Button>
        ) : null}
      </div>
    </Sheet>
  );
}
