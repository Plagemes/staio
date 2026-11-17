"use client";

import Link from "next/link";
import { useId, useMemo, useState, type FormEvent } from "react";
import { activeLots, type LedgerEvent } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId, usePantry } from "@/data";
import { Button, Label, LevelBar, ProgressLine, Value } from "@/design";
import { buildUndo } from "../actions";
import { LOCATION_LABELS } from "../labels";
import { levelPercent } from "../lots";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import {
  FRACTION_LABELS,
  buildRealign,
  daysSinceConfirmed,
  fractionChoices,
  lastAdjustAt,
  orderForRealign,
  type RealignAnswer,
} from "../realign";
import styles from "./Realign.module.css";

export function Realign() {
  const pantry = usePantry();
  const now = useNow();
  const ids = useId();

  const [confirmed, setConfirmed] = useState(0);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [last, setLast] = useState<LedgerEvent[] | null>(null);
  const [less, setLess] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const queue = useMemo(
    () => (pantry.data && now ? orderForRealign(activeLots(pantry.data), now).filter((l) => !skipped.includes(l.lotId)) : []),
    [pantry.data, now, skipped],
  );

  if (pantry.error) return <StorageError />;
  if (!pantry.data || !now) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Riallinea</h1>
        <LoadingLine />
      </div>
    );
  }

  const current = queue[0];
  const done = confirmed + skipped.length;
  const total = done + queue.length;

  async function answer(a: RealignAnswer) {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = buildRealign(current, a, { now: new Date().toISOString(), deviceId: await getDeviceId() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      setConfirmed((c) => c + 1);
      setLast(result.events);
      setLess(false);
      setText("");
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  async function undoLast() {
    if (!last || busy) return;
    setBusy(true);
    setError(null);
    try {
      await appendEvents(buildUndo(last, { now: new Date().toISOString(), deviceId: await getDeviceId() }));
      setConfirmed((c) => Math.max(0, c - 1));
      setLast(null);
    } catch {
      setError("Non sono riuscito ad annullare. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  function skip() {
    if (!current) return;
    setSkipped((s) => [...s, current.lotId]);
    setLess(false);
    setText("");
    setError(null);
  }

  const undoButton = last ? (
    <Button variant="text" onClick={undoLast} disabled={busy}>
      Annulla l&apos;ultima risposta
    </Button>
  ) : null;

  if (!current) {
    return (
      <div className={ui.screen}>
        <div className={ui.head}>
          <h1 className={ui.title}>Riallinea</h1>
          <Label>Fatto</Label>
        </div>
        {total === 0 ? (
          <EmptyState
            title="Niente da controllare"
            text="Le quantità sono state confermate da poco. Qui compariranno le voci stimate o non controllate da una settimana."
            actionLabel="Torna alla dispensa"
            actionHref="/app/dispensa"
          />
        ) : (
          <div className={ui.callout} role="status">
            <p className={ui.paragraph}>
              {confirmed === 0
                ? "Non hai confermato nessuna voce."
                : confirmed === 1
                  ? "Hai confermato 1 voce."
                  : `Hai confermato ${confirmed} voci.`}
              {skipped.length > 0
                ? skipped.length === 1
                  ? " Ne hai saltata 1: tornerà la prossima volta."
                  : ` Ne hai saltate ${skipped.length}: torneranno la prossima volta.`
                : ""}
            </p>
          </div>
        )}
        {error ? (
          <p className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
        <div className={ui.row}>
          <Button href="/app/dispensa">Torna alla dispensa</Button>
          {undoButton}
        </div>
      </div>
    );
  }

  const choices = fractionChoices(current);
  const adjusted = lastAdjustAt(current) !== undefined;
  const days = daysSinceConfirmed(current, now);
  const remainingText = formatQuantity({ value: current.remaining, unit: current.unit });
  const initialText = formatQuantity({ value: current.initial, unit: current.unit });
  const estimated = current.remainingCertainty === "estimated";
  const why = !adjusted && estimated ? "La quantità è una stima." : `Non è stata controllata da ${days} giorni.`;

  function onSubmitText(event: FormEvent) {
    event.preventDefault();
    void answer({ kind: "text", text });
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Riallinea</h1>
        <Label>
          {done + 1} di {total}
        </Label>
      </div>
      <ProgressLine value={done} max={total} label={`Voci controllate: ${done} su ${total}`} />

      <section className={styles.card} aria-label="Voce da controllare">
        <h2 className={styles.name}>{current.productRef}</h2>
        <p className={styles.meta}>
          {LOCATION_LABELS[current.location]} · {why}
        </p>
        <div className={styles.quantity}>
          <Label>Secondo il registro ne resta</Label>
          <span className={styles.quantityText}>
            <Value certainty={estimated ? "estimated" : "measured"}>{remainingText}</Value>
            {current.remaining < current.initial ? ` di ${initialText}` : ""}
          </span>
          <LevelBar value={levelPercent(current)} label={`Rimasto circa il ${Math.round(levelPercent(current))} per cento`} />
        </div>
      </section>

      {less ? (
        <div className={styles.answers}>
          <h3 className={ui.fieldLabel}>Quanto ne è rimasto?</h3>
          {choices.length > 0 ? (
            <div className={styles.fractions}>
              {choices.map((c) => (
                <Button key={c.fraction} variant="outline" disabled={busy} onClick={() => void answer({ kind: "fraction", fraction: c.fraction })}>
                  {FRACTION_LABELS[c.fraction]}
                  <span className={styles.fractionHint}>~{formatQuantity(c.quantity)}</span>
                </Button>
              ))}
            </div>
          ) : null}
          <form className={ui.field} onSubmit={onSubmitText} noValidate>
            <label className={ui.fieldLabel} htmlFor={`${ids}-text`}>
              Oppure scrivi quanto ne resta
            </label>
            <div className={styles.inline}>
              <input
                id={`${ids}-text`}
                className={ui.input}
                type="text"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                autoComplete="off"
                placeholder={current.unit === "pz" ? "2" : current.unit === "ml" ? "200 ml" : "200 g"}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${ids}-error` : undefined}
              />
              <Button type="submit" variant="outline" disabled={busy}>
                Aggiorna
              </Button>
            </div>
          </form>
          <Button variant="text" onClick={() => setLess(false)}>
            Indietro
          </Button>
        </div>
      ) : (
        <div className={styles.answers}>
          <Button disabled={busy} onClick={() => void answer({ kind: "same" })}>
            C&apos;è ancora, uguale
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => setLess(true)}>
            Ne è rimasto meno
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void answer({ kind: "finished" })}>
            È finito
          </Button>
        </div>
      )}

      {error ? (
        <p className={ui.error} role="alert" id={`${ids}-error`}>
          {error}
        </p>
      ) : null}

      <div className={styles.secondary}>
        <Button variant="text" onClick={skip} disabled={busy}>
          Salta questa voce
        </Button>
        {undoButton}
        <Link href="/app/dispensa" className={ui.textLink}>
          Esci
        </Link>
      </div>
    </div>
  );
}
