"use client";

import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { archiveHabit, createHabit, type DiaryHabit } from "@/core/diary";
import { useDiary } from "@/data";
import { Button, Label } from "@/design";
import { MEAL_KIND_LABELS, itemText } from "../meals";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import styles from "./Habits.module.css";

function HabitCard({ habit }: { habit: DiaryHabit }) {
  const { record, busy } = useRecord();
  const ids = useId();
  const [mode, setMode] = useState<"view" | "rename" | "retire">("view");
  const [title, setTitle] = useState(habit.title);
  const [time, setTime] = useState(habit.usualTime ?? "");
  const [error, setError] = useState<string | null>(null);

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
    if (result.ok) {
      setMode("view");
      setError(null);
    } else setError(result.error);
  }

  async function onRetire() {
    const result = await record((o) => [archiveHabit(habit, o)], `Pasto abituale ritirato: ${habit.title}.`);
    if (result.ok) setMode("view");
    else setError(result.error);
  }

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
        <div className={ui.row}>
          <Button variant="outline" onClick={() => setMode("rename")}>
            Rinomina
          </Button>
          <Button variant="text" onClick={() => setMode("retire")}>
            Ritira
          </Button>
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
            <Button variant="text" onClick={() => setMode("view")}>
              Indietro
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "retire" ? (
        <div className={ui.callout} role="group" aria-label="Conferma">
          <p className={ui.paragraph}>
            Vuoi ritirare «{habit.title}»? Non verrà più proposto. I pasti già registrati restano dove sono.
          </p>
          <div className={ui.row}>
            <Button onClick={() => void onRetire()} disabled={busy}>
              Sì, ritira
            </Button>
            <Button variant="outline" onClick={() => setMode("view")}>
              No, tienilo
            </Button>
          </div>
          {error ? (
            <p className={ui.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function Habits() {
  const diary = useDiary();
  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Pasti abituali</h1>
        <Link href="/app/impostazioni" className={ui.textLink}>
          Impostazioni
        </Link>
      </div>
      <p className={ui.lead}>I pasti che ripeti: Staio te li propone in Oggi all&apos;ora giusta, da registrare con un tocco.</p>

      {diary.error ? <StorageError /> : null}
      {diary.loading ? <LoadingLine /> : null}
      {diary.data && diary.data.habits.length === 0 ? (
        <EmptyState
          title="Nessun pasto abituale"
          text="Quando registri un pasto, attiva «Salvalo come pasto abituale»: lo ritroverai qui, da rinominare o ritirare."
          actionLabel="Registra un pasto"
          actionHref="/app/pasto"
        />
      ) : null}
      {diary.data && diary.data.habits.length > 0 ? (
        <ul className={styles.list}>
          {diary.data.habits.map((h) => (
            <HabitCard key={h.eventId} habit={h} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
