"use client";

// Pezzi condivisi dalle schermate di qualità: esito di una dimensione, elenco delle dimensioni, riga delle fonti.
import { useState } from "react";
import type { Product } from "@/core/catalog";
import { OUTCOME_LABEL, type Dimension, type Outcome, type QualityAssessment, type SourceRef } from "@/core/quality";
import { Button } from "@/design";
import { RESTRICTED_WARNING_TEXT, RESTRICTED_WARNING_TITLE } from "../barcode/safetyText";
import { useNotice } from "../notice";
import { addManualEntries } from "../shopping";
import { listEntryFor } from "./listEntry";
import { OUTCOME_GLYPH, shortReason } from "./texts";
import styles from "./quality.module.css";

const USER_CARD_TEXT =
  "I codici che cominciano per 2 (e per 02 o 04) li assegna ogni negozio ai suoi articoli: la scheda che hai scritto tu può essere di un altro prodotto. Non la valuto.";

/** Avviso per la scheda trovata con un codice interno del negozio. */
export function RestrictedNotice({ fromUser = false }: { fromUser?: boolean }) {
  return (
    <div className={styles.banner} role="note">
      <strong>{RESTRICTED_WARNING_TITLE}</strong>
      <p className={styles.small}>{fromUser ? USER_CARD_TEXT : RESTRICTED_WARNING_TEXT}</p>
    </div>
  );
}

/** Esito di una dimensione: simbolo e parole, mai solo il colore. */
export function OutcomeBadge({ outcome, descriptive = false }: { outcome: Outcome; descriptive?: boolean }) {
  if (descriptive) {
    return (
      <span className={styles.badge} data-outcome="descriptive">
        solo descrittivo
      </span>
    );
  }
  return (
    <span className={styles.badge} data-outcome={outcome}>
      <span className={styles.glyph} aria-hidden="true">
        {OUTCOME_GLYPH[outcome]}
      </span>
      {OUTCOME_LABEL[outcome]}
    </span>
  );
}

function Sources({ sources }: { sources: readonly SourceRef[] }) {
  if (sources.length === 0) {
    return <p>Nessuna fonte: senza il dato (o senza una fonte per giudicarlo) non c&apos;è un esito.</p>;
  }
  return (
    <ul className={styles.sources}>
      {sources.map((s) => (
        <li key={s.url}>
          {s.body}. {s.document}.{" "}
          <a className={styles.link} href={s.url} target="_blank" rel="noopener noreferrer">
            {s.url}
          </a>
        </li>
      ))}
    </ul>
  );
}

function AdditiveDetail({ d }: { d: Extract<Dimension, { id: "additives" }> }) {
  if (d.items.length === 0) return null;
  const judged = d.items.filter((i) => i.statement);
  const others = d.items.filter((i) => !i.statement);
  return (
    <>
      {judged.length > 0 ? (
        <ul className={styles.statements}>
          {judged.map((i) => (
            <li key={i.code}>
              <span className={styles.codes}>{i.code}</span> ({i.statement?.name}): {i.statement?.text}
            </li>
          ))}
        </ul>
      ) : null}
      {others.length > 0 ? (
        <p>
          Senza un giudizio, solo presenza: <span className={styles.codes}>{others.map((i) => i.code).join(", ")}</span>.
        </p>
      ) : null}
    </>
  );
}

/** Una riga per dimensione: esito, perché in una riga, e nel dettaglio la spiegazione intera e le fonti. */
export function DimensionList({ assessment }: { assessment: QualityAssessment }) {
  return (
    <ul className={styles.list}>
      {assessment.dimensions.map((d) => (
        <li key={d.id} className={styles.dim}>
          <div className={styles.dimHead}>
            <span className={styles.dimLabel}>{d.label}</span>
            <OutcomeBadge outcome={d.outcome} descriptive={d.kind === "descriptive"} />
          </div>
          <p className={styles.dimReason}>{shortReason(d)}</p>
          <details className={styles.more}>
            <summary>Perché e fonte</summary>
            <p>{d.explanation}</p>
            {d.id === "additives" ? <AdditiveDetail d={d} /> : null}
            {d.kind === "descriptive" ? <p>Nessun giudizio: sono solo valori calcolati dal prodotto.</p> : <Sources sources={d.sources} />}
          </details>
        </li>
      ))}
    </ul>
  );
}

/** Dimensioni in forma compatta, una per riga di chip: etichetta ed esito a parole. */
export function DimensionChips({ assessment }: { assessment: QualityAssessment }) {
  return (
    <ul className={styles.chips} aria-label="Esito di ogni dimensione">
      {assessment.dimensions
        .filter((d) => d.kind === "graded")
        .map((d) => (
          <li key={d.id} className={styles.chip}>
            <span>{d.label.replace(" (NOVA)", "").replace("Grado di lavorazione", "Lavorazione")}:</span>
            <OutcomeBadge outcome={d.outcome} />
          </li>
        ))}
    </ul>
  );
}

/** Aggiunge il prodotto alla lista della spesa (una confezione), con «Annulla». */
export function AddToListButton({ product, label = "Aggiungi alla spesa", variant = "outline" }: { product: Product; label?: string; variant?: "primary" | "outline" | "text" }) {
  const notice = useNotice();
  const [busy, setBusy] = useState(false);

  async function add() {
    setBusy(true);
    try {
      const entry = listEntryFor(product);
      const result = await addManualEntries([entry]);
      notice.show({ message: `${entry.product}: aggiunto alla lista della spesa (1 confezione).`, onUndo: result.undo });
    } catch {
      notice.show({ message: "Non sono riuscito ad aggiungere alla lista della spesa. Riprova." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button variant={variant} onClick={() => void add()} disabled={busy}>
      {label}
    </Button>
  );
}
