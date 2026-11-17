"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { compareWithReferences, type NutrientKey } from "@/core/nutrition";
import { Button, Label, ProgressLine, SectionHeader, Tabs, Value } from "@/design";
import { dayOf } from "../format";
import { NutritionDisclaimer } from "./Disclaimer";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import {
  CERTAINTY_LABELS,
  certaintyExplanation,
  formatNutrient,
  nutrientLabel,
} from "./labels";
import { buildNutritionRows, averageIntake, inPeriod, periodOf, topContributors, type ComparisonRow } from "./prepare";
import { toEngineProfile } from "./profile";
import styles from "./nutrition.module.css";
import { createFoodSearch, type FoodOption, type FoodSearch } from "./candidates";
import { FoodPicker } from "./FoodCandidates";
import { UnresolvedList } from "./UnresolvedList";
import { useFoodCorrection } from "./useCorrection";
import { useIntake, useNutritionProfile, useReferences } from "./useNutrition";

const PERIODS = [
  { id: "7", label: "7 giorni" },
  { id: "30", label: "30 giorni" },
];

const AVERAGED: readonly NutrientKey[] = ["energyKcal", "proteinG", "carbsG", "sugarsG", "fatG", "saturatedFatG", "fiberG", "saltG"];

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
                    {search ? (
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

/** I limiti di questi numeri, detti chiaramente. */
function WhatToKnow() {
  return (
    <section className={ui.section}>
      <SectionHeader label="Cosa sapere" />
      <ul className={styles.know}>
        <li>I valori sono stime da una banca dati statunitense, non misure sui tuoi prodotti.</li>
        <li>I micronutrienti mancano spesso, e lo iodio quasi sempre: un nutriente senza dato non vale zero.</li>
        <li>Molti alimenti comuni non sono riconosciuti da soli: vanno scelti dall&apos;elenco, voce per voce, quando li scrivi in un pasto.</li>
        <li>Nei pasti va detto se l&apos;alimento è pesato a crudo o cotto: la differenza è grande, soprattutto per pasta e riso.</li>
        <li>La carne nei pasti, dove nella tabella non esiste la voce cotta, è calcolata a crudo, e l&apos;app lo indica accanto al valore.</li>
        <li>Servono almeno cinque giorni completi per un confronto con i riferimenti.</li>
      </ul>
    </section>
  );
}

export function Nutrition() {
  const data = useIntake();
  const refs = useReferences();
  const { profile, ready: profileReady } = useNutritionProfile();
  const now = useNow();
  const [period, setPeriod] = useState("7");
  const [openId, setOpenId] = useState<string | null>(null);

  const search = useMemo(() => (data.foods ? createFoodSearch(data.foods) : undefined), [data.foods]);
  const applyCorrection = useFoodCorrection(data.overrides);
  const today = now ? dayOf(now) : null;
  const n = Number(period);
  const range = useMemo(() => (today ? periodOf(today, n) : null), [today, n]);
  const periodDays = useMemo(() => (data.intake && range ? inPeriod(data.intake.days, range.from, range.to) : []), [data.intake, range]);

  const comparisons = useMemo(() => {
    if (!data.intake || !refs || !profile || !range || !today) return undefined;
    return compareWithReferences(data.intake.days, refs, toEngineProfile(profile, today), range);
  }, [data.intake, refs, profile, range, today]);
  const rows = useMemo(() => (comparisons ? buildNutritionRows(comparisons, periodDays) : undefined), [comparisons, periodDays]);

  if (data.error) return <StorageError />;
  if (!data.ready || !profileReady || !refs || !today || !range) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Nutrizione</h1>
        <LoadingLine text="Calcolo i nutrienti…" />
      </div>
    );
  }

  const complete = periodDays.filter((d) => d.complete).length;
  const averages = AVERAGED.flatMap((k) => {
    const a = averageIntake(periodDays, k);
    return a ? [{ key: k, avg: a }] : [];
  });
  const renderRows = (list: ComparisonRow[]) => (
    <ul className={styles.rows}>
      {list.map((row) => (
        <Row
          key={row.id}
          row={row}
          open={openId === row.id}
          onToggle={() => setOpenId(openId === row.id ? null : row.id)}
          contributors={openId === row.id ? topContributors(periodDays, row.nutrient) : []}
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
        <Label>Stima</Label>
      </div>
      <p className={ui.lead}>
        Quanto assumi rispetto ai valori di riferimento. Non è un giudizio e non serve a dire come stai: serve a vedere dove sei.
      </p>

      <Tabs label="Periodo" items={PERIODS} value={period} onChange={setPeriod} />
      <p className={ui.hint}>
        Giorni completi nel periodo: {complete} su {periodDays.length}. Contano solo i giorni con colazione, pranzo e cena tracciati.
      </p>

      <section className={ui.section}>
        <SectionHeader label="Assunzione media al giorno" />
        {averages.length === 0 ? (
          <p className={styles.quiet}>
            Ancora nessun giorno completo con dati nel periodo. Registra colazione, pranzo e cena (anche come «ho mangiato fuori») per vedere le medie.
          </p>
        ) : (
          <ul className={styles.contributors}>
            {averages.map(({ key, avg }) => (
              <li key={key} className={styles.contributor}>
                <span>{nutrientLabel(key)}</span>
                <span className={styles.contributorShare}>
                  {avg.partial ? "almeno " : ""}
                  <Value certainty={avg.certainty}>{formatNutrient(key, avg.value)}</Value>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!profile ? (
        <div className={ui.callout} role="group" aria-label="Profilo mancante">
          <p className={ui.paragraph}>
            Per confrontare con i valori di riferimento servono sesso ed età. Senza, vedi i nutrienti ma non il confronto.
          </p>
          <div className={ui.row}>
            <Button href="/app/impostazioni/profilo">Compila il profilo</Button>
          </div>
        </div>
      ) : rows ? (
        <>
          <p className={ui.hint}>
            Riferimenti per {profile.sex === "female" ? "una donna adulta" : "un uomo adulto"}.{" "}
            <Link href="/app/impostazioni/profilo" className={ui.textLink}>
              Cambia profilo
            </Link>
          </p>
          {rows.compared.length > 0 ? (
            <section className={ui.section}>
              <SectionHeader label="Rispetto al riferimento" />
              {renderRows(rows.compared)}
              <p className={ui.hint}>In ordine: prima ciò che è più lontano dal riferimento, in più o in meno.</p>
            </section>
          ) : null}
          {rows.notes.length > 0 ? (
            <section className={ui.section}>
              <SectionHeader label="Riferimento solo a parole" />
              {renderRows(rows.notes)}
            </section>
          ) : null}
          {rows.insufficient.length > 0 ? (
            <section className={ui.section}>
              <SectionHeader label="Dati insufficienti" />
              {renderRows(rows.insufficient)}
            </section>
          ) : null}
        </>
      ) : null}

      {data.intake && search ? <UnresolvedList days={data.intake.days} search={search} overrides={data.overrides} /> : null}

      <WhatToKnow />

      <NutritionDisclaimer />
    </div>
  );
}
