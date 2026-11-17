"use client";

import { useEffect, useMemo, useState } from "react";
import type { AssociationsResult } from "@/core/analysis";
import { Label, PromptCard, SectionHeader } from "@/design";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { AssociationsSection } from "./AssociationsSection";
import { ExpenditureSection } from "./ExpenditureSection";
import { TimingSection } from "./TimingSection";
import { WeightSection } from "./WeightSection";
import { computeAnalysis, computeAssociations } from "./compute";
import { AnalysisDisclaimer } from "./shared";
import { useAnalysisBase } from "./useAnalysisBase";

interface AssociationsState {
  /** Gli ingressi con cui è stato calcolato: se cambiano, il risultato è vecchio e si rifà. */
  source: object;
  result: AssociationsResult;
}

export function Analysis() {
  const { diary, intakeDays, today, error, ready } = useAnalysisBase();
  const analysis = useMemo(
    () => (ready && diary && intakeDays && today ? computeAnalysis(diary, intakeDays, today) : undefined),
    [ready, diary, intakeDays, today],
  );

  // Le associazioni fanno molti confronti: si calcolano dopo il primo disegno, non durante.
  const inputs = useMemo(() => (ready && diary && intakeDays && today ? { diary, intakeDays, today } : undefined), [ready, diary, intakeDays, today]);
  const [associations, setAssociations] = useState<AssociationsState | undefined>();
  useEffect(() => {
    if (!inputs) return;
    const timer = window.setTimeout(() => {
      setAssociations({ source: inputs, result: computeAssociations(inputs.diary, inputs.intakeDays, inputs.today) });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [inputs]);
  const associationsResult = associations && associations.source === inputs ? associations.result : undefined;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Analisi</h1>
        <Label>Stime</Label>
      </div>
      <p className={ui.lead}>
        Andamenti e associazioni osservati nei tuoi dati. Ogni numero dice su quanti giorni si basa e quanto è affidabile; dove i dati non bastano, lo dice
        invece di dare un numero.
      </p>
      <AnalysisDisclaimer />

      {error ? <StorageError /> : null}
      {!error && !analysis ? <LoadingLine text="Calcolo le analisi…" /> : null}

      {analysis ? (
        <>
          <section className={ui.section}>
            <SectionHeader label="Dispendio energetico stimato" />
            <ExpenditureSection result={analysis.expenditure} weightSpanDays={analysis.expenditureWeightSpanDays} />
          </section>
          <section className={ui.section}>
            <SectionHeader label="Peso: tendenza e proiezione" />
            <WeightSection
              result={analysis.projection}
              weights={analysis.weights}
              average={analysis.average}
              weightSpanDays={analysis.weightSpanDays}
              daysSinceLastWeighIn={analysis.daysSinceLastWeighIn}
            />
          </section>
          <section className={ui.section}>
            <SectionHeader label="Orari dei pasti" />
            <TimingSection result={analysis.timing} />
          </section>
          <section className={ui.section} aria-busy={associationsResult === undefined}>
            <SectionHeader label="Associazioni osservate" />
            <AssociationsSection result={associationsResult} />
          </section>
          <PromptCard title="Esperimenti" description="Cambia una cosa per un periodo e confronta con i giorni prima" href="/app/salute/esperimenti" />
          <PromptCard title="Rapporto" description="Riepilogo della settimana o del mese" href="/app/salute/rapporto" />
        </>
      ) : null}
    </div>
  );
}
