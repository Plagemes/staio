"use client";

import Link from "next/link";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import { archiveHabit, createHabit, type DiaryHabit } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { activeLots, type Lot } from "@/core/ledger";
import { appendEvents, getDeviceId, useDiary, usePantry } from "@/data";
import { Button, Label } from "@/design";
import { MoreActions } from "../common";
import { evaluateLots } from "../lots";
import { eatOrder } from "../meal/plate";
import { MEAL_KIND_LABELS, buildMealFromHabit, itemText } from "../meals";
import { useNotice } from "../notice";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import { habitItemRows, readHabitItems, type HabitItemRow } from "./habitItems";
import styles from "./Habits.module.css";

type Mode = "view" | "rename" | "items";

/** Un pasto abituale: «Registra adesso» in vista, il resto in «Altro». `lots`: gli alimenti in ordine «da mangiare prima». */
function HabitCard({ habit, lots }: { habit: DiaryHabit; lots: readonly Lot[] | undefined }) {
  const { record, busy } = useRecord();
  const notice = useNotice();
  const ids = useId();
  const [mode, setMode] = useState<Mode>("view");
  const [title, setTitle] = useState(habit.title);
  const [time, setTime] = useState(habit.usualTime ?? "");
  const [rows, setRows] = useState<HabitItemRow[]>([]);
  const [newName, setNewName] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const writingRef = useRef(false);

  function open(next: Mode) {
    setMode(next);
    setError(null);
    setRowErrors({});
    if (next === "rename") {
      setTitle(habit.title);
      setTime(habit.usualTime ?? "");
    }
    if (next === "items") {
      setRows(habitItemRows(habit.items));
      setNewName("");
      setNewQuantity("");
    }
  }

  /** Come il tocco in «Registra pasto»: il pasto nel suo momento, adesso. Si resta qui; l'avviso porta alla riga in Oggi. */
  async function registerNow() {
    if (!lots || writingRef.current) return;
    writingRef.current = true;
    setWriting(true);
    setError(null);
    try {
      const built = buildMealFromHabit(habit, lots, { now: new Date().toISOString(), deviceId: await getDeviceId() });
      const written = await appendEvents(built.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      const mealEventId = built.events.find((e) => e.type === "meal")?.id;
      notice.show({
        message: built.message,
        undo: built.events,
        ...(mealEventId ? { link: { label: "Vedi in Oggi", href: `/app?voce=${encodeURIComponent(mealEventId)}` } } : {}),
      });
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      writingRef.current = false;
      setWriting(false);
    }
  }

  async function onRename(event: FormEvent) {
    event.preventDefault();
    const clean = title.trim();
    if (clean === "") {
      setError("Scrivi un nome.");
      return;
    }
    const result = await record(
      (o) => [createHabit({ habitId: habit.habitId, title: clean, kind: habit.kind, usualTime: time || undefined, items: habit.items }, o)],
      `Pasto abituale aggiornato: ${clean}.`,
    );
    if (result.ok) open("view");
    else setError(result.error);
  }

  async function onItems(event: FormEvent) {
    event.preventDefault();
    const read = readHabitItems([...rows, { name: newName, quantityText: newQuantity }]);
    if (!read.ok) {
      setRowErrors(read.errors);
      setError(read.general ?? null);
      return;
    }
    // un evento `habit` nuovo con lo stesso `habitId` prende il posto del precedente
    const result = await record(
      (o) => [createHabit({ habitId: habit.habitId, title: habit.title, kind: habit.kind, usualTime: habit.usualTime, items: read.items }, o)],
      `Pasto abituale aggiornato: ${habit.title}.`,
    );
    if (result.ok) open("view");
    else setError(result.error);
  }

  async function onRetire() {
    setError(null);
    const result = await record((o) => [archiveHabit(habit, o)], `Pasto abituale ritirato: ${habit.title}.`);
    if (!result.ok) setError(result.error);
  }

  const patchRow = (index: number, change: Partial<HabitItemRow>) => {
    setRows((list) => list.map((r, i) => (i === index ? { ...r, ...change } : r)));
    setRowErrors({});
    setError(null);
  };

  const newIndex = rows.length;

  return (
    <li className={styles.habit}>
      <div className={styles.head}>
        <span className={styles.title}>{habit.title}</span>
        <Label>
          {MEAL_KIND_LABELS[habit.kind]}
          {habit.usualTime ? ` · ${habit.usualTime}` : ""}
        </Label>
      </div>
      <p className={ui.hint}>{habit.items.map((i) => itemText(i.name, i.quantity)).join(", ")}</p>

      {mode === "view" ? (
        <div className={styles.actions}>
          <Button variant="outline" disabled={!lots || writing || busy} onClick={() => void registerNow()}>
            Registra adesso
          </Button>
          <MoreActions
            title={habit.title}
            items={[
              { id: "rename", label: "Cambia nome e ora", onSelect: () => open("rename") },
              { id: "items", label: "Cambia gli alimenti", onSelect: () => open("items") },
              { id: "retire", label: "Ritira", danger: true, onSelect: () => void onRetire() },
            ]}
          />
        </div>
      ) : null}

      {mode === "rename" ? (
        <form className={ui.form} onSubmit={onRename} noValidate>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-title`}>
              Nome
            </label>
            <input
              id={`${ids}-title`}
              className={ui.input}
              type="text"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setError(null);
              }}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
            />
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-time`}>
              Ora abituale <span className={ui.optional}>(facoltativa)</span>
            </label>
            <input id={`${ids}-time`} className={ui.input} type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            <p className={ui.hint}>Serve a proporlo all&apos;ora giusta in Oggi.</p>
          </div>
          {error ? (
            <p className={ui.error} role="alert">
              {error}
            </p>
          ) : null}
          <div className={ui.row}>
            <Button type="submit" disabled={busy}>
              Salva
            </Button>
            <Button variant="text" onClick={() => open("view")}>
              Indietro
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "items" ? (
        <form className={ui.form} onSubmit={onItems} noValidate>
          <ul className={styles.items} aria-label={`Alimenti di ${habit.title}`}>
            {rows.map((row, index) => (
              <li key={`${index}-${row.name}`} className={styles.item}>
                <div className={styles.itemLine}>
                  <span className={styles.itemName}>{row.name}</span>
                  <input
                    className={`${ui.input} ${styles.itemQuantity}`}
                    type="text"
                    value={row.quantityText}
                    onChange={(e) => patchRow(index, { quantityText: e.target.value })}
                    autoComplete="off"
                    placeholder="200 ml, 2 pz"
                    aria-label={`Quanto di ${row.name}`}
                    aria-invalid={rowErrors[index] ? true : undefined}
                  />
                  <Button
                    variant="text"
                    onClick={() => {
                      setRows((list) => list.filter((_, i) => i !== index));
                      setRowErrors({});
                      setError(null);
                    }}
                  >
                    Togli
                  </Button>
                </div>
                {rowErrors[index] ? <p className={ui.error}>{rowErrors[index]}</p> : null}
              </li>
            ))}
          </ul>
          <div className={ui.field}>
            <span className={ui.fieldLabel}>
              Aggiungi un alimento <span className={ui.optional}>(facoltativo)</span>
            </span>
            <div className={styles.newItem}>
              <input
                className={ui.input}
                type="text"
                value={newName}
                onChange={(e) => {
                  setNewName(e.target.value);
                  setRowErrors({});
                  setError(null);
                }}
                autoComplete="off"
                placeholder="Nome"
                aria-label="Nome dell'alimento da aggiungere"
              />
              <input
                className={ui.input}
                type="text"
                value={newQuantity}
                onChange={(e) => {
                  setNewQuantity(e.target.value);
                  setRowErrors({});
                  setError(null);
                }}
                autoComplete="off"
                placeholder="200 ml"
                aria-label="Quantità dell'alimento da aggiungere"
                aria-invalid={rowErrors[newIndex] ? true : undefined}
              />
            </div>
            {rowErrors[newIndex] ? <p className={ui.error}>{rowErrors[newIndex]}</p> : null}
          </div>
          {error ? (
            <p className={ui.error} role="alert">
              {error}
            </p>
          ) : null}
          <div className={ui.row}>
            <Button type="submit" disabled={busy}>
              Salva
            </Button>
            <Button variant="text" onClick={() => open("view")}>
              Indietro
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "view" && error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function Habits() {
  const diary = useDiary();
  const pantry = usePantry();
  const now = useNow();
  const timeZone = diary.data?.timeZone ?? DEFAULT_TIME_ZONE;
  // nell'ordine «da mangiare prima»: il pasto abituale scala per primo ciò che scade prima
  const lots = useMemo(
    () => (pantry.data && now ? eatOrder(evaluateLots(activeLots(pantry.data), now, timeZone)).map((e) => e.lot) : undefined),
    [pantry.data, now, timeZone],
  );

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Pasti abituali</h1>
        <Link href="/app" className={ui.textLink}>
          Torna a Oggi
        </Link>
      </div>
      <p className={ui.lead}>I pasti che ripeti. Si registrano con un tocco da qui, da “Registra pasto” e da Oggi all&apos;ora giusta.</p>

      {diary.error ? <StorageError /> : null}
      {diary.loading ? <LoadingLine /> : null}
      {diary.data && diary.data.habits.length === 0 ? (
        <EmptyState
          title="Nessun pasto abituale"
          text="Quando registri un pasto, attiva «Salvalo come pasto abituale»: lo ritroverai qui, da registrare con un tocco."
          actionLabel="Registra un pasto"
          actionHref="/app/pasto"
        />
      ) : null}
      {diary.data && diary.data.habits.length > 0 ? (
        <ul className={styles.list}>
          {diary.data.habits.map((h) => (
            <HabitCard key={h.eventId} habit={h} lots={lots} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
