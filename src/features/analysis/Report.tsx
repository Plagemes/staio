"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { buildReportFor, buildSummary, customPeriod, customPeriodProblem, reportPeriod, type ReportKind, type ReportPeriod } from "@/core/analysis";
import { addDays } from "@/core/diary";
import { usePantry } from "@/data";
import { Button, SectionHeader, Tabs, Value } from "@/design";
import { formatCalendarDate } from "../format";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import { buildNutritionRows, inPeriod } from "../nutrition/prepare";
import { toEngineProfile } from "../nutrition/profile";
import { useNutritionProfile, useReferences } from "../nutrition/useNutrition";
import ui from "../ui.module.css";
import { REPORT_MIN } from "./config";
import { PrintSupport } from "./PrintSupport";
import { basisText, formatPercent, plural, reliabilityText } from "./present";
import {
  RANGE_MAX_DAYS,
  REPORT_KINDS,
  canGoNext,
  mealsText,
  noRecordsView,
  nutrientsInsufficientView,
  periodTitle,
  shiftPeriod,
  trackingText,
  partialNote,
  weightInsufficientView,
  weightReportText,
} from "./reportView";
import { AnalysisDisclaimer, BasisLine, InsufficientBox } from "./shared";
import { DishesSection, FoodFlowSection, MoodSection, PeriodComparison, WasteReport } from "./SummarySections";
import { useAnalysisBase } from "./useAnalysisBase";
import styles from "./analysis.module.css";

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

const KIND_NAMES: Record<ReportKind, { previous: string; next: string }> = {
  week: { previous: "Settimana precedente", next: "Settimana successiva" },
  month: { previous: "Mese precedente", next: "Mese successivo" },
  year: { previous: "Anno precedente", next: "Anno successivo" },
  range: { previous: "Intervallo precedente", next: "Intervallo successivo" },
};

export function Report() {
  const { diary, intakeDays, today, error, ready } = useAnalysisBase();
  const pantry = usePantry();
  const refs = useReferences();
  const { profile, ready: profileReady } = useNutritionProfile();
  const ids = useId();
  const [kind, setKind] = useState<ReportKind>("week");
  const [anchor, setAnchor] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);

  const effectiveRange = useMemo(() => range ?? (today ? { from: addDays(today, -29), to: today } : null), [range, today]);
  const problem = kind === "range" && effectiveRange ? customPeriodProblem(effectiveRange.from, effectiveRange.to) : undefined;
  const rangeProblem =
    problem === "too_long"
      ? `L'intervallo può durare al massimo ${RANGE_MAX_DAYS} giorni.`
      : problem !== undefined
        ? "Scegli due date valide, la prima non dopo la seconda."
        : undefined;

  const period = useMemo<ReportPeriod | undefined>(() => {
    if (!today) return undefined;
    if (kind === "range") {
      if (!effectiveRange || rangeProblem) return undefined;
      return customPeriod(effectiveRange.from, effectiveRange.to);
    }
    return reportPeriod(kind, anchor ?? today);
  }, [kind, anchor, today, effectiveRange, rangeProblem]);

  const report = useMemo(() => {
    if (!ready || !diary || !intakeDays || !pantry.data || !today || !period) return undefined;
    return buildReportFor(
      period,
      {
        diary,
        pantry: pantry.data,
        intakeDays,
        ...(refs && profile ? { references: refs, profile: toEngineProfile(profile, today) } : {}),
      },
      { minWeighIns: REPORT_MIN.weighIns, minCompleteDays: REPORT_MIN.completeDays, today },
    );
  }, [ready, diary, intakeDays, pantry.data, today, period, refs, profile]);

  const summary = useMemo(() => {
    if (!diary || !pantry.data || !today || !period) return undefined;
    return buildSummary(period, { diary, pantry: pantry.data }, { today });
  }, [diary, pantry.data, today, period]);

  const nutrientRows = useMemo(() => {
    if (!report?.nutrients || report.nutrients.status !== "ok" || !intakeDays) return undefined;
    return buildNutritionRows(report.nutrients.comparisons, inPeriod(intakeDays, report.period.from, report.period.to));
  }, [report, intakeDays]);

  const failed = error || Boolean(pantry.error);
  const loading = !failed && !rangeProblem && (!report || !summary || !profileReady || !period || !today);

  function changeKind(next: ReportKind) {
    setKind(next);
    if (next === "range") {
      // Si parte dall'ultimo mese, o dal periodo che si stava guardando se era più lungo di un giorno.
      if (!range && period && period.days > 1) setRange({ from: period.from, to: period.to > (today ?? period.to) ? (today ?? period.to) : period.to });
      return;
    }
    setAnchor(period && today && period.to >= today ? null : (period?.from ?? null));
  }

  function shift(direction: -1 | 1) {
    if (!period) return;
    const next = shiftPeriod(period, direction);
    if (kind === "range") setRange({ from: next.from, to: next.to });
    else setAnchor(next.from);
  }

  return (
    <div className={ui.screen}>
      <PrintSupport />
      <div className={ui.head}>
        <h1 className={ui.title}>Rapporto</h1>
        <Link href="/app/salute" className={`${ui.textLink} ${styles.noPrint}`}>
          Torna a Salute
        </Link>
      </div>
      <p className={ui.lead}>
        Ciò che hai registrato nella settimana, nel mese, nell&apos;anno o in un intervallo che scegli, sezione per sezione, ciascuna con i giorni su cui poggia. Dove non c&apos;è un dato non c&apos;è uno zero.
      </p>
      <AnalysisDisclaimer />

      {failed ? <StorageError /> : null}
      {loading ? <LoadingLine text="Preparo il rapporto…" /> : null}

      {today ? (
        <div className={`${styles.card} ${styles.noPrint}`}>
          <Tabs label="Periodo del rapporto" items={REPORT_KINDS} value={kind} onChange={(id) => changeKind(id as ReportKind)} />
          {kind === "range" && effectiveRange ? (
            <>
              <div className={styles.twoCols}>
                <div className={ui.field}>
                  <label className={ui.fieldLabel} htmlFor={`${ids}-from`}>
                    Dal
                  </label>
                  <input
                    id={`${ids}-from`}
                    className={ui.input}
                    type="date"
                    value={effectiveRange.from}
                    max={today}
                    onChange={(e) => setRange({ from: e.target.value, to: effectiveRange.to })}
                    aria-invalid={rangeProblem ? true : undefined}
                  />
                </div>
                <div className={ui.field}>
                  <label className={ui.fieldLabel} htmlFor={`${ids}-to`}>
                    Al
                  </label>
                  <input
                    id={`${ids}-to`}
                    className={ui.input}
                    type="date"
                    value={effectiveRange.to}
                    max={today}
                    onChange={(e) => setRange({ from: effectiveRange.from, to: e.target.value })}
                    aria-invalid={rangeProblem ? true : undefined}
                  />
                </div>
              </div>
              {rangeProblem ? (
                <p className={ui.error} role="alert">
                  {rangeProblem}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      {report && summary && period && today ? (
        <>
          <div className={styles.nav}>
            <button
              type="button"
              className={`${styles.navButton} ${styles.noPrint}`}
              onClick={() => shift(-1)}
              aria-label={KIND_NAMES[kind].previous}
            >
              <Chevron direction="left" />
            </button>
            <h2 className={styles.navTitle} aria-live="polite">
              {periodTitle(period)}
            </h2>
            <button
              type="button"
              className={`${styles.navButton} ${styles.noPrint}`}
              onClick={() => shift(1)}
              disabled={!canGoNext(period, today)}
              aria-label={KIND_NAMES[kind].next}
            >
              <Chevron direction="right" />
            </button>
          </div>
          <p className={styles.printOnly}>
            Dal {formatCalendarDate(period.from)} al {formatCalendarDate(period.to)}
          </p>
          {partialNote(report.period) ? <p className={ui.hint}>{partialNote(report.period)}</p> : null}
          <p className={styles.basis}>
            Giorni con qualcosa di registrato (diario o dispensa): {summary.recordedDays} su {summary.basis.periodDays}
            {summary.basis.partial ? " trascorsi" : ""}.
          </p>
          <div className={styles.noPrint}>
            <Button variant="outline" onClick={() => window.print()}>
              Stampa
            </Button>
            <p className={ui.hint}>Si stampa su foglio A4, in tema chiaro, senza la barra in basso.</p>
          </div>

          <section className={ui.section}>
            <SectionHeader label="Giorni tracciati" />
            <div className={styles.card}>
              <p className={styles.range}>{trackingText(report.tracking)}</p>
              <BasisLine>
                Tracciato per intero: {formatPercent(report.tracking.completeShare)} dei {report.tracking.basis.periodDays}{" "}
                {report.tracking.basis.partial ? "giorni trascorsi" : "giorni del periodo"}. Un giorno è completo con colazione,
                pranzo e cena tracciati.
              </BasisLine>
            </div>
          </section>

          <FoodFlowSection summary={summary} />

          <section className={ui.section}>
            <SectionHeader label="Pasti" />
            <div className={styles.card}>
              <p className={styles.range}>{mealsText(report.meals)}</p>
              <BasisLine>{basisText(report.meals.basis, { used: "Giorni completi" })}</BasisLine>
            </div>
          </section>

          <DishesSection summary={summary} />

          <section className={ui.section}>
            <SectionHeader label="Acqua" />
            <div className={styles.card}>
              {report.water.status === "ok" ? (
                <>
                  <p className={styles.range}>
                    <Value certainty={report.water.certainty}>{Math.round(report.water.averageMlPerLoggedDay)} ml</Value> in media nei giorni con acqua registrata; in
                    totale {Math.round(report.water.totalMl)} ml.
                  </p>
                  <BasisLine>
                    Registrata in {plural(report.water.daysLogged, "giorno", "giorni")} su {report.water.basis.periodDays}
                    {report.water.basis.partial ? " trascorsi" : ""}: gli altri non sono zero, sono non registrati.
                  </BasisLine>
                </>
              ) : (
                <InsufficientBox view={noRecordsView("l'acqua")} />
              )}
            </div>
          </section>

          <section className={ui.section}>
            <SectionHeader label="Peso" />
            <div className={styles.card}>
              {report.weight.status === "ok" ? (
                <>
                  {weightReportText(report.weight).map((line) => (
                    <p key={line} className={styles.range}>
                      {line}
                    </p>
                  ))}
                  <BasisLine>
                    {basisText(report.weight.basis, { used: "Giorni con una pesata", observations: { singular: "pesata", plural: "pesate" } })} · {reliabilityText(report.weight.reliability)}
                  </BasisLine>
                </>
              ) : (
                <InsufficientBox view={weightInsufficientView(report.weight)} />
              )}
            </div>
          </section>

          <MoodSection summary={summary} />

          <WasteReport summary={summary} />

          <PeriodComparison summary={summary} />

          <section className={ui.section}>
            <SectionHeader label="Nutrienti rispetto ai riferimenti" />
            <div className={styles.card}>
              {!report.nutrients ? (
                <p className={styles.range}>
                  Per confrontare con i valori di riferimento servono sesso ed età.{" "}
                  <Link href="/app/impostazioni/profilo" className={ui.textLink}>
                    Compila il profilo
                  </Link>
                </p>
              ) : report.nutrients.status === "insufficient" ? (
                <InsufficientBox view={nutrientsInsufficientView(report.nutrients.completeDays)} />
              ) : (
                <>
                  <BasisLine>{basisText(report.nutrients.basis, { used: "Giorni tracciati per intero" })}</BasisLine>
                  {nutrientRows && nutrientRows.compared.length > 0 ? (
                    <ul className={styles.rows}>
                      {nutrientRows.compared.map((row) => (
                        <li key={row.id} className={styles.rowItem}>
                          <div className={styles.rowHead}>
                            <span className={styles.rowName}>{row.label}</span>
                            <span className={styles.rowValue}>
                              <Value certainty={row.certainty ?? "estimated"}>{row.headline}</Value>
                            </span>
                          </div>
                          <p className={styles.note}>
                            {row.detail}
                            {row.missingShort ? ` ${row.missingShort}.` : ""}
                          </p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className={styles.range}>Nessun nutriente ha dati sufficienti nel periodo per un confronto.</p>
                  )}
                  {nutrientRows && nutrientRows.insufficient.length > 0 ? (
                    <p className={styles.note}>
                      {nutrientRows.insufficient.length} nutrienti non hanno abbastanza giorni con il dato e non sono mostrati.{" "}
                      <Link href="/app/salute/nutrizione" className={`${ui.textLink} ${styles.noPrint}`}>
                        Vedi la schermata Nutrizione
                      </Link>
                    </p>
                  ) : null}
                  <p className={styles.note}>
                    Valori stimati da tabelle e da quantità registrate, confrontati con riferimenti per adulti: non sono un parere medico.
                  </p>
                </>
              )}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
