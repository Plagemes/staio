import type { TimingAnalysis } from "@/core/analysis";
import { Figure, FigureGrid, Value } from "@/design";
import ui from "../ui.module.css";
import {
  basisText,
  days,
  formatClock,
  formatDuration,
  formatPercent,
  regularityText,
  reliabilityHint,
  reliabilityText,
  timingInsufficient,
} from "./present";
import { BasisLine, FreshnessNote, InsufficientBox } from "./shared";
import styles from "./analysis.module.css";

export function TimingSection({ result }: { result: TimingAnalysis }) {
  if (result.status === "insufficient") {
    return (
      <div className={styles.card}>
        <InsufficientBox view={timingInsufficient(result)} />
      </div>
    );
  }
  const { firstMeal, lastMeal, eatingWindow, lateDinner, lastCaffeine, regularity } = result;
  return (
    <div className={styles.card}>
      <FigureGrid>
        <Figure label="Finestra alimentare" suffix={`su ${days(eatingWindow.n)}`}>
          <Value>{formatDuration(eatingWindow.median)}</Value>
        </Figure>
        <Figure label="Cene tardive" suffix={`dopo le ${formatClock(lateDinner.fromMinutes)}`}>
          <Value>{lateDinner.of > 0 ? `${lateDinner.days} su ${lateDinner.of}` : "senza cena"}</Value>
        </Figure>
        <Figure label="Primo pasto" suffix="mediana">
          <Value>{formatClock(firstMeal.median)}</Value>
        </Figure>
        <Figure label="Ultimo pasto" suffix="mediana">
          <Value>{formatClock(lastMeal.median)}</Value>
        </Figure>
      </FigureGrid>
      <p className={styles.range}>
        Finestra alimentare: dal primo all&apos;ultimo pasto del giorno, mediana {formatDuration(eatingWindow.median)}, media{" "}
        {formatDuration(eatingWindow.mean)}, scarto tipico {formatDuration(eatingWindow.sd)}.
      </p>
      {lateDinner.of > 0 ? (
        <p className={styles.range}>
          Cena dopo le {formatClock(lateDinner.fromMinutes)} in {days(lateDinner.days)} su {lateDinner.of} con una cena tracciata (
          {formatPercent(lateDinner.share)}). L&apos;ora è una scelta di progetto, non una soglia medica.
        </p>
      ) : null}
      {lastCaffeine ? (
        <p className={styles.range}>
          Ultima caffeina del giorno: mediana {formatClock(lastCaffeine.median)} su {days(lastCaffeine.n)} con una bevanda con caffeina registrata.
          {result.daysWithoutCaffeineRecord > 0
            ? ` Negli altri ${days(result.daysWithoutCaffeineRecord)} non risulta caffeina: può non essere stata registrata.`
            : ""}
        </p>
      ) : (
        <p className={styles.range}>Nessuna bevanda con caffeina registrata nei giorni considerati: non vuol dire che non ne sia stata bevuta.</p>
      )}
      <p className={styles.range}>
        Regolarità: primo pasto {regularityText(regularity.firstMealSdMinutes)}, ultimo pasto {regularityText(regularity.lastMealSdMinutes)}.
      </p>
      <BasisLine>{basisText(result.basis, { used: "Giorni tracciati per intero" })}</BasisLine>
      <FreshnessNote freshness={result.freshness} warnings={result.warnings} />
      <BasisLine>
        {reliabilityText(result.reliability)}. {reliabilityHint(result.reliability)}
      </BasisLine>
      <p className={ui.hint}>Gli orari sono quelli che hai scritto per i pasti, non misure.</p>
    </div>
  );
}
