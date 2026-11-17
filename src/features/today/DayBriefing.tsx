"use client";

import Link from "next/link";
import { useState } from "react";
import { safeAppPath } from "@/core/notify";
import { Button, SectionHeader } from "@/design";
import ui from "../ui.module.css";
import type { BriefingView } from "./useBriefing";
import styles from "./Briefing.module.css";

/**
 * Il riepilogo del giorno, in cima a Oggi al posto dell'elenco piatto degli avvisi: al massimo tre righe per urgenza,
 * ognuna porta all'azione giusta con un tocco. Se non c'è niente da dire non compare. «Tutti gli avvisi» apre l'elenco
 * completo; la riga «da rivedere» apre qui sotto la coda, una voce per riga, con l'azione diretta e «Lascia così».
 */
export function DayBriefing({ view }: { view: BriefingView }) {
  const { briefing, dismiss } = view;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (briefing.lines.length === 0 && briefing.reviewCount === 0) return null;

  async function leave(key: string) {
    setError(null);
    try {
      await dismiss(key);
    } catch {
      setError("Non sono riuscito a ricordarlo. Riprova.");
    }
  }

  const reviewLabel = briefing.reviewCount === 1 ? "1 cosa da rivedere" : `${briefing.reviewCount} cose da rivedere`;

  return (
    <section className={ui.section} aria-label="Riepilogo del giorno">
      <SectionHeader label="Da guardare oggi" actionLabel="Tutti gli avvisi" actionHref="/app/impostazioni/avvisi" />
      <ul className={styles.list}>
        {briefing.lines.map((line) => (
          <li key={line.key} className={styles.item} data-kind={line.kind}>
            {line.kind === "review" ? (
              <button type="button" className={styles.link} aria-expanded={open} aria-controls="da-rivedere" onClick={() => setOpen(!open)}>
                <span>{line.text}</span>
              </button>
            ) : line.href.startsWith("#") ? (
              <a href={line.href} className={styles.link}>
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
      </ul>
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
    </section>
  );
}
