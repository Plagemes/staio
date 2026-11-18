"use client";

import Link from "next/link";
import { useId, useState } from "react";
import type { AnyEvent } from "@/core/events";
import { getAllEvents } from "@/data";
import { Button } from "@/design";
import { buildUndo } from "../actions";
import { Sheet } from "../common";
import ui from "../ui.module.css";
import { buildWeightCorrection, weightInputText, type BodyLine } from "./dayRows";
import { useSheetWrite } from "./DrinkLines";
import { entryElementId } from "./reveal";
import { inSentence } from "./summaries";
import { useRemove } from "./useRemove";
import styles from "./Today.module.css";

/**
 * Il contenuto della riga «Corpo»: una riga per pesata, umore, sintomo o integratore, in ordine di ora, ognuna con
 * «Togli». La pesata si tocca e si corregge nel foglio «Peso». In fondo, dove si segna una misura nuova.
 */
export function BodyRow({ lines, log }: { lines: readonly BodyLine[]; log: readonly AnyEvent[] }) {
  const { remove, busy } = useRemove();
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BodyLine | null>(null);

  async function removeLine(line: BodyLine) {
    const event = log.find((e) => e.id === line.eventId);
    if (!event) return;
    setError(null);
    const failure = await remove((deviceId, now) => buildUndo([event], { deviceId, now }), inSentence(line.text));
    if (failure) setError(failure);
  }

  return (
    <div className={styles.rowContent}>
      <ul className={styles.lines}>
        {lines.map((line) => (
          <li key={line.eventId} id={entryElementId(line.eventId)} className={styles.line}>
            {line.kind === "weight" ? (
              <button
                type="button"
                className={styles.lineTap}
                aria-haspopup="dialog"
                onClick={() => {
                  setError(null);
                  setEditing(line);
                }}
              >
                {line.time} · {line.text}
              </button>
            ) : (
              <span className={styles.lineText}>
                {line.time} · {line.text}
              </span>
            )}
            <Button variant="text" disabled={busy} onClick={() => void removeLine(line)}>
              Togli
            </Button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <div>
        <Link href="/app/salute" className={ui.textLink}>
          Segna in Salute
        </Link>
      </div>
      {editing ? <WeightSheet line={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

/** Il foglio «Peso»: il valore di adesso, da correggere. Il registro non cambia: la pesata si annulla e se ne scrive una alla stessa ora. */
function WeightSheet({ line, onClose }: { line: BodyLine; onClose: () => void }) {
  const ids = useId();
  const { write, busy } = useSheetWrite();
  const [text, setText] = useState(line.kg !== undefined ? weightInputText(line.kg) : "");
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    // il registro letto al tocco, non quello del disegno: la pesata può essere stata tolta da un altro telefono
    let events: readonly AnyEvent[];
    try {
      events = await getAllEvents();
    } catch {
      setError("Non sono riuscito a leggere i dati sul telefono. Riprova.");
      return;
    }
    let unchanged = false;
    const failure = await write(({ deviceId, now }) => {
      const r = buildWeightCorrection(events, line.eventId, text, { deviceId, now });
      if (!r.ok) return { error: r.error };
      if (r.unchanged) {
        unchanged = true;
        return { error: "" };
      }
      return { events: r.events, message: r.message };
    }, onClose);
    if (unchanged) onClose();
    else if (failure) setError(failure);
  }

  return (
    <Sheet
      title="Peso"
      onClose={onClose}
      busy={busy}
      footer={
        <Button type="submit" form={`${ids}-weight`} disabled={busy}>
          Salva
        </Button>
      }
    >
      <form
        id={`${ids}-weight`}
        className={ui.field}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className={ui.fieldLabel} htmlFor={`${ids}-kg`}>
          Peso delle {line.time}
        </label>
        <div className={styles.inline}>
          <input
            id={`${ids}-kg`}
            className={ui.input}
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${ids}-kg-error` : undefined}
          />
          <span className={styles.unit}>kg</span>
        </div>
        {error ? (
          <p className={ui.error} id={`${ids}-kg-error`} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </Sheet>
  );
}
