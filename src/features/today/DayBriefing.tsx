"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { safeAppPath } from "@/core/notify";
import { Button, SectionHeader } from "@/design";
import { CatchUpSheet } from "../catchup/CatchUpSheet";
import { catchUpLineText } from "../catchup/catchupText";
import { useCatchUp } from "../catchup/useCatchUp";
import ui from "../ui.module.css";
import type { BriefingView } from "./useBriefing";
import styles from "./Briefing.module.css";

interface Props {
  view: BriefingView;
  /** Voci nella lista della spesa: una riga in coda, se ce ne sono. */
  shoppingCount: number;
  /** Pasti del piano non fatti: una riga in coda che apre `missed` sotto l'elenco. */
  missedCount: number;
  /** L'elenco dei pasti del piano non fatti, con le sue azioni; il suo contenitore ha l'id `MISSED_ID`. */
  missed: ReactNode;
  /** La riga dell'acqua porta alla riga «Acqua» del diario, che è richiusa: la apre la schermata. */
  onShowWater: () => void;
}

export const MISSED_ID = "piano-non-fatti";
const WATER_HREF = "#acqua";

/**
 * «Da guardare oggi», sotto «Adesso»: al massimo tre righe per urgenza, ognuna porta all'azione giusta con un tocco,
 * più la lista della spesa e i pasti del piano non fatti. Se non c'è niente da dire non compare. «Tutti gli avvisi»
 * apre l'elenco completo; «da rivedere» e «Nel piano, non fatti» aprono qui sotto il loro elenco. In testa, fuori dal
 * tetto di tre righe, «Mettiamoci in pari» quando ci sono giorni passati senza niente nel diario: apre il suo foglio.
 */
export function DayBriefing({ view, shoppingCount, missedCount, missed, onShowWater }: Props) {
  const { briefing, dismiss } = view;
  const [open, setOpen] = useState(false);
  const [missedOpen, setMissedOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const catchUpDays = useCatchUp();
  // i giorni restano quelli del tocco: dopo «Salva» la riga sparisce, ma il foglio si chiude da sé
  const [catchUpOpen, setCatchUpOpen] = useState<readonly string[] | null>(null);
  const catchUpSheet = catchUpOpen ? <CatchUpSheet days={catchUpOpen} onClose={() => setCatchUpOpen(null)} /> : null;
  const catchUpRow = catchUpDays.length > 0;
  // il foglio sta sempre nella stessa posizione: se la sezione sparisce mentre è aperto, non si rimonta
  if (!catchUpRow && briefing.lines.length === 0 && briefing.reviewCount === 0 && shoppingCount === 0 && missedCount === 0) {
    return (
      <>
        {null}
        {catchUpSheet}
      </>
    );
  }

  async function leave(key: string) {
    setError(null);
    try {
      await dismiss(key);
    } catch {
      setError("Non sono riuscito a ricordarlo. Riprova.");
    }
  }

  const reviewLabel = briefing.reviewCount === 1 ? "1 cosa da rivedere" : `${briefing.reviewCount} cose da rivedere`;
  const hasRows = catchUpRow || briefing.lines.length > 0 || shoppingCount > 0 || missedCount > 0;

  return (
    <>
      <section className={ui.section} aria-label="Riepilogo del giorno">
        <SectionHeader label="Da guardare oggi" actionLabel="Tutti gli avvisi" actionHref="/app/impostazioni/avvisi" />
        {hasRows ? (
          <ul className={styles.list}>
            {catchUpRow ? (
              <li className={styles.item} data-kind="catchup">
                <button type="button" className={styles.link} aria-haspopup="dialog" onClick={() => setCatchUpOpen(catchUpDays)}>
                  <span>{catchUpLineText(catchUpDays.length)}</span>
                </button>
              </li>
            ) : null}
            {briefing.lines.map((line) => (
              <li key={line.key} className={styles.item} data-kind={line.kind}>
                {line.kind === "review" ? (
                  <button type="button" className={styles.link} aria-expanded={open} aria-controls="da-rivedere" onClick={() => setOpen(!open)}>
                    <span>{line.text}</span>
                  </button>
                ) : line.href.startsWith("#") ? (
                  <a
                    href={line.href}
                    className={styles.link}
                    onClick={(event) => {
                      if (line.href !== WATER_HREF) return;
                      event.preventDefault();
                      onShowWater();
                    }}
                  >
                    <span>{line.text}</span>
                    {line.certainty === "estimated" ? <span className={styles.estimate}>stima</span> : null}
                  </a>
                ) : (
                  <Link href={safeAppPath(line.href)} className={styles.link}>
                    <span>{line.text}</span>
                    {line.certainty === "estimated" ? <span className={styles.estimate}>stima</span> : null}
                  </Link>
                )}
              </li>
            ))}
            {shoppingCount > 0 ? (
              <li className={styles.item} data-kind="shopping">
                <Link href="/app/spesa" className={styles.link}>
                  <span>Lista della spesa: {shoppingCount === 1 ? "1 voce" : `${shoppingCount} voci`}</span>
                </Link>
              </li>
            ) : null}
            {missedCount > 0 ? (
              <li className={styles.item} data-kind="missed">
                <button type="button" className={styles.link} aria-expanded={missedOpen} aria-controls={MISSED_ID} onClick={() => setMissedOpen(!missedOpen)}>
                  <span>Nel piano, non fatti: {missedCount}</span>
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
        {!briefing.reviewInLines && briefing.reviewCount > 0 ? (
          <div>
            <Button variant="text" aria-expanded={open} aria-controls="da-rivedere" onClick={() => setOpen(!open)}>
              {reviewLabel}
            </Button>
          </div>
        ) : null}

        {open && briefing.review.length > 0 ? (
          <div id="da-rivedere" role="group" aria-label="Da rivedere">
            {briefing.review.map((item) => (
              <div key={item.key} className={styles.reviewItem}>
                <span className={styles.reviewText}>
                  {item.text}
                  {item.certainty === "estimated" ? <span className={styles.estimate}> stima</span> : null}
                </span>
                <p className={styles.why}>{item.why}</p>
                <div className={styles.actions}>
                  <Button variant="outline" href={safeAppPath(item.href)}>
                    {item.actionLabel}
                  </Button>
                  <Button variant="text" onClick={() => void leave(item.key)}>
                    Lascia così
                  </Button>
                </div>
              </div>
            ))}
            {briefing.reviewCount > briefing.review.length ? (
              <p className={ui.hint}>e altre {briefing.reviewCount - briefing.review.length}, quando avrai sistemato queste.</p>
            ) : null}
            {error ? (
              <p className={ui.error} role="alert">
                {error}
              </p>
            ) : null}
          </div>
        ) : null}

        {missedOpen && missedCount > 0 ? <div className={styles.under}>{missed}</div> : null}
      </section>
      {catchUpSheet}
    </>
  );
}
