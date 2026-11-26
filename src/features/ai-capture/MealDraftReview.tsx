"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import type { MealKind } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import type { AnyEvent } from "@/core/events";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId } from "@/data";
import { Button, Label, SectionHeader } from "@/design";
import { Disclosure } from "../common";
import { buildUndo } from "../actions";
import type { PantryEntry } from "../lots";
import { mealInstant, todayHref } from "../meal/mealTarget";
import { MEAL_KIND_LABELS, MEAL_KIND_ORDER, TYPICAL_MEAL_TIME } from "../meals";
import { useNotice } from "../notice";
import { resolveFreeItems, type FoodSearch } from "../nutrition/candidates";
import { FoodChoice } from "../nutrition/FoodChoice";
import ui from "../ui.module.css";
import styles from "./AiCapture.module.css";
import { buildDraftMealEvents, certaintyWord, newFreeRow, newPantryRow, rowIssue, type DraftRow, type DraftSource } from "./mealDraft";

const NO_SEARCH: Pick<FoodSearch, "groups"> = { groups: () => [] };

interface ReviewProps {
  source: DraftSource;
  initialKind: MealKind;
  /** Il giorno passato su cui registrare (da Oggi); `null` o assente: adesso. */
  pastDate?: string | null;
  initialRows: DraftRow[];
  /** Dispensa attuale: i lotti si leggono qui al momento della conferma, non quando è partita la richiesta. */
  entries: readonly PantryEntry[];
  foodSearch: FoodSearch | undefined;
  /** Avvisi sulla lettura, mostrati sopra le righe. */
  banner: ReactNode;
  /** Cosa non si è riconosciuto o capito: ricordato sotto le righe, con la via per aggiungerlo a mano. */
  leftovers?: readonly string[];
  restartLabel: string;
  onRestart: () => void;
  /** Dove si torna se non si vuole più continuare. */
  sourceNoun: "frase" | "foto";
}

/**
 * Revisione di un pasto proposto dall'intelligenza artificiale: ogni riga si corregge o si toglie, le voci libere
 * si legano a un alimento della tabella, e solo la conferma scrive nel registro (con «Annulla»).
 */
export function MealDraftReview({ source, initialKind, pastDate = null, initialRows, entries, foodSearch, banner, leftovers = [], restartLabel, onRestart, sourceNoun }: ReviewProps) {
  const ids = useId();
  const notice = useNotice();
  const [kind, setKind] = useState<MealKind>(initialKind);
  const [timeEdit, setTimeEdit] = useState<string | null>(null);
  const mealTime = timeEdit ?? TYPICAL_MEAL_TIME[kind];
  const [rows, setRows] = useState<DraftRow[]>(initialRows);
  const [submitted, setSubmitted] = useState(false);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [general, setGeneral] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ events: AnyEvent[]; message: string; undone: boolean } | null>(null);

  const lotsById = useMemo(() => new Map(entries.map((e) => [e.lot.lotId, e.lot])), [entries]);
  const usedLots = new Set(rows.flatMap((r) => (r.lotId ? [r.lotId] : [])));
  const available = entries.filter((e) => !usedLots.has(e.lot.lotId));
  const included = rows.filter((r) => r.include);

  function patch(key: string, change: Partial<DraftRow>) {
    // cambiare il nome cambia anche la domanda sull'alimento: la scelta fatta per quello vecchio non vale
    setRows((all) => all.map((r) => (r.key === key ? { ...r, ...(change.name !== undefined ? { foodId: undefined, none: false } : {}), ...change } : r)));
    setRowErrors((e) => (e[key] ? { ...e, [key]: "" } : e));
    setGeneral(null);
  }

  async function onConfirm() {
    if (busy) return;
    setSubmitted(true);
    setGeneral(null);
    setBusy(true);
    try {
      const free = included.filter((r) => r.lotId === undefined);
      const resolved = resolveFreeItems(
        free.map((r) => ({ name: r.name, quantityText: r.amountText, ...(r.foodId ? { foodId: r.foodId } : {}), none: r.none === true })),
        foodSearch ?? NO_SEARCH,
      );
      const choiceErrors: Record<string, string> = {};
      for (const [index, message] of Object.entries(resolved.errors)) choiceErrors[free[Number(index)].key] = message;
      if (Object.keys(choiceErrors).length > 0) {
        setRowErrors(choiceErrors);
        setGeneral("Controlla le righe segnate: manca la scelta dell'alimento.");
        return;
      }
      let mealAt: string | undefined;
      if (pastDate !== null) {
        mealAt = mealInstant(pastDate, mealTime, DEFAULT_TIME_ZONE);
        if (mealAt === undefined) {
          setGeneral("Scrivi l'ora del pasto, per esempio 13:00.");
          return;
        }
      }
      const built = buildDraftMealEvents({ kind, rows, lotsById, source }, { now: new Date().toISOString(), deviceId: await getDeviceId(), ...(mealAt ? { mealAt } : {}) });
      if (!built.ok) {
        setRowErrors(built.rowErrors);
        setGeneral(built.general ?? "Controlla le righe segnate: manca qualcosa.");
        return;
      }
      const written = await appendEvents(built.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setGeneral("Non sono riuscito a salvare. Riprova.");
        return;
      }
      notice.show({ message: built.message, undo: built.events });
      setDone({ events: built.events, message: built.message, undone: false });
    } catch {
      setGeneral("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  async function onUndo() {
    if (!done || done.undone || busy) return;
    setBusy(true);
    try {
      await appendEvents(buildUndo(done.events, { now: new Date().toISOString(), deviceId: await getDeviceId() }));
      setDone({ ...done, undone: true });
    } catch {
      setGeneral("Non sono riuscito ad annullare. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <div className={ui.empty} role="status">
        <h2 className={ui.emptyTitle}>{done.undone ? "Ho annullato tutto" : "Fatto"}</h2>
        <p className={ui.emptyText}>{done.undone ? "Il registro è tornato com'era prima di questo pasto." : `${done.message} È segnato come stimato.`}</p>
        {done.undone ? null : (
          <Disclosure quiet title="Che cosa significa">
            La dispensa è stata scalata solo per le voci che hai confermato. «Annulla» toglie il pasto senza cancellare nulla.
          </Disclosure>
        )}
        {general ? (
          <p className={ui.error} role="alert">
            {general}
          </p>
        ) : null}
        <div className={ui.row}>
          {done.undone ? null : (
            <Button variant="outline" onClick={onUndo} disabled={busy}>
              Annulla
            </Button>
          )}
          <Button href={todayHref(pastDate)} variant={done.undone ? "primary" : "outline"}>
            Torna a Oggi
          </Button>
          <Button variant="text" onClick={onRestart}>
            {restartLabel}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {banner}

      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Che pasto è</legend>
        <div className={ui.choices}>
          {MEAL_KIND_ORDER.map((k) => (
            <label key={k} className={ui.choice}>
              <input type="radio" name={`${ids}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span>{MEAL_KIND_LABELS[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {pastDate ? (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-time`}>
            A che ora
          </label>
          <input id={`${ids}-time`} className={ui.input} type="time" value={mealTime} onChange={(e) => setTimeEdit(e.target.value)} />
          <p className={ui.hint}>Il pasto finisce nel giorno scelto in Oggi.</p>
          <Disclosure quiet title="Che cosa significa">
            Gli alimenti presi dalla dispensa si scalano adesso.
          </Disclosure>
        </div>
      ) : null}

      <section className={ui.section}>
        <SectionHeader label={`Voci (${rows.length})`} />
        {rows.length === 0 ? (
          <div className={ui.empty}>
            <h2 className={ui.emptyTitle}>Nessuna voce</h2>
            <p className={ui.emptyText}>Dalla {sourceNoun} non ho ricavato niente di utilizzabile. Scrivi le voci qui sotto, oppure riprova.</p>
          </div>
        ) : (
          <ul className={styles.rows}>
            {rows.map((row) => (
              <ReviewRow
                key={row.key}
                idBase={ids}
                row={row}
                lotRemaining={row.lotId ? lotsById.get(row.lotId) : undefined}
                issue={rowErrors[row.key] || (row.include && (submitted || row.amountText.trim() !== "") ? rowIssue(row, lotsById) : undefined)}
                search={foodSearch}
                onChange={(change) => patch(row.key, change)}
                onRemove={() => setRows((all) => all.filter((r) => r.key !== row.key))}
              />
            ))}
          </ul>
        )}
        {leftovers.length > 0 ? <p className={ui.hint}>Non ho saputo riconoscere: {leftovers.join("; ")}. Se serve, scrivilo come voce.</p> : null}
        <div className={ui.row}>
          <Button variant="outline" onClick={() => setRows((all) => [...all, newFreeRow()])}>
            Scrivi una voce
          </Button>
          {available.length > 0 ? (
            <select
              className={ui.input}
              aria-label="Aggiungi un alimento dalla dispensa"
              value=""
              onChange={(e) => {
                const entry = available.find((a) => a.lot.lotId === e.target.value);
                if (entry) setRows((all) => [...all, newPantryRow(entry.lot)]);
              }}
            >
              <option value="">Aggiungi dalla dispensa…</option>
              {available.map((a) => (
                <option key={a.lot.lotId} value={a.lot.lotId}>
                  {a.lot.productRef} (ne restano {formatQuantity({ value: a.lot.remaining, unit: a.lot.unit })})
                </option>
              ))}
            </select>
          ) : null}
        </div>
      </section>

      {general ? (
        <p className={ui.error} role="alert">
          {general}
        </p>
      ) : null}
      <p className={ui.hint}>Non si scrive niente finché non premi «Registra».</p>
      <Disclosure quiet title="Che cosa significa">
        Le voci non spuntate restano fuori.
      </Disclosure>
      <div className={ui.row}>
        <Button onClick={onConfirm} disabled={busy || included.length === 0}>
          {busy ? "Salvo…" : `Registra ${MEAL_KIND_LABELS[kind].toLowerCase()} (${included.length})`}
        </Button>
        <Button variant="outline" onClick={onRestart} disabled={busy}>
          Scarta e ricomincia
        </Button>
      </div>
      <Link href={todayHref(pastDate)} className={ui.textLink}>
        Torna a Oggi
      </Link>
    </>
  );
}

function ReviewRow({
  idBase,
  row,
  lotRemaining,
  issue,
  search,
  onChange,
  onRemove,
}: {
  idBase: string;
  row: DraftRow;
  lotRemaining: { remaining: number; unit: "g" | "ml" | "pz" } | undefined;
  issue: string | undefined;
  search: FoodSearch | undefined;
  onChange: (change: Partial<DraftRow>) => void;
  onRemove: () => void;
}) {
  const fromAi = row.confidence < 1;
  const isPantry = row.lotId !== undefined;
  const estimate = row.photo;
  const meta = isPantry
    ? `Dalla dispensa${lotRemaining ? ` · ne restano ${formatQuantity({ value: lotRemaining.remaining, unit: lotRemaining.unit })}` : ""}`
    : "Voce libera · non scala la dispensa · vale come stima";
  return (
    <li className={row.include ? styles.row : `${styles.row} ${styles.rowOff}`}>
      <label className={styles.rowHead}>
        <input type="checkbox" checked={row.include} onChange={(e) => onChange({ include: e.target.checked })} />
        <span className={styles.rowText}>
          <span className={styles.rowName}>{row.name.trim() === "" ? "Voce senza nome" : row.name}</span>
          <span className={styles.rowMeta}>
            {meta}
            {fromAi ? ` · certezza ${certaintyWord(row.confidence)}` : ""}
          </span>
        </span>
      </label>
      <div className={styles.fields}>
        {row.question ? (
          <p className={styles.question}>
            <strong>Domanda:</strong> c&apos;era davvero «{row.name}»? Sono poco sicuro: la metto nel pasto solo se spunti la riga.
          </p>
        ) : null}
        {estimate ? (
          <p className={styles.estimate}>
            Stima dalla foto, non una misura: tra {formatQuantity({ value: estimate.range.min, unit: estimate.unit })} e {formatQuantity({ value: estimate.range.max, unit: estimate.unit })}
            {estimate.range.derived ? " (intervallo largo, ricavato da me)" : ""}.
          </p>
        ) : null}
        <div className={styles.fieldPair}>
          {isPantry ? null : (
            <input
              id={`${idBase}-${row.key}-name`}
              className={ui.input}
              type="text"
              value={row.name}
              onChange={(e) => onChange({ name: e.target.value })}
              autoComplete="off"
              placeholder="Caffè"
              aria-label="Nome della voce"
            />
          )}
          <input
            className={ui.input}
            type="text"
            value={row.amountText}
            onChange={(e) => onChange({ amountText: e.target.value })}
            autoComplete="off"
            placeholder={lotRemaining ? (lotRemaining.unit === "pz" ? "2" : lotRemaining.unit === "ml" ? "200 ml" : "80 g") : "30 ml"}
            aria-label={`Quantità di ${row.name || "questa voce"}`}
            aria-invalid={issue ? true : undefined}
          />
        </div>
        {!isPantry && search ? (
          <FoodChoice
            name={row.name}
            search={search}
            foodId={row.foodId}
            none={row.none === true}
            onPick={(id) => onChange({ foodId: id, none: false })}
            onNone={() => onChange({ foodId: undefined, none: true })}
            onClear={() => onChange({ foodId: undefined, none: false })}
          />
        ) : null}
        {issue ? <p className={ui.error}>{issue}</p> : null}
        <div>
          <Button variant="text" onClick={onRemove}>
            Togli
          </Button>
        </div>
      </div>
    </li>
  );
}

/** Intestazione comune delle schermate con l'etichetta «Con l'intelligenza artificiale». */
export function AiHead({ title }: { title: string }) {
  return (
    <div className={ui.head}>
      <h1 className={ui.title}>{title}</h1>
      <Label>Con l&apos;intelligenza artificiale</Label>
    </div>
  );
}
