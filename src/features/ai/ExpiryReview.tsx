"use client";

import { useId, useMemo, useState } from "react";
import { buildExpiryEvents, expiryReviewRows, shortcutDate, type ExpiryChoice } from "@/core/ai/receiptExpiry";
import type { LedgerEvent, PurchaseEvent } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId } from "@/data";
import { Button, SectionHeader } from "@/design";
import { EXPIRY_SHORTCUTS } from "../barcode/expiryShortcuts";
import { dayOf, formatCalendarDate } from "../format";
import { LOCATION_LABELS } from "../labels";
import { useNow } from "../useNow";
import ui from "../ui.module.css";
import styles from "./ReceiptCapture.module.css";

/**
 * Dopo lo scontrino, una sola schermata a scorrimento per i soli deperibili appena entrati: la scadenza stimata è già
 * proposta, i tasti rapidi sono quelli della scheda del prodotto, e con «Salta» resta la stima.
 */
export function ExpiryReview({
  purchases,
  onDone,
  onWritten,
}: {
  purchases: readonly PurchaseEvent[];
  onDone: () => void;
  /** Le scadenze scritte: l'avviso e l'«Annulla» sono quelli dello scontrino, che le annulla con sé. */
  onWritten: (events: readonly LedgerEvent[]) => void;
}) {
  const ids = useId();
  const now = useNow();
  const today = now ? dayOf(now) : null;
  const rows = useMemo(() => expiryReviewRows(purchases), [purchases]);
  const [choices, setChoices] = useState<Record<string, ExpiryChoice>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (rows.length === 0) return null;
  const chosen = Object.keys(choices).length;

  function choose(lotId: string, choice: ExpiryChoice | null) {
    setChoices((all) => {
      const next = { ...all };
      if (choice) next[lotId] = choice;
      else delete next[lotId];
      return next;
    });
    setErrors((e) => ({ ...e, [lotId]: "" }));
  }

  async function onSave() {
    if (saving || chosen === 0) return;
    setSaving(true);
    setFormError(null);
    try {
      const built = buildExpiryEvents(purchases, choices, { now: new Date().toISOString(), deviceId: await getDeviceId() });
      if (!built.ok) {
        setErrors(built.errors);
        setFormError("Controlla le date segnate.");
        return;
      }
      const written = await appendEvents(built.events);
      if (written.added === 0) {
        setFormError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      onWritten(built.events);
      onDone();
    } catch {
      setFormError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={ui.section} aria-label="Scadenze dei freschi">
      <SectionHeader label={`Scadenze dei freschi (${rows.length})`} />
      <p className={ui.hint}>
        Ho stimato la scadenza dalla categoria. Per i freschi conta la data stampata: scegli un tasto o scrivila. Se va bene la stima, salta.
      </p>
      <ul className={styles.rows}>
        {rows.map((row) => {
          const choice = choices[row.lotId];
          const id = `${ids}-${row.lotId}`;
          return (
            <li key={row.lotId} className={styles.row}>
              <p className={ui.paragraph}>
                <strong>{row.name}</strong>
                <span className={ui.hint}>
                  {" "}
                  {formatQuantity(row.quantity)}, in {LOCATION_LABELS[row.location].toLowerCase()}
                </span>
              </p>
              <p className={ui.hint} role="status">
                {choice
                  ? `Scadenza: ${formatCalendarDate(choice.date)}${choice.via === "shortcut" ? " (una tua stima)" : ""}.`
                  : `Scadenza stimata: ${formatCalendarDate(row.estimate)}.`}
              </p>
              {today ? (
                <div className={styles.shortcuts}>
                  {EXPIRY_SHORTCUTS.map(([label, days]) => {
                    const date = shortcutDate(today, days);
                    const active = choice?.via === "shortcut" && choice.date === date;
                    return (
                      <button
                        key={days}
                        type="button"
                        className={styles.shortcut}
                        aria-pressed={active}
                        onClick={() => choose(row.lotId, active ? null : { date, via: "shortcut" })}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <div className={ui.field}>
                <label className={ui.fieldLabel} htmlFor={`${id}-date`}>
                  Data in etichetta
                </label>
                <input
                  id={`${id}-date`}
                  className={`${ui.input} ${styles.dateInput}`}
                  type="date"
                  value={choice?.via === "label" ? choice.date : ""}
                  onChange={(e) => choose(row.lotId, e.target.value === "" ? null : { date: e.target.value, via: "label" })}
                  aria-invalid={errors[row.lotId] ? true : undefined}
                />
                {errors[row.lotId] ? <p className={ui.error}>{errors[row.lotId]}</p> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {formError ? (
        <p className={ui.error} role="alert">
          {formError}
        </p>
      ) : null}
      <div className={ui.row}>
        <Button onClick={() => void onSave()} disabled={saving || chosen === 0}>
          {saving ? "Salvo…" : chosen === 1 ? "Salva 1 scadenza" : `Salva ${chosen} scadenze`}
        </Button>
        <Button variant="outline" onClick={onDone} disabled={saving}>
          Salta
        </Button>
      </div>
    </section>
  );
}
