"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { addDays, currentMeal, localMoment, mealsWithPantry, type DiaryHabit, type MealKind } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { activeLots } from "@/core/ledger";
import { mealEnergyHistory } from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId, useDiary, useEventLog, usePantry } from "@/data";
import { Button, SectionHeader, cx } from "@/design";
import { hasUsableKey } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import { ActionBar, MoreActions, QuantityPicker, type ActionItem, type QuantityValue } from "../common";
import { useFormEpoch } from "../common/freshForm";
import { dayOf, formatTime } from "../format";
import { useSetting } from "../localSettings";
import { evaluateLots } from "../lots";
import { buildAppendToMeal, buildRepeatMeal } from "../mealEdit";
import {
  MEAL_KIND_LABELS,
  MEAL_KIND_ORDER,
  buildMealEvents,
  buildMealFromHabit,
  buildOutOfHomeMeal,
  defaultHabitTitle,
  outOfHomeChoices,
  suggestMealKind,
  type MealPick,
  type MealResult,
  type OutOfHomeChoice,
} from "../meals";
import { useNotice } from "../notice";
import { FoodChoice } from "../nutrition/FoodChoice";
import { createFoodSearch, resolveFreeItems } from "../nutrition/candidates";
import { loadFoods, useFoods, useIntake } from "../nutrition/useNutrition";
import { normalizeSearch } from "../pantry/filter";
import { remembersPortion, type QuantityChoices } from "../pantry/quantityOptions";
import { rememberPortion } from "../pantry/usePortions";
import { PORTIONS_KEY, readPortion } from "../portions";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import styles from "./Meal.module.css";
import {
  appendTitle,
  mealDateError,
  mealInstant,
  mealTargetQuery,
  mealTimeError,
  MEAL_DAYS_BACK,
  parseMealTarget,
  pastDayText,
  proposedMealTime,
  registerTitle,
  submitLabel,
  todayEntryHref,
  usualHeading,
  whenText,
} from "./mealTarget";
import {
  addFreeItem,
  addPantryItem,
  keyName,
  missingText,
  onPlate,
  pickedFor,
  plateName,
  eatOrder,
  productRows,
  rowChoices,
  rowDetail,
  splitAmount,
  startingFrom,
  type PlateItem,
  type ProductRow,
  type SplitResult,
} from "./plate";
import { habitsFor, lastMealOf, mealFoodsText, usualFoods, withMealAt, type UsualFood } from "./usual";

/** Una voce nel piatto con ciò che serve per mostrarla e scriverla. */
interface PlateLine {
  item: PlateItem;
  /** Il nome, se manca la quantità. */
  missing: string | null;
  row?: ProductRow;
  choices?: QuantityChoices;
  amount?: QuantityValue | null;
  split?: SplitResult | null;
}

interface PageErrors {
  /** Per voce del piatto (`PlateItem.id`). */
  items: Record<number, string>;
  date?: string;
  time?: string;
  general?: string;
}

const EMPTY_MEMORY: Record<string, unknown> = {};
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/**
 * Una scrittura alla volta: un secondo tocco mentre la prima è in corso (o dopo che è riuscita, mentre si torna a Oggi)
 * non fa niente. Lo stato arriverebbe tardi: serve un valore che cambia subito.
 */
function useWriteLock(): { take: () => boolean; release: () => void } {
  const held = useRef(false);
  return useMemo(
    () => ({
      take: () => {
        if (held.current) return false;
        held.current = true;
        return true;
      },
      release: () => {
        held.current = false;
      },
    }),
    [],
  );
}

const SAVE_FAILED = "Non sono riuscito a salvare. Riprova.";
const STORAGE_FAILED = "Non sono riuscito a salvare sul telefono. Riprova.";

/**
 * La pagina resta viva tra una visita e l'altra: il modulo riparte vuoto a ogni arrivo da un collegamento, quando
 * cambiano i parametri (`?momento=`, `?giorno=`, `?pasto=`, `?lotto=`) e dopo ogni registrazione riuscita; col tasto
 * indietro si ritrova il piatto lasciato a metà.
 */
export function Meal() {
  const search = useSearchParams();
  const { epoch, renew } = useFormEpoch(search.toString());
  return <MealForm key={epoch} onSaved={renew} />;
}

function MealForm({ onSaved }: { onSaved: () => void }) {
  const pantry = usePantry();
  const diary = useDiary();
  const log = useEventLog();
  const now = useNow();
  const notice = useNotice();
  const router = useRouter();
  const search = useSearchParams();
  const ids = useId();
  const ai = useAiSettings();
  const memory = useSetting(PORTIONS_KEY, isRecord, EMPTY_MEMORY);
  const foods = useFoods();
  const foodSearch = useMemo(() => (foods ? createFoodSearch(foods) : undefined), [foods]);
  // «Fuori casa»: la stima parte dai pasti registrati; finché i nutrienti non sono calcolati le tre voci non compaiono
  const nutrition = useIntake();

  const appendId = search.get("pasto");
  const lotParam = search.get("lotto");
  const [kindEdit, setKindEdit] = useState<MealKind | null>(() => MEAL_KIND_ORDER.find((k) => k === search.get("momento")) ?? null);
  const [dateEdit, setDateEdit] = useState<string | null>(null);
  const [timeEdit, setTimeEdit] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [plate, setPlate] = useState<PlateItem[]>([]);
  /** L'alimento arrivato con `?lotto=` è già entrato nel piatto (o è stato tolto): non si rimette. */
  const [lotHandled, setLotHandled] = useState(false);
  const [nextId, setNextId] = useState(1);
  const [query, setQuery] = useState("");
  const [saveHabit, setSaveHabit] = useState(false);
  const [habitTitle, setHabitTitle] = useState<string | null>(null);
  const [errors, setErrors] = useState<PageErrors | null>(null);
  const [saving, setSaving] = useState(false);
  const lock = useWriteLock();

  const timeZone = diary.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now, timeZone) : []),
    [pantry.data, now, timeZone],
  );
  const rows = useMemo(() => productRows(entries), [entries]);
  const names = useMemo(() => new Map((pantry.data?.lots ?? []).map((l) => [l.lotId, l.productRef])), [pantry.data]);
  const meals = useMemo(() => (diary.data && log.data ? mealsWithPantry(diary.data, log.data) : []), [diary.data, log.data]);

  if (pantry.error || diary.error || (appendId && log.error)) return <StorageError />;
  if (!pantry.data || !diary.data || !now || (appendId && !log.data)) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Registra pasto</h1>
        <LoadingLine />
      </div>
    );
  }

  const today = dayOf(now, timeZone);
  const nowMinutes = localMoment(now, timeZone)?.minutes ?? 0;
  const target = appendId && log.data ? currentMeal(appendId, log.data) : undefined;

  if (appendId && !target) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Aggiungi al pasto</h1>
        <p className={ui.callout} role="status">
          Questo pasto non c&apos;è più.
        </p>
        <div>
          <Link href="/app" className={ui.textLink}>
            Torna a Oggi
          </Link>
        </div>
      </div>
    );
  }

  const append = target !== undefined;
  const kind: MealKind = target ? target.meal.kind : (kindEdit ?? suggestMealKind(now, timeZone));
  const date = target ? dayOf(target.meal.at, timeZone) : (dateEdit ?? parseMealTarget(null, search.get("giorno"), today).pastDate ?? today);
  const dateError = target ? null : mealDateError(date, today);
  const pastDate = dateError === null && date < today ? date : null;
  const time = target ? formatTime(target.meal.at, timeZone) : proposedMealTime({ kind, pastDate, nowMinutes, typed: timeEdit });
  const timeError = target ? null : mealTimeError(time, date === today, nowMinutes);

  // il piatto: con `?lotto=` l'alimento della scheda è già dentro, con la quantità proposta (mai «Tutto»)
  const rowByKey = new Map(rows.map((r) => [r.key, r]));
  const lotRow = !lotHandled && lotParam ? rows.find((r) => r.entries.some((e) => e.lot.lotId === lotParam)) : undefined;
  const items = lotRow ? addPantryItem(plate, lotRow.key, 0, undefined, lotParam ?? undefined) : plate;
  const visible = items.filter((i) => i.kind === "free" || rowByKey.has(i.key));

  const usualOf = (row: ProductRow) => (memory.ready ? readPortion(memory.value, row.name, row.unit) : undefined);
  const lines = visible.map((item): PlateLine => {
    if (item.kind === "free") return { item, missing: item.quantityText.trim() === "" ? item.name : null };
    const row = startingFrom(rowByKey.get(item.key) as ProductRow, item.firstLotId);
    const choices = rowChoices(row, usualOf(row));
    const amount = item.picked === undefined ? choices.initial : item.picked;
    const split = amount ? splitAmount(row, amount) : null;
    return { item, row, choices, amount, split, missing: amount ? null : row.name };
  });
  const count = visible.length;
  const missing = lines.flatMap((l) => (l.missing ? [l.missing] : []));
  const blocked = missing.length > 0 || lines.some((l) => l.split?.ok === false);

  const yesterdayMeal = !append && pastDate === null && dateError === null ? lastMealOf(meals, addDays(today, -1), kind) : undefined;
  const habits = !append ? habitsFor(diary.data.habits, kind) : { shown: [], more: false };
  const usual = usualFoods({
    meals,
    names,
    kind,
    today,
    memory: memory.ready ? memory.value : undefined,
    pantryNames: rows.map((r) => r.name),
    exclude: visible.map(plateName),
  });
  const words = normalizeSearch(query).split(" ").filter(Boolean);
  const onPlateKeys = new Set(visible.flatMap((i) => (i.kind === "pantry" ? [i.key] : [])));
  const pantryShown = rows.filter((r) => !onPlateKeys.has(r.key) && !visible.some((i) => i.kind === "free" && plateName(i) === keyName(r.key)) && words.every((w) => normalizeSearch(r.name).includes(w)));
  const freeOffer = query.trim() !== "" && !onPlate(visible, query) ? query.trim().replace(/\s+/g, " ") : null;
  const effectiveHabitTitle = habitTitle ?? defaultHabitTitle(kind);
  const aiReady = ai.ready && hasUsableKey(ai.settings);

  /** Ogni cambio del piatto parte da quello in vista (con l'alimento di `?lotto=`, se c'è). */
  function commit(next: PlateItem[]) {
    setPlate(next);
    setLotHandled(true);
    setErrors(null);
  }
  function takeId(): number {
    setNextId((n) => n + 1);
    return nextId;
  }

  function addRow(row: ProductRow) {
    commit(addPantryItem(items, row.key, takeId()));
    if (query !== "") setQuery("");
  }

  function addFree(name: string) {
    commit(addFreeItem(items, name, "", takeId()));
    setQuery("");
  }

  function addUsual(food: UsualFood) {
    const row = rows.find((r) => keyName(r.key) === normalizeSearch(food.name));
    if (row) commit(addPantryItem(items, row.key, takeId(), pickedFor(row, rowChoices(row, usualOf(row)), food.quantity)));
    else commit(addFreeItem(items, food.name, food.quantity ? formatQuantity(food.quantity) : "", takeId()));
  }

  function patchItem(id: number, change: Partial<Extract<PlateItem, { kind: "free" }>> | { picked: QuantityValue | null }) {
    commit(items.map((i) => (i.id === id ? ({ ...i, ...change } as PlateItem) : i)));
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    if (pantryShown.length === 1) addRow(pantryShown[0]);
    else if (pantryShown.length === 0 && freeOffer) addFree(freeOffer);
  }

  const begin = (): boolean => {
    if (!lock.take()) return false;
    setSaving(true);
    setErrors(null);
    return true;
  };
  const fail = (general: string, more: Partial<PageErrors> = {}) => {
    lock.release();
    setSaving(false);
    setErrors({ items: {}, ...more, general });
  };

  /** Scrive, porta a Oggi sulla riga nuova e mostra l'avviso con «Annulla». */
  async function writeAndGo(events: AnyEvent[], message: string, back: string | null, voce: string | undefined): Promise<boolean> {
    const written = await appendEvents(events);
    if (written.added === 0 || written.rejected.length > 0) {
      fail(SAVE_FAILED);
      return false;
    }
    notice.show({ message, undo: events });
    onSaved();
    router.push(todayEntryHref(back, voce));
    return true;
  }

  /** L'istante del pasto all'ora in vista (o a quella del momento del pasto abituale); `undefined`: adesso. */
  function instantFor(forKind: MealKind): string | undefined {
    if (dateError !== null) return undefined;
    const at = forKind === kind && timeError === null ? time : proposedMealTime({ kind: forKind, pastDate, nowMinutes, typed: null });
    return mealInstant(date, at, timeZone);
  }

  async function registerHabit(habit: DiaryHabit) {
    if (dateError !== null) {
      setEditing(true);
      setErrors({ items: {}, date: dateError });
      return;
    }
    if (!begin()) return;
    try {
      // nell'ordine «da mangiare prima»: il pasto abituale scala per primo ciò che scade prima
      const built = buildMealFromHabit(habit, eatOrder(entries).map((e) => e.lot), { now: new Date().toISOString(), deviceId: await getDeviceId() });
      const events = withMealAt(built.events, instantFor(habit.kind));
      await writeAndGo(events, built.message, pastDate, events.find((e) => e.type === "meal")?.id);
    } catch {
      fail(STORAGE_FAILED);
    }
  }

  /** «Fuori casa»: registra subito il pasto come stima, per il momento, il giorno e l'ora in vista. */
  async function registerOutOfHome(choice: OutOfHomeChoice) {
    if (dateError !== null || timeError !== null) {
      setEditing(true);
      setErrors({ items: {}, ...(dateError ? { date: dateError } : {}), ...(timeError ? { time: timeError } : {}) });
      return;
    }
    if (!begin()) return;
    try {
      const mealAt = mealInstant(date, time, timeZone);
      const built = buildOutOfHomeMeal(
        { kind, size: choice.size, estimate: choice.estimate },
        { now: new Date().toISOString(), deviceId: await getDeviceId(), ...(mealAt ? { mealAt } : {}) },
      );
      await writeAndGo(built.events, built.message, pastDate, built.events.find((e) => e.type === "meal")?.id);
    } catch {
      fail(STORAGE_FAILED);
    }
  }

  async function repeatYesterday() {
    if (!yesterdayMeal || !begin()) return;
    try {
      const mealAt = instantFor(kind);
      const built = buildRepeatMeal(
        { meal: yesterdayMeal, names, lots: eatOrder(entries).map((e) => e.lot), kind },
        { now: new Date().toISOString(), deviceId: await getDeviceId(), ...(mealAt ? { mealAt } : {}) },
      );
      if (built.events.length === 0) {
        fail(built.message);
        return;
      }
      await writeAndGo(built.events, built.message, null, built.events.find((e) => e.type === "meal")?.id);
    } catch {
      fail(STORAGE_FAILED);
    }
  }

  async function onSubmit() {
    if (count === 0 || blocked) return;
    if (!append && (dateError !== null || timeError !== null)) {
      setEditing(true);
      setErrors({ items: {}, ...(dateError ? { date: dateError } : {}), ...(timeError ? { time: timeError } : {}) });
      return;
    }
    if (!begin()) return;
    try {
      const picks: MealPick[] = [];
      const ownerOfLot = new Map<string, number>();
      for (const line of lines) {
        if (line.item.kind !== "pantry" || !line.split?.ok) continue;
        for (const pick of line.split.picks) {
          picks.push(pick);
          ownerOfLot.set(pick.lot.lotId, line.item.id);
        }
      }
      const freeLines = visible.filter((i): i is Extract<PlateItem, { kind: "free" }> => i.kind === "free");
      // le voci con alimenti in più stati non si aggiungono finché non si sceglie: il nome scritto non cambia
      const resolved = resolveFreeItems(freeLines, foodSearch ?? createFoodSearch(await loadFoods()));
      if (Object.keys(resolved.errors).length > 0) {
        fail("", { items: Object.fromEntries(Object.entries(resolved.errors).map(([i, e]) => [freeLines[Number(i)].id, e])) });
        return;
      }

      const ctx = { now: new Date().toISOString(), deviceId: await getDeviceId() };
      let result: MealResult;
      if (target && log.data) {
        result = buildAppendToMeal({ mealId: target.meal.mealId, picks, freeItems: resolved.items, log: log.data }, ctx);
      } else {
        const mealAt = mealInstant(date, time, timeZone);
        result = buildMealEvents(
          { kind, picks, freeItems: resolved.items, saveHabitAs: saveHabit ? effectiveHabitTitle : undefined },
          { ...ctx, ...(mealAt ? { mealAt } : {}) },
        );
      }
      if (!result.ok) {
        const byItem: Record<number, string> = {};
        for (const [lotId, e] of Object.entries(result.errors.picks)) {
          const owner = ownerOfLot.get(lotId);
          if (owner !== undefined) byItem[owner] = e;
        }
        for (const [i, e] of Object.entries(result.errors.free)) {
          const line = freeLines[Number(i)];
          if (line) byItem[line.id] = e;
        }
        fail(result.errors.general ?? "", { items: byItem });
        return;
      }

      // il pasto nuovo, o quello riscritto; se non c'è un evento `meal`, il primo consumo
      const voce = result.events.find((e) => e.type === "meal")?.id ?? result.events.find((e) => e.type === "consume")?.id;
      if (!(await writeAndGo(result.events, result.message, pastDate, voce))) return;

      // «Il solito» per la prossima volta: una per volta, perché ognuna rilegge la memoria; un errore qui non conta
      const remembered = lines.flatMap((l) => {
        if (l.item.kind !== "pantry" || !l.amount || !l.row || !remembersPortion(l.amount)) return [];
        const first = l.row.entries[0].lot;
        // «1 confezione» è una porzione solo se la confezione era intatta
        if (l.amount.optionId === "pack-one" && (first.openedAt !== undefined || first.remaining !== first.initial)) return [];
        return [{ name: l.row.name, quantity: { value: l.amount.value, unit: l.row.unit, ...(l.amount.estimated ? { estimated: true } : {}) } }];
      });
      void (async () => {
        for (const r of remembered) await rememberPortion(r.name, r.quantity, ctx.now);
      })();
    } catch {
      fail(STORAGE_FAILED);
    }
  }

  const outOfHome = !append && nutrition.ready && nutrition.intake ? outOfHomeChoices(kind, mealEnergyHistory(nutrition.intake, kind, today)) : [];
  const more: ActionItem[] = append
    ? []
    : [
        ...outOfHome.map((choice) => ({ id: choice.id, label: choice.label, hint: choice.hint, onSelect: () => void registerOutOfHome(choice) })),
        ...(yesterdayMeal
          ? [{ id: "yesterday", label: "Come ieri", hint: mealFoodsText(yesterdayMeal, names), onSelect: () => void repeatYesterday() }]
          : []),
        ...(aiReady
          ? [
              { id: "phrase", label: "Scrivi o detta", href: `/app/pasto/frase${mealTargetQuery(kind, pastDate)}` },
              { id: "photo", label: "Foto del piatto", href: `/app/pasto/foto${mealTargetQuery(kind, pastDate)}` },
            ]
          : []),
        { id: "habits", label: "Pasti abituali", href: "/app/pasti-abituali" },
      ];

  const searching = query.trim() !== "";
  const freeOfferRow = freeOffer ? (
    <li className={styles.lot}>
      <button type="button" className={styles.addFree} onClick={() => addFree(freeOffer)}>
        Aggiungi “{freeOffer}” come voce libera
      </button>
    </li>
  ) : null;

  return (
    <div className={ui.screen}>
      <div className={styles.top}>
        <div className={styles.titleBlock}>
          <div className={ui.head}>
            <h1 className={ui.title}>{append ? appendTitle(kind) : registerTitle(kind)}</h1>
            {more.length > 0 ? <MoreActions items={more} /> : null}
          </div>
          <p className={styles.when}>
            <span>{dateError === null ? whenText(date, today, time) : time}</span>
            {!append ? (
              <Button variant="text" aria-expanded={editing} onClick={() => setEditing((open) => !open)}>
                Cambia
              </Button>
            ) : null}
          </p>
        </div>

        {editing && !append ? (
          <div className={cx(ui.fields, styles.fieldStack)}>
            <fieldset className={ui.field}>
              <legend className={ui.fieldLabel}>Momento</legend>
              <div className={ui.choices}>
                {MEAL_KIND_ORDER.map((k) => (
                  <label key={k} className={ui.choice}>
                    <input type="radio" name={`${ids}-kind`} value={k} checked={kind === k} onChange={() => setKindEdit(k)} />
                    <span>{MEAL_KIND_LABELS[k]}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className={ui.field}>
              <label className={ui.fieldLabel} htmlFor={`${ids}-date`}>
                Giorno
              </label>
              <input
                id={`${ids}-date`}
                className={ui.input}
                type="date"
                value={date}
                min={addDays(today, -MEAL_DAYS_BACK)}
                max={today}
                onChange={(e) => {
                  setDateEdit(e.target.value);
                  setErrors(null);
                }}
                aria-invalid={dateError ? true : undefined}
              />
              {dateError ? <p className={ui.error}>{dateError}</p> : null}
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
                onChange={(e) => {
                  setTimeEdit(e.target.value);
                  setErrors(null);
                }}
                aria-invalid={timeError ? true : undefined}
              />
              {timeError ? <p className={ui.error}>{timeError}</p> : null}
            </div>
          </div>
        ) : null}

        {pastDate ? <p className={ui.hint}>{pastDayText(pastDate, today)}</p> : null}
      </div>

      <div className={styles.searchBlock}>
        <input
          className={ui.input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKey}
          placeholder={rows.length > 0 ? "Cerca o scrivi un alimento" : "Scrivi che cosa hai mangiato"}
          aria-label={rows.length > 0 ? "Cerca o scrivi un alimento" : "Scrivi che cosa hai mangiato"}
          autoComplete="off"
          enterKeyHint="done"
        />
        {rows.length === 0 && freeOfferRow ? <ul className={styles.lots}>{freeOfferRow}</ul> : null}
      </div>

      {count > 0 ? (
        <section className={ui.section} aria-label="Nel piatto">
          <SectionHeader label={`Nel piatto (${count})`} />
          <ul className={styles.plate}>
            {lines.map((line) => {
              const { item } = line;
              const err = errors?.items[item.id];
              if (item.kind === "free") {
                return (
                  <li key={item.id} className={styles.plateRow}>
                    <div className={styles.plateHead}>
                      <span className={styles.plateName}>{item.name}</span>
                      <Button variant="text" onClick={() => commit(items.filter((i) => i.id !== item.id))}>
                        Togli
                      </Button>
                    </div>
                    <input
                      className={ui.input}
                      type="text"
                      value={item.quantityText}
                      onChange={(e) => patchItem(item.id, { quantityText: e.target.value })}
                      autoComplete="off"
                      placeholder="1 pz, 200 g…"
                      aria-label={`Quanto di ${item.name}`}
                      aria-invalid={err ? true : undefined}
                    />
                    {foodSearch ? (
                      <FoodChoice
                        name={item.name}
                        search={foodSearch}
                        foodId={item.foodId}
                        none={item.none === true}
                        onPick={(id) => patchItem(item.id, { foodId: id, none: false })}
                        onNone={() => patchItem(item.id, { foodId: undefined, none: true })}
                        onClear={() => patchItem(item.id, { foodId: undefined, none: false })}
                      />
                    ) : null}
                    {err ? <p className={ui.error}>{err}</p> : null}
                  </li>
                );
              }
              const row = line.row as ProductRow;
              const split = line.split;
              return (
                <li key={item.id} className={styles.plateRow}>
                  <div className={styles.plateHead}>
                    <span className={styles.plateName}>
                      {row.name}
                      {row.tell ? <span className={styles.lotDetail}> · {row.tell}</span> : null}
                    </span>
                    <Button variant="text" onClick={() => commit(items.filter((i) => i.id !== item.id))}>
                      Togli
                    </Button>
                  </div>
                  <QuantityPicker
                    label="Quanto"
                    unit={row.unit}
                    options={line.choices?.options ?? []}
                    value={line.amount ?? null}
                    onChange={(value) => patchItem(item.id, { picked: value })}
                    max={row.total}
                    error={err ?? (split && !split.ok ? split.error : null)}
                  />
                  {line.amount === null ? <p className={ui.hint}>Scegli quanto</p> : null}
                  {split?.ok && split.text !== "" ? <p className={ui.hint}>{split.text}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {habits.shown.length > 0 && count === 0 && !searching ? (
        <section className={ui.section} aria-label="I tuoi pasti abituali">
          <SectionHeader label="I tuoi pasti abituali" actionLabel="Gestisci" actionHref="/app/pasti-abituali" />
          <ul className={styles.lots}>
            {habits.shown.map((habit) => (
              <li key={habit.habitId} className={styles.lot}>
                <button type="button" className={styles.habitRow} disabled={saving} onClick={() => void registerHabit(habit)}>
                  <span className={styles.lotName}>{habit.title}</span>
                  <span className={styles.lotDetail}>{habit.items.map((i) => i.name.toLowerCase()).join(", ")}</span>
                </button>
              </li>
            ))}
          </ul>
          {habits.more ? (
            <div>
              <Link href="/app/pasti-abituali" className={ui.textLink}>
                Tutti
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}

      {usual.length > 0 && !searching ? (
        <section className={ui.section} aria-label={usualHeading(kind)}>
          <SectionHeader label={usualHeading(kind)} />
          <div className={styles.chips}>
            {usual.map((food) => (
              <button key={food.name} type="button" className={styles.chip} onClick={() => addUsual(food)}>
                {food.quantity ? `${food.name} · ${formatQuantity(food.quantity, { estimated: food.quantity.estimated === true })}` : food.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {rows.length > 0 && (pantryShown.length > 0 || searching) ? (
        <section className={ui.section} aria-label="Dalla dispensa">
          <SectionHeader label="Dalla dispensa" />
          <ul className={styles.lots}>
            {pantryShown.map((row) => (
              <li key={row.key} className={styles.lot}>
                <label className={styles.lotHead}>
                  <input type="checkbox" checked={false} onChange={() => addRow(row)} />
                  <span className={styles.lotText}>
                    <span className={styles.lotName}>{row.name}</span>
                    <span className={styles.lotDetail}>{rowDetail(row)}</span>
                  </span>
                </label>
              </li>
            ))}
            {freeOfferRow}
          </ul>
        </section>
      ) : null}

      {!append ? (
        <div className={ui.field}>
          <label className={ui.switch}>
            <input type="checkbox" role="switch" checked={saveHabit} onChange={(e) => setSaveHabit(e.target.checked)} />
            <span className={ui.switchText}>
              Salvalo come pasto abituale
              <span className={ui.hint}>Lo ritrovi qui e in Oggi, da registrare con un tocco.</span>
            </span>
          </label>
          {saveHabit ? (
            <>
              <label className={ui.fieldLabel} htmlFor={`${ids}-habit`}>
                Nome del pasto abituale
              </label>
              <input
                id={`${ids}-habit`}
                className={ui.input}
                type="text"
                value={effectiveHabitTitle}
                onChange={(e) => setHabitTitle(e.target.value)}
                autoComplete="off"
              />
            </>
          ) : null}
        </div>
      ) : null}

      <ActionBar>
        <div className={styles.barStack}>
          {missing.length > 0 ? <p className={ui.hint}>{missingText(missing)}</p> : null}
          {errors?.general ? (
            <p className={ui.error} role="alert">
              {errors.general}
            </p>
          ) : null}
          <Button className={styles.barButton} disabled={saving || count === 0 || blocked} onClick={() => void onSubmit()}>
            {saving ? "Salvo…" : submitLabel(kind, count, append)}
          </Button>
        </div>
      </ActionBar>
    </div>
  );
}
