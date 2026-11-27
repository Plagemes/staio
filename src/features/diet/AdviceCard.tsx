"use client";

import type { ReactElement } from "react";
import type { Advice, AdviceAction, DietHistory } from "@/core/diet";
import { Button } from "@/design";
import { hrefOf } from "./actions";
import { DISMISS_LABEL, actionLabel, adviceFactText, adviceSourceText } from "./texts";
import styles from "./diet.module.css";

export interface AdviceCardProps {
  advice: Advice;
  today: string;
  history: Pick<DietHistory, "weeks">;
  /** Un'azione che non è un collegamento (aggiungere alla spesa, aprire il foglio del piano). */
  onAction: (action: AdviceAction) => void;
  onDismiss: (advice: Advice) => void;
  /** Azione in corso: i pulsanti aspettano. */
  busy?: boolean;
}

/**
 * Un consiglio: il fatto, la fonte, una o due azioni a un tocco e «Lascia così». Nessun giudizio: l'azione è
 * un'opzione, non un obbligo.
 */
export function AdviceCard({ advice, today, history, onAction, onDismiss, busy = false }: AdviceCardProps): ReactElement {
  return (
    <li className={styles.card}>
      <p className={styles.fact}>{adviceFactText(advice, { today, history })}</p>
      <p className={styles.source}>{adviceSourceText(advice)}</p>
      <div className={styles.actions}>
        {advice.actions.map((action, i) => {
          const href = hrefOf(action);
          const key = `${action.kind}:${i}`;
          return href !== undefined ? (
            <Button key={key} href={href} variant={i === 0 ? "primary" : "outline"}>
              {actionLabel(action)}
            </Button>
          ) : (
            <Button key={key} variant={i === 0 ? "primary" : "outline"} disabled={busy} onClick={() => onAction(action)}>
              {actionLabel(action)}
            </Button>
          );
        })}
        <Button variant="text" disabled={busy} onClick={() => onDismiss(advice)}>
          {DISMISS_LABEL}
        </Button>
      </div>
    </li>
  );
}
