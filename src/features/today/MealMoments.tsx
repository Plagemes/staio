"use client";

import { useMemo, useState, type ReactElement } from "react";
import {
  dayBefore,
  drinksByMoment,
  instantOfLocal,
  localMoment,
  momentOfMinutes,
  voidMeal,
  type DiaryDay,
  type DiaryDrink,
  type DiaryState,
  type MealDeclarationStatus,
  type MealKind,
  type MealWithPantry,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { activeLots, type ConsumeEvent, type PantryState } from "@/core/ledger";
import { Button, cx } from "@/design";
import { buildUndo } from "../actions";
import { ActionList, Disclosure, Sheet, closeSheetThen, type ActionItem } from "../common";
import { shortTime } from "../drinks";
import { formatTime } from "../format";
import { useDrinkActions } from "../health/Drinks";
import { getSetting, setSetting, useSetting } from "../localSettings";
import { evaluateLots } from "../lots";
import { mealInstant, proposedMealTime } from "../meal/mealTarget";
import { eatOrder } from "../meal/plate";
import { lastMealOf } from "../meal/usual";
import { buildRepeatMeal } from "../mealEdit";
import {
  MEAL_KIND_LABELS,
  buildMealDeclaration,
  buildOutOfHomeMeal,
  isOutOfHomeItem,
  momentOffer,
  momentTitle,
  momentsOf,
  outOfHomeChoices,
  type DeclarableKind,
  type OutOfHomeChoice,
} from "../meals";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { mealsWithPantryOf } from "./dayRows";
import { DrinkLines } from "./DrinkLines";
import { OTHER_VERSION_NOTE, isCompactMoment, mealSheetTitle, momentChoices, repeatableNames, revivedMealText, snackBlockTitle } from "./editText";
import { EntrySheet, type EntryTarget } from "./EntrySheet";
import { EntryRow, LooseLine, freeItemLine, type DayIntakeLookup } from "./MealLines";
import { MealSheet } from "./MealSheet";
import { PlannedLines } from "./PlannedLines";
import { nextPlannedHidden } from "./plannedMoment";
import type { TodayPlan } from "./useTodayPlan";
import { inSentence, mealSummary } from "./summaries";
import { useRemove } from "./useRemove";
import entries from "./MealEntries.module.css";
import styles from "./Today.module.css";

interface Props {
  /** Giorno di calendario a cui si riferiscono le righe (`YYYY-MM-DD`). */
  date: string;
  /** Oggi, `YYYY-MM-DD`. */
  today: string;
  /** Istante corrente: decide quali momenti compaiono e quale parte aperto. */
  now: string;
  diary: DiaryState;
  day: DiaryDay | undefined;
  /** Pasti registrati del giorno, in ordine di orario. */
  meals: readonly MealWithPantry[];
  /** Gli alimenti mangiati senza un pasto, nel momento della loro ora. */
  loose: Readonly<Record<MealKind, readonly ConsumeEvent[]>>;
  log: readonly AnyEvent[];
  pantry: PantryState;
  /** Ciò che il piano prevede per oggi: si legge nella riga del momento ancora vuoto. */
  planned: readonly { meal: MealKind; text: string }[];
  /** Il piano di oggi per intero: le voci sotto il momento e «Che cosa manca». Assente, il momento mostra solo il suo titolo. */
  plan?: TodayPlan;
  intake: DayIntakeLookup;
  /** Un giorno già passato: tutti i momenti compaiono. */
  pastDay: boolean;
}

const STATUS_WORD: Record<MealDeclarationStatus, string> = { skipped: "saltato", untracked: "mangiato, senza dettagli" };

/** Il foglio aperto: uno alla volta. Porta ciò che serve a ritrovare la voce nei dati di adesso, e il titolo con cui è nato. */
type OpenSheet =
  | { type: "consume"; consumeId: string; title: string }
  | { type: "item"; mealId: string; index: number; title: string }
  | { type: "meal"; mealId: string; title: string; step?: "other" };

/** I pasti tolti su un altro dispositivo che l'utente ha scelto di tenere (per `mealId`): la riga che lo dice non torna. */
const KEPT_MEALS_KEY = "today.keptMeals.v1";
const KEPT_MEALS_MAX = 200;
const NO_MEALS: readonly string[] = [];
const isIdList = (value: unknown): value is string[] => Array.isArray(value) && value.every((id) => typeof id === "string");

/**
 * «Altro» di un momento senza pasto. Come `MoreActions`, ma le voci si calcolano solo a foglio aperto: tra loro c'è la
 * stima «fuori casa», che legge i pasti degli ultimi 30 giorni e non serve finché nessuno tocca «Altro».
 */
function MomentMore({ title, items }: { title: string; items: () => ActionItem[] }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="text" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        Altro
      </Button>
      {open ? (
        <Sheet title={title} onClose={() => setOpen(false)}>
          {/* l'azione parte a foglio chiuso: l'avviso non nasce sotto il foglio */}
          <ActionList items={items().map((item) => ({ ...item, onSelect: () => closeSheetThen(() => item.onSelect?.()) }))} />
        </Sheet>
      ) : null}
    </>
  );
}

/**
 * Il giorno per momenti: colazione, pranzo, cena e gli spuntini, una voce per momento già cominciato. Un momento senza
 * pasto ha «Registra» e, dietro «Altro», «Come ieri», «Fuori casa» (tre taglie, come stima), «Saltato» e «Mangiato, senza dettagli»; se è già passato e non ha
 * niente, sta in una riga sola. Un pasto registrato è una riga richiusa che dice che cosa contiene: dentro, ogni voce è
 * una riga che si tocca (foglio «Voce») e in fondo c'è «Altro» (foglio «Pasto»). Una bevanda non vale un pasto.
 */
export function MealMoments({ date, today, now, diary, day, meals, loose, log, pantry, planned, plan, intake, pastDay }: Props) {
  const timeZone = diary.timeZone;
  const { recordWith, busy: recording } = useRecord();
  const { remove, busy: removing } = useRemove();
  const notice = useNotice();
  const drinkActions = useDrinkActions(timeZone);
  const [changing, setChanging] = useState<DeclarableKind | null>(null);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const keptMeals = useSetting(KEPT_MEALS_KEY, isIdList, NO_MEALS);
  // l'errore si legge nel momento in cui è nato
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const busy = recording || removing;
  const nowMinutes = localMoment(now, timeZone)?.minutes ?? 0;
  const current = pastDay ? undefined : momentOfMinutes(nowMinutes);
  const drinks = drinksByMoment(day, timeZone);
  const lots = new Map(pantry.lots.map((l) => [l.lotId, l]));
  const lotNames = new Map(pantry.lots.map((l) => [l.lotId, l.productRef]));
  const nameOf = (c: ConsumeEvent) => lotNames.get(c.lotId) ?? "Alimento";
  const viewingToday = date === today;
  // «Come ieri»: i pasti di ieri servono solo guardando oggi
  const yesterdayMeals = useMemo(
    // gli stessi pasti già calcolati per il diario del giorno (`mealsWithPantryOf`): il registro si rilegge una volta sola
    () => (viewingToday ? mealsWithPantryOf(diary, log).filter((m) => m.date === dayBefore(today)) : []),
    [viewingToday, diary, log, today],
  );

  const errorIn = (key: string) => (text: string | null) => setProblem(text ? { key, text } : null);
  const errorLine = (key: string) =>
    problem?.key === key ? (
      <p className={ui.error} role="alert">
        {problem.text}
      </p>
    ) : null;

  async function declare(kind: DeclarableKind, status: MealDeclarationStatus) {
    setProblem(null);
    const result = await recordWith((deviceId) => buildMealDeclaration(date, kind, status, { now: new Date().toISOString(), deviceId }));
    if (result.ok) setChanging(null);
    else errorIn(kind)(result.error);
  }

  /** «Come ieri»: registra subito, in questo momento, ciò che c'era nel pasto di ieri. */
  async function repeatYesterday(kind: DeclarableKind, meal: MealWithPantry) {
    setProblem(null);
    const result = await recordWith((deviceId) => {
      const at = new Date().toISOString();
      // nell'ordine in cui si mangiano le confezioni, lo stesso di Registra pasto
      const active = eatOrder(evaluateLots(activeLots(pantry), at)).map((e) => e.lot);
      // vale anche l'ora di ieri, se oggi è già passata: una colazione ripetuta la sera non è delle 22
      const minutes = localMoment(meal.at, timeZone)?.minutes;
      const then = minutes !== undefined ? instantOfLocal(date, minutes, timeZone) : undefined;
      const mealAt = then !== undefined && Date.parse(then) <= Date.parse(at) ? then : undefined;
      const built = buildRepeatMeal({ meal, names: lotNames, lots: active, kind }, { now: at, deviceId, ...(mealAt ? { mealAt } : {}) });
      if (built.events.length === 0) throw new Error(built.message);
      return { events: built.events, message: built.message };
    });
    if (!result.ok) errorIn(kind)(result.error);
  }

  /** «Fuori casa»: registra subito il pasto come stima, nel giorno mostrato e all'ora proposta per quel momento. */
  async function recordOutOfHome(kind: DeclarableKind, choice: OutOfHomeChoice) {
    setProblem(null);
    const result = await recordWith((deviceId) => {
      const at = new Date().toISOString();
      // un giorno passato: l'ora tipica del momento; oggi: adesso, o l'ora tipica se quel momento è già passato
      const time = proposedMealTime({ kind, pastDate: pastDay ? date : null, nowMinutes: localMoment(at, timeZone)?.minutes ?? nowMinutes });
      const mealAt = mealInstant(date, time, timeZone);
      const built = buildOutOfHomeMeal({ kind, size: choice.size, estimate: choice.estimate }, { now: at, deviceId, ...(mealAt ? { mealAt } : {}) });
      return { events: built.events, message: built.message };
    });
    if (!result.ok) errorIn(kind)(result.error);
  }

  /**
   * «Tienilo»: il pasto resta com'è, e la riga che lo segnala non torna. Non scrive niente nel registro: la scelta si
   * ricorda su questo telefono, e «Annulla» sull'avviso rimette la riga.
   */
  async function keepMeal(key: string, mealId: string, title: string) {
    setProblem(null);
    const others = async () => {
      const stored = await getSetting(KEPT_MEALS_KEY);
      return isIdList(stored) ? stored.filter((id) => id !== mealId) : [];
    };
    try {
      await setSetting(KEPT_MEALS_KEY, [...(await others()), mealId].slice(-KEPT_MEALS_MAX));
      notice.show({ message: `Tenuto: ${inSentence(title)}.`, onUndo: async () => setSetting(KEPT_MEALS_KEY, await others()) });
    } catch {
      errorIn(key)("Non sono riuscito a ricordarlo. Riprova.");
    }
  }

  /**
   * Le voci di «Altro» per un momento senza pasto. Si calcolano a foglio aperto (`MomentMore`): la storia per la stima
   * «fuori casa» si legge solo allora, dai nutrienti che Oggi ha già; finché non sono pronti le tre voci non compaiono,
   * per non scrivere una stima generica dove varrebbe quella personale.
   */
  function moreItems(kind: DeclarableKind): ActionItem[] {
    // la stessa regola di Registra pasto: l'ultimo pasto di ieri in quel momento
    const last = viewingToday ? lastMealOf(yesterdayMeals, dayBefore(today), kind) : undefined;
    const repeatable = last ? { meal: last, names: repeatableNames(last, lotNames) } : undefined;
    const history = intake.energyHistory(kind, today);
    const outOfHome = history ? outOfHomeChoices(kind, history) : [];
    return momentChoices({ viewingToday, yesterdayNames: repeatable?.names ?? [], outOfHome }).map((choice) => ({
      ...choice,
      disabled: busy,
      onSelect: () => {
        if (choice.id === "skipped" || choice.id === "untracked") void declare(kind, choice.id);
        else if (choice.id === "repeat") {
          if (repeatable) void repeatYesterday(kind, repeatable.meal);
        } else {
          const picked = outOfHome.find((o) => o.id === choice.id);
          if (picked) void recordOutOfHome(kind, picked);
        }
      },
    }));
  }

  /** La voce di un foglio aperto, com'è adesso nel diario; `undefined` se nel frattempo è sparita. */
  function entryOf(open: Exclude<OpenSheet, { type: "meal" }>): EntryTarget | undefined {
    if (open.type === "consume") {
      for (const meal of meals) {
        const consume = meal.pantryConsumes.find((c) => c.id === open.consumeId);
        if (consume) {
          return { type: "pantry", consume, name: nameOf(consume), lot: lots.get(consume.lotId), line: intake.lineOf(consume.id), kind: meal.kind, mealAt: meal.at };
        }
      }
      return undefined;
    }
    const meal = meals.find((m) => m.mealId === open.mealId);
    const item = meal?.items[open.index];
    // la posizione vale solo se lì c'è ancora la stessa voce
    if (!meal || !item || item.name !== open.title) return undefined;
    return { type: "free", mealId: meal.mealId, index: open.index, item, line: freeItemLine(intake, meal.mealId, open.index), kind: meal.kind };
  }

  async function removeWith(key: string, make: Parameters<typeof remove>[0], description: string) {
    setProblem(null);
    const failure = await remove(make, description);
    if (failure) errorIn(key)(failure);
  }

  function removeDeclaration(key: string, eventId: string, description: string) {
    const event = log.find((e) => e.id === eventId);
    if (event) void removeWith(key, (deviceId, at) => buildUndo([event], { deviceId, now: at }), description);
  }

  const registerHref = (kind: DeclarableKind) => (pastDay ? `/app/pasto?momento=${kind}&giorno=${date}` : `/app/pasto?momento=${kind}`);

  function renderMeal(meal: MealWithPantry, key: string) {
    const label = MEAL_KIND_LABELS[meal.kind];
    const title = meal.title ?? label;
    const summary = mealSummary({
      time: shortTime(meal.at, timeZone),
      ...(meal.title ? { moment: label.toLowerCase() } : {}),
      names: [...meal.pantryConsumes.map(nameOf), ...meal.items.map((i) => i.name)],
      energy: intake.mealOf(meal.mealId)?.totals.energyKcal,
    });
    // un pasto tolto su un altro dispositivo a cui è rimasta una voce: lo si dice finché l'utente non sceglie
    const revived = meal.revived === true && keptMeals.ready && !keptMeals.value.includes(meal.mealId);
    return (
      <div key={meal.mealId} id={`voce-${meal.eventId}`} className={entries.mealAnchor}>
        <Disclosure title={title} summary={summary} defaultOpen={meal.kind === current}>
          <ul className={entries.entries}>
            {meal.pantryConsumes.map((c) => (
              <EntryRow
                key={c.id}
                id={`voce-${c.id}`}
                name={nameOf(c)}
                quantity={c.quantity}
                certainty={c.certainty}
                line={intake.lineOf(c.id)}
                onOpen={() => setSheet({ type: "consume", consumeId: c.id, title: nameOf(c) })}
              />
            ))}
            {meal.items.map((i, index) => (
              <EntryRow
                key={`${i.name}-${index}`}
                id={`voce-${meal.eventId}-${index}`}
                name={i.name}
                quantity={i.quantity}
                certainty={i.certainty}
                line={freeItemLine(intake, meal.mealId, index)}
                withoutAmount={isOutOfHomeItem(i)}
                onOpen={() => setSheet({ type: "item", mealId: meal.mealId, index, title: i.name })}
              />
            ))}
          </ul>
          {meal.removedLines ? (
            <p className={styles.note}>
              {meal.removedLines === 1 ? "Una voce è stata tolta dalla dispensa." : `${meal.removedLines} voci sono state tolte dalla dispensa.`}
            </p>
          ) : null}
          <div className={entries.mealMore}>
            <Button
              variant="text"
              aria-haspopup="dialog"
              onClick={() => setSheet({ type: "meal", mealId: meal.mealId, title: mealSheetTitle(title, shortTime(meal.at, timeZone)) })}
            >
              Altro
            </Button>
          </div>
        </Disclosure>
        {revived ? (
          <div className={entries.mealNote}>
            <p className={entries.mealNoteText}>{revivedMealText(meal.pantryConsumes.length)}</p>
            <div className={entries.mealNoteActions}>
              <Button variant="text" disabled={busy} onClick={() => void keepMeal(key, meal.mealId, title)}>
                Tienilo
              </Button>
              <Button
                variant="text"
                disabled={busy}
                // l'evento mostrato è già annullato: il pasto si toglie per `mealId`, annullando la voce rimasta
                onClick={() => void removeWith(key, (deviceId, at) => voidMeal(meal.mealId, log, { deviceId, now: () => at }), inSentence(title))}
              >
                Togli il pasto
              </Button>
            </div>
          </div>
        ) : null}
        {meal.otherVersions ? (
          <button
            type="button"
            className={cx(ui.textLink, entries.mealNoteLink)}
            aria-haspopup="dialog"
            onClick={() => setSheet({ type: "meal", mealId: meal.mealId, title: mealSheetTitle(title, shortTime(meal.at, timeZone)), step: "other" })}
          >
            {OTHER_VERSION_NOTE}
          </button>
        ) : null}
      </div>
    );
  }

  const renderLoose = (c: ConsumeEvent, key: string) => (
    <LooseLine key={c.id} consume={c} name={nameOf(c)} date={date} today={today} diary={diary} log={log} line={intake.lineOf(c.id)} onError={errorIn(key)} />
  );

  const renderDrinks = (list: readonly DiaryDrink[], key: string) => (
    <DrinkLines drinks={list} date={date} now={now} actions={drinkActions} log={log} pantry={pantry} scalable={!pastDay} onError={errorIn(key)} />
  );

  /** Dentro un momento si va in ordine di ora: le bevande bevute prima del primo pasto stanno sopra i pasti, le altre sotto. */
  const aroundMeals = (list: readonly DiaryDrink[], kindMeals: readonly MealWithPantry[]) => {
    const first = kindMeals.reduce<number | undefined>((min, m) => {
      const at = Date.parse(m.at);
      return min === undefined || at < min ? at : min;
    }, undefined);
    const before = first === undefined ? [] : list.filter((d) => Date.parse(d.at) < first);
    return { before, after: before.length === 0 ? list : list.filter((d) => !before.includes(d)) };
  };

  // Il primo momento ancora nascosto che ha voci nel piano si mostra lo stesso (la cena alle 16:00), senza «Registra».
  const promoted = pastDay || !plan ? undefined : nextPlannedHidden(
    momentsOf(day).map((m) => ({ kind: m.kind, empty: m.status === "none" && drinks[m.kind].length === 0 && loose[m.kind].length === 0 })),
    planned,
    (kind) => momentOffer(kind, nowMinutes, { pastDay }),
  );
  const rows = momentsOf(day).flatMap((moment) => {
    const kindMeals = meals.filter((m) => m.kind === moment.kind);
    const kindDrinks = drinks[moment.kind];
    const kindLoose = loose[moment.kind];
    // Un momento con qualcosa dentro o dichiarato si mostra sempre; uno non ancora cominciato, no (salvo `promoted`).
    const hidden = momentOffer(moment.kind, nowMinutes, { pastDay }) === "hidden";
    if (hidden && moment.status === "none" && kindDrinks.length === 0 && kindLoose.length === 0 && moment.kind !== promoted) return [];
    const legacy = (day?.untrackedMeals ?? []).filter((u) => u.kind === moment.kind);
    return [{ moment, kindMeals, kindDrinks, kindLoose, legacy, early: hidden && moment.kind === promoted }];
  });
  const snackMeals = meals.filter((m) => m.kind === "snack");
  const snackLegacy = (day?.untrackedMeals ?? []).filter((u) => u.kind === "snack");
  const hasSnacks = snackMeals.length > 0 || drinks.offMeal.length > 0 || snackLegacy.length > 0 || loose.snack.length > 0;

  // Con un solo spuntino registrato il blocco non ha titolo, anche se intorno ci sono bevande: la riga del pasto dice
  // già «Spuntino», e «Spuntini» sopra sarebbero due titoli per una cosa.
  const snackTitle = snackMeals.length === 1 ? null : snackBlockTitle({ meals: snackMeals.length, others: drinks.offMeal.length + snackLegacy.length + loose.snack.length });
  const snackDrinks = aroundMeals(drinks.offMeal, snackMeals);

  const list =
    rows.length === 0 && !hasSnacks ? null : (
      <ul className={`${styles.list} ${styles.momentList}`}>
        {rows.map(({ moment, kindMeals, kindDrinks, kindLoose, legacy, early }) => {
          const { kind, status } = moment;
          const declared = status === "skipped" || status === "untracked";
          const recorded = status === "recorded";
          const name = MEAL_KIND_LABELS[kind].toLowerCase();
          const removeId = moment.declarationEventId ?? legacy[0]?.eventId;
          const plannedText = pastDay ? "" : planned.filter((p) => p.meal === kind).map((p) => p.text).join(", ");
          const under = plannedText === "" && kindDrinks.length === 0 && kindLoose.length === 0 ? "niente registrato" : "";
          const plannedLines = plan && status === "none" && plannedText !== "" ? <PlannedLines plan={plan} meal={kind} /> : null;
          const momentDrinks = aroundMeals(kindDrinks, kindMeals);
          const compact = isCompactMoment({
            pastDay,
            current: kind === current,
            empty: status === "none",
            drinks: kindDrinks.length,
            loose: kindLoose.length,
            planned: plannedText !== "",
          });
          if (early) {
            // non ancora cominciato: niente «Registra», solo che cosa c'è nel piano
            return (
              <li key={kind} className={cx(styles.moment, entries.momentCompact)} data-status={status}>
                <div className={entries.compact}>
                  <span className={entries.compactText}>
                    <span className={entries.compactTitle}>{MEAL_KIND_LABELS[kind]}</span> · nel piano
                  </span>
                  <span className={entries.compactActions}>
                    <MomentMore title={MEAL_KIND_LABELS[kind]} items={() => moreItems(kind)} />
                  </span>
                </div>
                {plannedLines}
                {errorLine(kind)}
              </li>
            );
          }
          if (compact) {
            return (
              <li key={kind} className={cx(styles.moment, entries.momentCompact)} data-status={status}>
                <div className={entries.compact}>
                  <span className={entries.compactText}>
                    <span className={entries.compactTitle}>{MEAL_KIND_LABELS[kind]}</span> · niente registrato
                  </span>
                  <span className={entries.compactActions}>
                    <Button href={registerHref(kind)} variant="text">
                      Registra
                    </Button>
                    <MomentMore title={MEAL_KIND_LABELS[kind]} items={() => moreItems(kind)} />
                  </span>
                </div>
                {errorLine(kind)}
              </li>
            );
          }
          return (
            <li key={kind} className={styles.moment} data-status={status}>
              {recorded ? null : (
                <div className={styles.momentHead}>
                  <div className={styles.momentText}>
                    <span className={styles.mealTitle}>{momentTitle(kind, status, kindDrinks.map((d) => d.name))}</span>
                    {status === "none" && under !== "" ? <span className={styles.note}>{under}</span> : null}
                  </div>
                  {declared ? (
                    <span className={styles.momentChoices}>
                      <Button variant="text" disabled={busy} onClick={() => setChanging(changing === kind ? null : kind)} aria-expanded={changing === kind}>
                        Cambia
                      </Button>
                      {removeId ? (
                        <Button variant="text" disabled={busy} onClick={() => removeDeclaration(kind, removeId, `${name} ${STATUS_WORD[status]}`)}>
                          Togli
                        </Button>
                      ) : null}
                    </span>
                  ) : (
                    <span className={styles.momentChoices}>
                      <Button href={registerHref(kind)} variant="outline">
                        Registra
                      </Button>
                      <MomentMore title={MEAL_KIND_LABELS[kind]} items={() => moreItems(kind)} />
                    </span>
                  )}
                </div>
              )}

              {plannedLines}

              {declared && changing === kind ? (
                <div className={styles.momentChoices} role="group" aria-label={`Cambia ${name}`}>
                  <Button href={registerHref(kind)} variant="outline">
                    Registra
                  </Button>
                  {status === "skipped" ? (
                    <Button variant="text" disabled={busy} onClick={() => void declare(kind, "untracked")}>
                      Mangiato, senza dettagli
                    </Button>
                  ) : (
                    <Button variant="text" disabled={busy} onClick={() => void declare(kind, "skipped")}>
                      Saltato
                    </Button>
                  )}
                </div>
              ) : null}

              {renderDrinks(momentDrinks.before, kind)}

              {kindMeals.map((m) => renderMeal(m, kind))}

              {kindLoose.map((c) => renderLoose(c, kind))}

              {recorded
                ? legacy.map((u) => (
                    <p key={u.eventId} className={styles.note}>
                      {MEAL_KIND_LABELS[kind]} fuori, non tracciato · {formatTime(u.at, timeZone)}{" "}
                      <Button variant="text" disabled={busy} onClick={() => removeDeclaration(kind, u.eventId, `${name} fuori`)}>
                        Togli
                      </Button>
                    </p>
                  ))
                : null}

              {renderDrinks(momentDrinks.after, kind)}

              {errorLine(kind)}
            </li>
          );
        })}

        {hasSnacks ? (
          <li className={styles.moment}>
            {snackTitle ? (
              <div className={styles.momentHead}>
                <span className={styles.mealTitle}>{snackTitle}</span>
              </div>
            ) : null}
            {renderDrinks(snackDrinks.before, "snack")}
            {snackMeals.map((m) => renderMeal(m, "snack"))}
            {loose.snack.map((c) => renderLoose(c, "snack"))}
            {snackLegacy.map((u) => (
              <p key={u.eventId} className={styles.note}>
                Spuntino fuori, non tracciato · {formatTime(u.at, timeZone)}{" "}
                <Button variant="text" disabled={busy} onClick={() => removeDeclaration("snack", u.eventId, "spuntino fuori")}>
                  Togli
                </Button>
              </p>
            ))}
            {renderDrinks(snackDrinks.after, "snack")}
            {errorLine("snack")}
          </li>
        ) : null}
      </ul>
    );

  const closeSheet = () => setSheet(null);

  return (
    <>
      {list}
      {sheet?.type === "meal" ? (
        <MealSheet
          title={sheet.title}
          meal={meals.find((m) => m.mealId === sheet.mealId)}
          initialStep={sheet.step}
          today={today}
          now={now}
          diary={diary}
          log={log}
          pantry={pantry}
          lotNames={lotNames}
          onClose={closeSheet}
        />
      ) : sheet ? (
        <EntrySheet title={sheet.title} entry={entryOf(sheet)} date={date} today={today} diary={diary} log={log} energyHistoryOf={(kind) => intake.energyHistory(kind, today)} onClose={closeSheet} />
      ) : null}
    </>
  );
}
