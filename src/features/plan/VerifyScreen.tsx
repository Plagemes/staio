"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { compareWeek, checkPlanWeek, getWeek, type LotRef } from "@/core/plan";
import { ALLERGEN_CHECK_NOTICE, deriveConfirmations } from "@/core/allergens";
import { Label, SectionHeader, Tabs } from "@/design";
import { NUTRITION_DISCLAIMER_SHORT, CERTAINTY_LABELS } from "../nutrition/labels";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { WEEK_LABELS, dayHeading, weekChoices, type WeekId } from "./dates";
import { itemName } from "./describe";
import { checkWeekConstraints } from "./safety";
import { usePlanData } from "./usePlanData";
import { adherenceView, constraintLines, dayCheckView, daySummaryText, type LineTone } from "./verify";
import styles from "./plan.module.css";

const TONE_CLASS: Record<LineTone, string> = { ok: styles.toneOk, attention: styles.toneAttention, unknown: styles.toneUnknown };

const TABS = (["previous", "current", "next"] as WeekId[]).map((id) => ({ id, label: WEEK_LABELS[id] }));

export function Verify() {
  const data = usePlanData();
  const [weekId, setWeekId] = useState<WeekId>("current");
  const weeks = data.today ? weekChoices(data.today) : [];
  const week = weeks.find((w) => w.id === weekId);
  const plan = data.plan;

  const check = useMemo(() => (plan && week && data.nutrientsOf ? checkPlanWeek(plan, week.start, data.nutrientsOf) : undefined), [plan, week, data.nutrientsOf]);
  const confirmations = useMemo(() => deriveConfirmations(data.log ?? []).byKey, [data.log]);
  const constraints = useMemo(
    () =>
      plan && week
        ? checkWeekConstraints(plan.structure, getWeek(plan, week.start), { expandForChecks: data.expandForChecks, linkOf: data.linkOf, confirmations })
        : undefined,
    [plan, week, data.expandForChecks, data.linkOf, confirmations],
  );
  const adherence = useMemo(() => {
    if (!plan || !week || !data.diary || !data.log || !data.pantry || weekId === "next") return undefined;
    const lots = new Map<string, LotRef>(data.pantry.lots.map((l) => [l.lotId, { productRef: l.productRef }]));
    for (const p of data.preps) lots.set(p.batchLotId, { productRef: p.title, prepId: p.prepId });
    return compareWeek(plan, week.start, data.diary, { events: data.log, lots, expand: data.expand });
  }, [plan, week, weekId, data.diary, data.log, data.pantry, data.preps, data.expand]);

  if (data.error) return <StorageError />;
  if (!data.ready || !plan || !week) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Verifica del piano</h1>
        <LoadingLine />
      </div>
    );
  }

  const nameOfRef = (via: { kind: "recipe" | "prep"; id: string }) => itemName(via.kind === "recipe" ? { kind: "recipe", recipeId: via.id, servings: 1 } : { kind: "prep", prepId: via.id, servings: 1 }, data.catalog);
  const lines = constraints ? constraintLines(constraints, nameOfRef) : [];
  const planned = getWeek(plan, week.start)?.entries.length ?? 0;
  const view = adherence ? adherenceView(adherence, (item) => itemName(item, data.catalog)) : undefined;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Verifica del piano</h1>
        <Link href="/app/piano" className={ui.textLink}>
          Torna al piano
        </Link>
      </div>
      <p className={ui.lead}>Il piano confrontato con gli obiettivi che hai scelto, e con ciò che hai registrato davvero. Sono stime: dove il dato manca, lo dico.</p>
      <Tabs label="Settimana" items={TABS} value={weekId} onChange={(id) => setWeekId(id as WeekId)} />

      {planned === 0 ? (
        <EmptyState
          title="Niente di pianificato in questa settimana"
          text="Con un piano qui compariranno, giorno per giorno, gli obiettivi rispettati o no, gli alimenti esclusi e, per le settimane passate, il confronto con quello che hai mangiato."
          actionLabel="Pianifica la settimana"
          actionHref="/app/piano/settimana"
        />
      ) : (
        <>
          <section className={ui.section} aria-label="Alimenti esclusi e allergeni">
            <SectionHeader label="Alimenti esclusi e allergeni" actionLabel="Modifica" actionHref="/app/piano/obiettivi" />
            {!plan.structure || (plan.structure.excludedFoods.length === 0 && plan.structure.allergens.length === 0) ? (
              <p className={ui.paragraph}>Non hai indicato alimenti esclusi né allergeni: non c&apos;è niente da controllare.</p>
            ) : lines.length === 0 ? (
              <p className={ui.paragraph}>Nessuna corrispondenza trovata nelle voci di questa settimana. Non vuol dire che sia tutto sicuro.</p>
            ) : (
              <ul className={styles.rows}>
                {lines.map((l, i) => (
                  <li key={i} className={`${styles.row} ${l.kind === "violation" ? styles.toneAttention : styles.toneUnknown}`}>
                    {l.kind === "confirmed" ? <strong>Confermato da te. </strong> : null}
                    {dayHeading(l.date, data.today).replace(/, (oggi|domani)$/, "")}: {l.text}
                  </li>
                ))}
              </ul>
            )}
            {plan.structure && (plan.structure.excludedFoods.length > 0 || plan.structure.allergens.length > 0) ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}
          </section>

          <section className={ui.section} aria-label="Obiettivi">
            <SectionHeader label="Obiettivi, giorno per giorno" actionLabel="Obiettivi" actionHref="/app/piano/obiettivi" />
            {!check ? (
              <LoadingLine text="Carico la tabella degli alimenti…" />
            ) : (
              <ol className={styles.days}>
                {check.days.map((day) => {
                  const v = dayCheckView(day);
                  if (day.status === "no_plan") return null;
                  return (
                    <li key={day.date} className={styles.day}>
                      <div className={styles.dayHead}>
                        <h3 className={styles.dayTitle}>{dayHeading(day.date, data.today)}</h3>
                        {v.dayType ? <Label>{v.dayType}</Label> : null}
                      </div>
                      {v.note ? (
                        <p className={styles.dayNote}>
                          {v.note} <Link href={v.dayType === undefined ? "/app/piano/settimana" : "/app/piano/obiettivi"}>{v.dayType === undefined ? "Scegli il tipo" : "Scrivi gli obiettivi"}</Link>
                        </p>
                      ) : (
                        <>
                          <p className={ui.paragraph}>{daySummaryText(v)}.</p>
                          {v.unknownEntries > 0 ? (
                            <p className={styles.dayNote}>
                              {v.unknownEntries} {v.unknownEntries === 1 ? "voce" : "voci"} senza dati nutrizionali: i totali sono minimi, non totali.
                            </p>
                          ) : null}
                          <ul className={styles.checkLines}>
                            {v.lines.map((l) => (
                              <li key={l.nutrient} className={styles.checkLine}>
                                <span className={styles.checkName}>
                                  {l.label} <span className={styles.toneUnknown}>({l.target})</span>
                                </span>
                                <span className={styles.checkValue}>{l.value || "—"}</span>
                                <span className={`${styles.checkStatus} ${TONE_CLASS[l.tone]}`}>
                                  {l.statusText}.{l.missingText ? ` ${l.missingText}` : ""}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </li>
                  );
                })}
              </ol>
            )}
            <p className={ui.hint}>Valori {CERTAINTY_LABELS.estimated}: quantità pianificate e tabelle generiche. {NUTRITION_DISCLAIMER_SHORT}</p>
          </section>
        </>
      )}

      {view && adherence ? (
        <section className={ui.section} aria-label="Pianificato contro reale">
          <SectionHeader label="Pianificato contro reale" />
          {adherence.days.length === 0 ? (
            <p className={ui.paragraph}>Nessun giorno di questa settimana si può confrontare. {view.excludedText}</p>
          ) : (
            <>
              <p className={ui.paragraph}>
                {view.totalsText}. {view.rateText ? `${view.rateText}.` : ""}
              </p>
              <ul className={styles.rows}>
                {view.days.map((d) => (
                  <li key={d.date} className={styles.row}>
                    <strong>{dayHeading(d.date, data.today).replace(/, (oggi|domani)$/, "")}</strong>
                    <ul className={styles.rows}>
                      {d.rows.map((r, i) => (
                        <li key={i} className={r.status === "respected" ? styles.toneOk : r.status === "skipped" || r.status === "substituted" ? styles.toneAttention : styles.toneUnknown}>
                          {r.text}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
              <p className={styles.dayNote}>{view.excludedText}</p>
            </>
          )}
          <p className={styles.dayNote}>Si confrontano solo i giorni tracciati per intero: un giorno con vuoti non dice che cosa hai mangiato, quindi non si giudica.</p>
        </section>
      ) : null}
    </div>
  );
}
