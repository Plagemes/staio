"use client";

import { formatCost, usageForMonth } from "@/core/ai";
import type { DraftProblem } from "@/core/ai/mealPhraseShared";
import { PROVIDER_LABELS } from "../ai/providers/types";
import { activeModel, destinationHost, type AiSettings } from "../ai/settings";
import ui from "../ui.module.css";
import styles from "./AiCapture.module.css";
import type { CallInfo } from "./reads";

/** Prima di inviare: cosa parte, verso chi, con quale modello e con quale tetto di spesa. */
export function SendNotice({ settings, sends, now }: { settings: AiSettings; sends: string; now: string | null }) {
  const month = now ? usageForMonth(settings.usage, now) : null;
  return (
    <div className={ui.calloutStrong} role="note">
      <p className={ui.paragraph}>
        <strong>Prima di inviare.</strong> {sends} e la tua chiave vengono inviati a <strong>{destinationHost(settings)}</strong> ({PROVIDER_LABELS[settings.provider]}), con il modello «
        {activeModel(settings)}». Ogni richiesta ha un costo sul tuo conto presso il fornitore.
      </p>
      {month && settings.monthlyCap !== null ? (
        <p className={ui.hint}>
          Tetto del mese: {formatCost(settings.monthlyCap, settings.currency)}; finora stimati {formatCost(month.cost, settings.currency)}.
        </p>
      ) : null}
    </div>
  );
}

/** Dopo la lettura: token e costo di questa chiamata, avvisi e note dell'interprete. */
export function ReadInfo({ info, problems }: { info: CallInfo; problems: readonly DraftProblem[] }) {
  const warnings = problems.filter((p) => p.severity === "warning");
  const infos = problems.filter((p) => p.severity === "info");
  return (
    <>
      <p className={ui.hint}>
        Questa lettura: {info.usage.inputTokens.toLocaleString("it-IT")} token in ingresso, {info.usage.outputTokens.toLocaleString("it-IT")} in uscita
        {info.cost !== null ? `, costo stimato ${formatCost(info.cost, info.currency)}` : ""}.
        {info.usageEstimated ? " Il fornitore non ha indicato i token usati: ho contato una stima prudente (per eccesso), non un dato esatto." : ""}
      </p>
      {warnings.length > 0 ? (
        <div className={ui.callout}>
          <p className={ui.paragraph}>
            <strong>Da sapere</strong>
          </p>
          <ul className={ui.bullets}>
            {warnings.map((p, i) => (
              <li key={`${p.code}-${i}`} className={ui.paragraph}>
                {p.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {infos.length > 0 ? (
        <details className={styles.notes}>
          <summary>Note della lettura ({infos.length})</summary>
          <ul className={ui.bullets}>
            {infos.map((p, i) => (
              <li key={`${p.code}-${i}`} className={ui.hint}>
                {p.message}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
