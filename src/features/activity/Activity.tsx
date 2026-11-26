"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { addDays, instantOfLocal } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import type { AnyEvent } from "@/core/events";
import type { PantryState } from "@/core/ledger";
import { appendEvents, derivedOf, getDeviceId, useEventLog } from "@/data";
import { Button, Label, cx } from "@/design";
import { Disclosure } from "../common";
import { dayOf, formatDayLabel, formatTime } from "../format";
import { useNotice } from "../notice";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { describeOperation, doneText, indexLog, type OperationText } from "./describe";
import { commandBlock, groupOperations, redoOperation, undoOperation, type Operation } from "./operations";
import styles from "./Activity.module.css";

const DAYS = 14;
const TZ = DEFAULT_TIME_ZONE;
const NOT_SAVED = "Non sono riuscito a salvare sul telefono. Riprova.";
/** Dopo un tocco riuscito la riga cambia comando («Annulla» diventa «Rifai») nello stesso punto: il secondo tocco di un doppio tocco non deve arrivarci. */
const SETTLE_MS = 700;
/** Se dopo una scrittura l'elenco non si aggiorna (non dovrebbe succedere), i comandi tornano comunque a rispondere. */
const STUCK_MS = 5000;

interface Row {
  op: Operation;
  said: OperationText;
  /** Perché la riga non ha il suo comando. */
  blocked?: string;
}

interface Day {
  date: string;
  label: string;
  rows: Row[];
}

interface Model {
  /** Il registro da cui l'elenco è stato costruito: «Annulla» e «Rifai» si verificano su questo. */
  events: readonly AnyEvent[];
  pantry: PantryState;
  days: Day[];
}

function dayLabel(date: string, at: string, today: string): string {
  if (date === today) return "Oggi";
  if (date === addDays(today, -1)) return "Ieri";
  return formatDayLabel(at, TZ).toLowerCase();
}

export function Activity() {
  const log = useEventLog();
  const now = useNow();
  const notice = useNotice();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  /** Il registro che c'era a schermo quando si è scritto: finché l'elenco non ne mostra uno nuovo, i comandi restano fermi. */
  const written = useRef<readonly AnyEvent[] | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    getDeviceId().then(
      (id) => {
        if (alive) setDeviceId(id);
      },
      () => {
        if (alive) setDeviceId("");
      },
    );
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
  }, []);

  const events = log.data;
  const model = useMemo<Model | undefined>(() => {
    if (!events || !now || deviceId === null) return undefined;
    const today = dayOf(now, TZ);
    const since = instantOfLocal(addDays(today, -(DAYS - 1)), 0, TZ) ?? new Date(Date.parse(now) - DAYS * 86_400_000).toISOString();
    // la dispensa già calcolata per questo stato del registro, la stessa delle altre schermate
    const pantry = derivedOf(events).pantry;
    const index = indexLog(events);
    const days: Day[] = [];
    // solo le azioni degli ultimi giorni diventano righe: il resto del registro non si descrive né si controlla
    for (const op of groupOperations(events, { since })) {
      const date = dayOf(op.at, TZ);
      let day = days[days.length - 1];
      if (!day || day.date !== date) days.push((day = { date, label: dayLabel(date, op.at, today), rows: [] }));
      const said = describeOperation(op, { pantry, ownDeviceId: deviceId, timeZone: TZ, log: index });
      const blocked = op.state === "changed" ? undefined : commandBlock(op, events, pantry, { now, timeZone: TZ });
      day.rows.push({ op, said, ...(blocked ? { blocked } : {}) });
    }
    return { events, pantry, days };
  }, [events, now, deviceId]);
  const days = model?.days;

  function release(after: number) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      written.current = null;
      lock.current = false;
      setBusy(false);
    }, after);
  }

  useEffect(() => {
    // l'elenco mostra il registro nuovo: la riga toccata ha già il suo stato di adesso
    if (written.current !== null && events !== undefined && events !== written.current) release(SETTLE_MS);
  }, [events]);

  /**
   * Una sola scrittura per tocco. Si verifica sul registro da cui la riga è stata disegnata (i suoi conti sono già
   * fatti: rileggere e rifare tutto a ogni tocco costerebbe secondi su un registro di anni), e i comandi restano fermi
   * finché l'elenco non mostra la scrittura.
   */
  async function run(row: Row, kind: "undo" | "redo") {
    if (lock.current || !model) return;
    lock.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const ctx = { deviceId: deviceId || (await getDeviceId()), now: new Date().toISOString(), timeZone: TZ };
      const result = kind === "undo" ? undoOperation(row.op, model.events, model.pantry, ctx) : redoOperation(row.op, model.events, model.pantry, ctx);
      if (!result.ok) {
        setFailure({ id: row.op.id, text: result.reason });
        release(0);
        return;
      }
      const saved = await appendEvents(result.events);
      if (saved.added !== result.events.length || saved.rejected.length > 0) {
        setFailure({ id: row.op.id, text: NOT_SAVED });
        release(0);
        return;
      }
      written.current = model.events;
      release(STUCK_MS);
      notice.show({ message: doneText(kind, row.said.text) });
    } catch {
      setFailure({ id: row.op.id, text: NOT_SAVED });
      release(0);
    }
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Ultime azioni</h1>
        <Link href="/app" className={ui.textLink}>
          Torna a Oggi
        </Link>
      </div>
      <p className={ui.lead}>Quello che hai fatto negli ultimi {DAYS} giorni.</p>
      <Disclosure title="Che cosa significa" quiet>
        Puoi annullare anche dopo ore.
      </Disclosure>

      {log.error ? <StorageError /> : null}
      {!log.error && !days ? <LoadingLine /> : null}
      {days && days.length === 0 ? (
        <EmptyState
          title="Ancora niente"
          text="Qui trovi quello che fai: registrare, aggiungere, buttare, correggere."
          actionLabel="Aggiungi alla dispensa"
          actionHref="/app/cattura"
        />
      ) : null}

      {days?.map((day) => (
        <section className={ui.section} key={day.date}>
          <h2 className={styles.day}>
            <Label>{day.label}</Label>
          </h2>
          <ul className={cx(styles.list, ui.group)}>
            {day.rows.map((row) => {
              const { op, said, blocked } = row;
              const from = said.fromOtherDevice ? " · dall'altro telefono" : "";
              const command = op.state === "active" && !blocked ? "undo" : op.state === "undone" && !blocked ? "redo" : null;
              return (
                <li className={styles.row} key={op.id}>
                  <span className={styles.time}>{formatTime(op.at, TZ)}</span>
                  <div className={styles.what}>
                    {op.state === "undone" ? (
                      <p className={ui.hint}>
                        {said.text}
                        {from} · Annullata
                      </p>
                    ) : said.href ? (
                      <Link href={said.href} className={styles.text}>
                        {said.text}
                        {from}
                      </Link>
                    ) : (
                      <p className={styles.text}>
                        {said.text}
                        {from}
                      </p>
                    )}
                    {op.state === "changed" ? <p className={ui.hint}>Corretta dopo.</p> : null}
                    {blocked ? <p className={ui.hint}>{blocked}</p> : null}
                    {failure?.id === op.id ? (
                      <p className={ui.error} role="alert">
                        {failure.text}
                      </p>
                    ) : null}
                  </div>
                  {command ? (
                    <Button variant="text" disabled={busy} aria-label={`${command === "undo" ? "Annulla" : "Rifai"}: ${said.text}`} onClick={() => void run(row, command)}>
                      {command === "undo" ? "Annulla" : "Rifai"}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
