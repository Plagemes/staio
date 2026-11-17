"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buildReport, reportPeriod, type ReportKind } from "@/core/analysis";
import { usePantry } from "@/data";
import { SectionHeader, Tabs, Value } from "@/design";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import { buildNutritionRows, inPeriod } from "../nutrition/prepare";
import { toEngineProfile } from "../nutrition/profile";
import { useNutritionProfile, useReferences } from "../nutrition/useNutrition";
import ui from "../ui.module.css";
import { REPORT_MIN } from "./config";
import { basisText, formatPercent, plural, reliabilityText } from "./present";
import {
  REPORT_KINDS,
  canGoNext,
  mealsText,
  noRecordsView,
  nutrientsInsufficientView,
  periodTitle,
  shiftPeriod,
  spendText,
  trackingText,
  occurrencesText,
  partialNote,
  wasteCostText,
  wasteItemText,
  weightInsufficientView,
  weightReportText,
} from "./reportView";
import { AnalysisDisclaimer, BasisLine, InsufficientBox } from "./shared";
import { useAnalysisBase } from "./useAnalysisBase";
import styles from "./analysis.module.css";

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

export function Report() {
  const { diary, intakeDays, today, error, ready } = useAnalysisBase();
  const pantry = usePantry();
  const refs = useReferences();
  const { profile, ready: profileReady } = useNutritionProfile();
  const [kind, setKind] = useState<ReportKind>("week");
  const [anchor, setAnchor] = useState<string | null>(null);

  const period = useMemo(() => (today ? reportPeriod(kind, anchor ?? today) : undefined), [kind, anchor, today]);

  const report = useMemo(() => {
    if (!ready || !diary || !intakeDays || !pantry.data || !today || !period) return undefined;
    return buildReport(
      kind,
      period.from,
      {
        diary,
        pantry: pantry.data,
        intakeDays,
        ...(refs && profile ? { references: refs, profile: toEngineProfile(profile, today) } : {}),
      },
      { minWeighIns: REPORT_MIN.weighIns, minCompleteDays: REPORT_MIN.completeDays, today },
    );
  }, [ready, diary, intakeDays, pantry.data, today, period, kind, refs, profile]);

  const nutrientRows = useMemo(() => {
    if (!report?.nutrients || report.nutrients.status !== "ok" || !intakeDays) return undefined;
    return buildNutritionRows(report.nutrients.comparisons, inPeriod(intakeDays, report.period.from, report.period.to));
  }, [report, intakeDays]);

  const failed = error || Boolean(pantry.error);
  const loading = !failed && (!report || !profileReady || !period || !today);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Rapporto</h1>
        <Link href="/app/salute" className={ui.textLink}>
          Torna a Salute
        </Link>
      </div>
      <p className={ui.lead}>
        Ciò che hai registrato nella settimana o nel mese, sezione per sezione, ciascuna con i giorni su cui poggia. Dove non c&apos;è un dato non c&apos;è uno zero.
      </p>
      <AnalysisDisclaimer />

      {failed ? <StorageError /> : null}
      {loading ? <LoadingLine text="Preparo il rapporto…" /> : null}

      {report && period && today ? (
        <>
          <Tabs
            label="Periodo del rapporto"
            items={REPORT_KINDS}
            value={kind}
            onChange={(id) => {
              setKind(id as ReportKind);
              setAnchor(period.to >= today ? null : period.from);
            }}
          />
          <div className={styles.nav}>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => setAnchor(shiftPeriod(period, -1).from)}
              aria-label={kind === "week" ? "Settimana precedente" : "Mese precedente"}
            >
              <Chevron direction="left" />
            </button>
            <h2 className={styles.navTitle} aria-live="polite">
              {periodTitle(period)}
            </h2>
            <button
              type="button"
              className={styles.navButton}
              onClick={() => setAnchor(shiftPeriod(period, 1).from)}
              disabled={!canGoNext(period, today)}
              aria-label={kind === "week" ? "Settimana successiva" : "Mese successivo"}
            >
              <Chevron direction="right" />
            </button>
          </div>
          {partialNote(report.period) ? <p className={ui.hint}>{partialNote(report.period)}</p> : null}

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

          <section className={ui.section}>
            <SectionHeader label="Pasti" />
            <div className={styles.card}>
              <p className={styles.range}>{mealsText(report.meals)}</p>
              <BasisLine>{basisText(report.meals.basis, { used: "Giorni completi" })}</BasisLine>
            </div>
          </section>

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

          <section className={ui.section}>
            <SectionHeader label="Spesa" />
            <div className={styles.card}>
              {report.spend.status === "ok" ? (
                <>
                  {spendText(report.spend).map((line) => (
                    <p key={line} className={styles.range}>
                      {line}
                    </p>
                  ))}
                  <BasisLine>
                    <Value certainty={report.spend.certainty}>
                      {occurrencesText(report.spend.basis.observations, "acquisto", "acquisti", report.spend.basis.usedDays)}
                    </Value>
                  </BasisLine>
                </>
              ) : (
                <InsufficientBox view={noRecordsView("gli acquisti")} />
              )}
            </div>
          </section>

          <section className={ui.section}>
            <SectionHeader label="Cibo buttato" />
            <div className={styles.card}>
              {report.waste.status === "ok" ? (
                <>
                  <ul className={styles.list}>
                    {report.waste.items.map((item) => (
                      <li key={`${item.reason}|${item.unit}`}>{wasteItemText(item)}</li>
                    ))}
                  </ul>
                  {wasteCostText(report.waste).map((line) => (
                    <p key={line} className={styles.range}>
                      {line}
                    </p>
                  ))}
                  <BasisLine>
                    <Value certainty={report.waste.certainty}>
                      {occurrencesText(report.waste.basis.observations, "registrazione", "registrazioni", report.waste.basis.usedDays)}
                    </Value>
                  </BasisLine>
                </>
              ) : (
                <InsufficientBox view={noRecordsView("gli scarti")} />
              )}
            </div>
          </section>

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
                      <Link href="/app/salute/nutrizione" className={ui.textLink}>
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
