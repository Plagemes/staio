"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { localMoment } from "@/core/diary";
import {
  DEFAULT_MIN_COMPLETE_DAYS,
  analyzeVariety,
  compareWithReferences,
  foodLookup,
  periodBreakdown,
  proteinSpread,
  type NutrientKey,
} from "@/core/nutrition";
import { Button, Label, ProgressLine, SectionHeader, Tabs, Value } from "@/design";
import { Disclosure } from "../common";
import { BreakdownSheet } from "../common/Breakdown";
import { dayOf } from "../format";
import { NutritionDisclaimer } from "./Disclaimer";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { averageContent, countedDaysContent, countedDaysText } from "./breakdownView";
import {
  CERTAINTY_LABELS,
  certaintyExplanation,
  formatNutrient,
  nutrientLabel,
} from "./labels";
import {
  averageIntake,
  buildNutritionRows,
  inPeriod,
  notComputableCount,
  outOfHomeDayCount,
  outOfHomeDaysText,
  periodOf,
  topContributors,
  unresolvedGroups,
  type ComparisonRow,
} from "./prepare";
import { toEngineProfile } from "./profile";
import styles from "./nutrition.module.css";
import { createFoodSearch, type FoodOption, type FoodSearch } from "./candidates";
import { FoodPicker } from "./FoodCandidates";
import { CostPerNutrientSection } from "./CostPerNutrient";
import { UnresolvedList } from "./UnresolvedList";
import { ProteinSpreadSection, VarietySection } from "./WeekSections";
import { comparisonGateText, otherNutrientsTitle, splitComparisons, spreadSummary, unresolvedTitle, varietySummary } from "./summaries";
import { useFoodCorrection } from "./useCorrection";
import { useIntake, useNutritionProfile, useReferences } from "./useNutrition";
import { varietyView } from "./weekView";

const PERIODS = [
  { id: "7", label: "7 giorni" },
  { id: "30", label: "30 giorni" },
];

const AVERAGED: readonly NutrientKey[] = ["energyKcal", "proteinG", "carbsG", "sugarsG", "fatG", "saturatedFatG", "fiberG", "saltG"];

type OpenSheet = { kind: "days" } | { kind: "average"; key: NutrientKey };

function Row({
  row,
  open,
  onToggle,
  contributors,
  search,
  onChangeFood,
}: {
  row: ComparisonRow;
  open: boolean;
  onToggle: () => void;
  contributors: ReturnType<typeof topContributors>;
  search: FoodSearch | undefined;
  onChangeFood: (contributor: ReturnType<typeof topContributors>[number], option: FoodOption) => Promise<string | null>;
}) {
  const [changing, setChanging] = useState<string | null>(null);
  const [changeError, setChangeError] = useState<string | null>(null);
  return (
    <li className={styles.row}>
      <button type="button" className={styles.rowButton} aria-expanded={open} onClick={onToggle}>
        <span className={styles.rowName}>{row.label}</span>
        <span className={styles.rowHeadline}>
          {row.certainty === "estimated" ? <Value certainty="estimated">{row.headline}</Value> : row.headline}
        </span>
        <span className={styles.rowKind}>
          {row.refKindLabel}
          {row.missingShort ? ` · ${row.missingShort}` : ""}
        </span>
        {row.share !== undefined ? (
          <span className={styles.rowBar}>
            <ProgressLine value={Math.min(row.share, 1) * 100} max={100} label={`${row.label}: ${row.headline}`} />
          </span>
        ) : null}
      </button>
      {open ? (
        <div className={styles.panel}>
          <p className={ui.paragraph}>{row.detail}</p>
          {row.certainty ? (
            <p className={ui.hint}>
              Certezza: {CERTAINTY_LABELS[row.certainty]}. {certaintyExplanation(row.certainty)}
            </p>
          ) : null}
          {row.missingText ? <p className={ui.hint}>{row.missingText}</p> : null}
          {row.defaultVariantText ? (
            <p className={ui.hint}>
              {row.defaultVariantText}{" "}
              <Link href="/app/impostazioni/profilo" className={ui.textLink}>
                Apri il profilo
              </Link>
            </p>
          ) : null}
          {contributors.length > 0 ? (
            <div>
              <Label>Da dove viene</Label>
              <ul className={styles.contributors}>
                {contributors.map((c) => (
                  <li key={c.key} className={styles.contributorItem}>
                    <div className={styles.contributor}>
                      <span>
                        {c.name}
                        {c.matchedName.toLowerCase() !== c.name.toLowerCase() ? <span className={styles.matched}> · letto come «{c.matchedName}»</span> : null}
                      </span>
                      <span className={styles.contributorShare}>{Math.round(c.share * 100)}%</span>
                    </div>
                    {c.stateText ? <span className={c.stateHonored === false ? styles.stateWarning : styles.matched}>{c.stateText}</span> : null}
                    {search && !c.outOfHome ? (
                      <div>
                        <Button variant="text" aria-expanded={changing === c.key} onClick={() => setChanging(changing === c.key ? null : c.key)}>
                          Non è questo alimento?
                        </Button>
                      </div>
                    ) : null}
                    {search && changing === c.key ? (
                      <FoodPicker
                        label={c.name}
                        search={search}
                        onPick={(o) => {
                          void onChangeFood(c, o).then((error) => {
                            setChangeError(error);
                            if (!error) setChanging(null);
                          });
                        }}
                        onClose={() => setChanging(null)}
                      />
                    ) : null}
                    {changing === c.key && changeError ? (
                      <p className={ui.error} role="alert">
                        {changeError}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <p className={ui.hint}>Quota del totale nei giorni completi del periodo.</p>
            </div>
          ) : row.kind === "compared" || row.kind === "note" ? (
            <p className={ui.hint}>Nessun alimento riconosciuto ha portato questo nutriente nel periodo.</p>
          ) : null}
          {row.note ? <p className={styles.note}>Nota sul riferimento: {row.note}</p> : null}
        </div>
      ) : null}
    </li>
  );
}

/** I limiti di questi numeri, detti chiaramente. Il testo è quello di sempre: sta dietro «Che cosa significa». */
function WhatToKnow() {
  return (
    <>
      <Label>Cosa sapere</Label>
      <ul className={styles.know}>
        <li>I valori sono stime da una banca dati statunitense, non misure sui tuoi prodotti.</li>
        <li>I micronutrienti mancano spesso, e lo iodio quasi sempre: un nutriente senza dato non vale zero.</li>
        <li>Molti alimenti comuni non sono riconosciuti da soli: vanno scelti dall&apos;elenco, voce per voce, quando li scrivi in un pasto.</li>
        <li>Nei pasti va detto se l&apos;alimento è pesato a crudo o cotto: la differenza è grande, soprattutto per pasta e riso.</li>
        <li>La carne nei pasti, dove nella tabella non esiste la voce cotta, è calcolata a crudo, e l&apos;app lo indica accanto al valore.</li>
        <li>Un pasto registrato come «Fuori casa» conta nei giorni completi con una stima della sola energia: per gli altri nutrienti il dato manca.</li>
        <li>Servono almeno cinque giorni completi per un confronto con i riferimenti.</li>
      </ul>
    </>
  );
}

/**
 * Le medie del periodo rispetto ai riferimenti. In vista: i giorni contati (si aprono e dicono perché), le medie
 * (ognuna si apre e dice da quali giorni e voci viene), fino a sei confronti. Il resto in righe richiuse; le
 * spiegazioni dietro «Che cosa significa».
 */
export function Nutrition() {
  const data = useIntake();
  const refs = useReferences();
  const { profile, ready: profileReady } = useNutritionProfile();
  const now = useNow();
  const [period, setPeriod] = useState("7");
  const [openId, setOpenId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<OpenSheet | null>(null);
  const [costOpen, setCostOpen] = useState(false);

  const search = useMemo(() => (data.foods ? createFoodSearch(data.foods) : undefined), [data.foods]);
  const applyCorrection = useFoodCorrection(data.overrides);
  const today = now ? dayOf(now) : null;
  const n = Number(period);
  const range = useMemo(() => (today ? periodOf(today, n) : null), [today, n]);
  const allDays = data.intake?.days;
  const periodDays = useMemo(() => (allDays && range ? inPeriod(allDays, range.from, range.to) : []), [allDays, range]);

  const comparisons = useMemo(() => {
    if (!allDays || !refs || !profile || !range || !today) return undefined;
    return compareWithReferences(allDays, refs, toEngineProfile(profile, today), range);
  }, [allDays, refs, profile, range, today]);
  const rows = useMemo(() => (comparisons ? buildNutritionRows(comparisons, periodDays) : undefined), [comparisons, periodDays]);

  // i giorni contati non dipendono dal nutriente: quelli dell'energia valgono per tutti
  const counting = useMemo(() => (allDays && range ? periodBreakdown(allDays, range, "energyKcal") : undefined), [allDays, range]);
  const spread = useMemo(() => (allDays && today ? proteinSpread(allDays, today) : undefined), [allDays, today]);
  const variety = useMemo(() => (allDays && data.foods && today ? analyzeVariety(allDays, foodLookup(data.foods), today) : undefined), [allDays, data.foods, today]);
  const unresolved = useMemo(() => (allDays ? unresolvedGroups(allDays) : []), [allDays]);
  const skipped = useMemo(() => (allDays ? notComputableCount(allDays) : 0), [allDays]);
  const averages = useMemo(
    () =>
      AVERAGED.flatMap((k) => {
        const a = averageIntake(periodDays, k);
        return a ? [{ key: k, avg: a }] : [];
      }),
    [periodDays],
  );
  const timeZone = data.intake?.timeZone;
  const nowMinutes = useMemo(() => (now && timeZone ? localMoment(now, timeZone)?.minutes : undefined), [now, timeZone]);
  const outOfHomeText = useMemo(() => outOfHomeDaysText(outOfHomeDayCount(periodDays)), [periodDays]);
  const prepInfo = data.prepInfo;

  // il contenuto del foglio si calcola solo quando il foglio è aperto, e una volta sola
  const sheetContent = useMemo(() => {
    if (!sheet || !allDays || !counting || !range || !today) return undefined;
    if (sheet.kind === "days") return countedDaysContent(counting, { today, ...(nowMinutes !== undefined ? { nowMinutes } : {}), ...(outOfHomeText ? { note: outOfHomeText } : {}) });
    const avg = averages.find((a) => a.key === sheet.key)?.avg;
    if (!avg) return undefined;
    return averageContent(periodBreakdown(allDays, range, sheet.key), avg, { today, contributors: topContributors(periodDays, sheet.key, 5, prepInfo) });
  }, [sheet, allDays, counting, range, today, nowMinutes, outOfHomeText, averages, periodDays, prepInfo]);

  if (data.error) return <StorageError />;
  if (!data.ready || !profileReady || !refs || !today || !range || !now || !counting) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Nutrizione</h1>
        <LoadingLine text="Calcolo i nutrienti…" />
      </div>
    );
  }

  const complete = counting.complete;
  const gate = comparisonGateText({ hasProfile: profile !== null, completeDays: complete, required: DEFAULT_MIN_COMPLETE_DAYS });
  const split = rows && !gate ? splitComparisons(rows) : undefined;
  const remembered = search ? Object.values(data.overrides).filter((id) => search.byId(id) !== undefined).length : 0;
  const showUnresolved = search !== undefined && (unresolved.length > 0 || remembered > 0 || skipped > 0);

  const renderRows = (list: ComparisonRow[]) => (
    <ul className={styles.rows}>
      {list.map((row) => (
        <Row
          key={row.id}
          row={row}
          open={openId === row.id}
          onToggle={() => setOpenId(openId === row.id ? null : row.id)}
          contributors={openId === row.id ? topContributors(periodDays, row.nutrient, 5, data.prepInfo) : []}
          search={search}
          onChangeFood={(c, option) => applyCorrection(c, c.name, option)}
        />
      ))}
    </ul>
  );

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Nutrizione</h1>
        <Link href="/app/salute" className={ui.textLink}>
          Torna a Salute
        </Link>
      </div>

      <div className={styles.periodBlock}>
        <Tabs label="Periodo" items={PERIODS} value={period} onChange={setPeriod} />
        <button type="button" className={styles.countLine} aria-haspopup="dialog" onClick={() => setSheet({ kind: "days" })}>
          {countedDaysText(complete, n)}
          <span className={styles.why}> · perché</span>
        </button>
      </div>

      <section className={ui.section}>
        <SectionHeader label="Media al giorno" />
        {averages.length === 0 ? (
          <p className={styles.quiet}>
            Ancora nessun giorno completo con dati nel periodo. Registra colazione, pranzo e cena (anche come «Fuori casa», che conta come stima) per vedere le medie.
          </p>
        ) : (
          <ul className={styles.rows}>
            {averages.map(({ key, avg }) => (
              <li key={key} className={styles.row}>
                <button type="button" className={styles.lineButton} aria-haspopup="dialog" onClick={() => setSheet({ kind: "average", key })}>
                  <span>{nutrientLabel(key)}</span>
                  <span className={styles.contributorShare}>
                    {avg.partial ? "almeno " : ""}
                    <Value certainty={avg.certainty}>{formatNutrient(key, avg.value)}</Value>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={ui.section}>
        <SectionHeader label="Rispetto al riferimento" />
        {gate ? (
          <p className={ui.hint}>
            {gate}
            {!profile ? (
              <>
                {" "}
                <Link href="/app/impostazioni/profilo" className={ui.textLink}>
                  Compila il profilo
                </Link>
              </>
            ) : null}
          </p>
        ) : profile && split ? (
          <>
            <p className={ui.hint}>
              Riferimenti per {profile.sex === "female" ? "una donna adulta" : "un uomo adulto"}.{" "}
              <Link href="/app/impostazioni/profilo" className={ui.textLink}>
                Cambia profilo
              </Link>
            </p>
            {split.shown.length > 0 ? renderRows(split.shown) : null}
          </>
        ) : null}
      </section>

      <div className={styles.closedRows}>
        {split && split.hidden > 0 ? (
          <Disclosure title={otherNutrientsTitle(split.hidden)}>
            {split.more.length > 0 ? renderRows(split.more) : null}
            {split.notes.length > 0 ? (
              <div>
                <Label>Riferimento solo a parole</Label>
                {renderRows(split.notes)}
              </div>
            ) : null}
            {split.insufficient.length > 0 ? (
              <div>
                <Label>Dati insufficienti</Label>
                {renderRows(split.insufficient)}
              </div>
            ) : null}
          </Disclosure>
        ) : null}
        {allDays && spread ? (
          <Disclosure title="Proteine nella giornata" summary={spreadSummary(spread)}>
            <ProteinSpreadSection headless days={allDays} today={today} spread={spread} />
          </Disclosure>
        ) : null}
        {allDays && data.foods && variety ? (
          <Disclosure title="Varietà vegetale" summary={varietySummary(varietyView(variety))}>
            <VarietySection headless days={allDays} foods={data.foods} today={today} report={variety} />
          </Disclosure>
        ) : null}
        {allDays && search && showUnresolved ? (
          // aperta quando ci sono voci da collegare: lì si può fare qualcosa
          <Disclosure title={unresolvedTitle(unresolved.length)} summary={unresolved.length > 0 ? "restano fuori dai totali" : undefined} defaultOpen={unresolved.length > 0}>
            <UnresolvedList headless days={allDays} search={search} overrides={data.overrides} prepInfo={data.prepInfo} groups={unresolved} skipped={skipped} />
          </Disclosure>
        ) : null}
        <Disclosure title="Costo per nutriente" open={costOpen} onOpenChange={setCostOpen}>
          {costOpen ? <CostPerNutrientSection headless foods={data.foods} overrides={data.overrides} today={today} /> : null}
        </Disclosure>
      </div>

      <Disclosure quiet title="Che cosa significa">
        <p>Quanto assumi rispetto ai valori di riferimento. Non è un giudizio e non serve a dire come stai: serve a vedere dove sei.</p>
        {/* il numero dei giorni contati sta in cima, e si apre: qui resta la regola */}
        <p>
          Contano solo i giorni con colazione, pranzo e cena tracciati.
          {outOfHomeText ? ` ${outOfHomeText}` : ""}
        </p>
        {split && split.shown.length > 0 ? <p>In ordine: prima ciò che è più lontano dal riferimento, in più o in meno.</p> : null}
        <WhatToKnow />
        <NutritionDisclaimer />
      </Disclosure>

      {sheetContent ? <BreakdownSheet {...sheetContent} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
