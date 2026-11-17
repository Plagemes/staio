"use client";

// Subito dopo «Un pezzo mangiato», «Mezzo pezzo», «Mangiato»: che cosa è stato segnato e dove (momento del giorno), con
// «Cambia momento», «Annulla» e il rimando a Oggi. Resta in vista finché la scheda è aperta.
import Link from "next/link";
import type { MealKind } from "@/core/diary";
import { Button } from "@/design";
import ui from "../ui.module.css";
import { MOMENT_CHOICES, type Marked } from "./eaten";
import styles from "./LotSheet.module.css";

interface Props {
  /** Il testo dell'ultima cosa fatta: «Segnato a pranzo: 275 g di petto di pollo». */
  message: string;
  marked: Marked;
  /** `undefined` finché non si sa; `false` se per questo alimento non ci sono valori nutrizionali. */
  hasValues: boolean | undefined;
  /** Oggi, `YYYY-MM-DD`. */
  today: string;
  /** Il giorno in cui si è mangiato: ogni scelta di momento vale per quel giorno, anche se nel frattempo è passata la mezzanotte. */
  eatenDay: string;
  /** Se si è mangiato poco dopo la mezzanotte si può dire che era di ieri. */
  offerYesterday: boolean;
  yesterday: string;
  busy: boolean;
  onMove: (kind: MealKind, date: string) => void;
  onUndo: () => void;
  onOpenToday: () => void;
}

/** Lo stato dopo «Annulla»: niente più da cambiare, solo dirlo. */
export function UndoneNote({ text }: { text: string }) {
  return (
    <div className={styles.marked} role="status">
      <p className={styles.markedText}>{text}</p>
    </div>
  );
}

export function EatenPanel({ message, marked, hasValues, today, eatenDay, offerYesterday, yesterday, busy, onMove, onUndo, onOpenToday }: Props) {
  const here = (kind: MealKind, date: string) => marked.kind === kind && marked.date === date;
  return (
    <div className={styles.marked} role="status" aria-live="polite">
      <p className={styles.markedText}>{message}</p>
      <p className={ui.hint}>
        {hasValues === false
          ? "Senza valori nutrizionali: conta come mangiato, ma non nei nutrienti finché non colleghi l'alimento (qui sopra)."
          : marked.date === today
            ? "Lo trovi in Oggi e conta nei nutrienti di oggi."
            : "Lo trovi tra i pasti di quel giorno e conta nei suoi nutrienti."}
      </p>
      <div role="group" aria-label="Cambia momento">
        <p className={styles.momentLabel}>Cambia momento</p>
        <div className={styles.moments}>
          {MOMENT_CHOICES.map((m) => (
            <button key={m.kind} type="button" className={styles.momentChip} aria-pressed={here(m.kind, eatenDay)} disabled={busy} onClick={() => onMove(m.kind, eatenDay)}>
              {m.label}
            </button>
          ))}
        </div>
        {offerYesterday ? (
          <div className={styles.moments}>
            {MOMENT_CHOICES.filter((m) => m.kind !== "breakfast").map((m) => (
              <button key={m.kind} type="button" className={styles.momentChip} aria-pressed={here(m.kind, yesterday)} disabled={busy} onClick={() => onMove(m.kind, yesterday)}>
                {`Ieri · ${m.label.toLowerCase()}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <div className={ui.row}>
        <Link href={marked.date === today ? "/app" : `/app?giorno=${marked.date}`} className={ui.textLink} onClick={onOpenToday}>
          {marked.date === today ? "Vedi in Oggi" : "Vedi quel giorno"}
        </Link>
        <Button variant="text" disabled={busy} onClick={onUndo}>
          Annulla
        </Button>
      </div>
    </div>
  );
}
