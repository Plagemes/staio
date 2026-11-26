"use client";

import Link from "next/link";
import { useState } from "react";
import { getWeek } from "@/core/plan";
import { Button, SectionHeader } from "@/design";
import { MoreActions, type ActionItem } from "../common";
import { DIET_HREF } from "../allergens";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { CopyWeekSheet } from "./CopyWeekSheet";
import { nextMonday, weekChoices } from "./dates";
import { TonightSection } from "./TonightSection";
import { mealCount, mealsText, weekRows } from "./tonight";
import { usePlanData } from "./usePlanData";
import styles from "./plan.module.css";

const PROPOSE_HREF = "/app/piano/settimana?proponi=1";

/**
 * Piano: che cosa mangio stasera e nei prossimi giorni. «Stasera e domani» in alto, poi la settimana giorno per giorno;
 * Ricette, Spesa e Preparazioni in testa; il resto in «Altro».
 */
export function PlanHome() {
  const data = usePlanData();
  const [copying, setCopying] = useState(false);
  const plan = data.plan;
  if (data.error) return <StorageError />;
  if (!data.ready || !plan) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Piano</h1>
        <LoadingLine />
      </div>
    );
  }

  const weeks = weekChoices(data.today);
  const [previous, current, next] = weeks;
  const entries = getWeek(plan, current.start)?.entries ?? [];
  const rows = weekRows(data.today, current.start, entries);
  const nextEntries = getWeek(plan, next.start)?.entries ?? [];
  const previousHasEntries = (getWeek(plan, previous.start)?.entries.length ?? 0) > 0;
  const firstDay = current.start;

  const more: ActionItem[] = [
    ...(rows.empty ? [] : [{ id: "propose", label: "Proponi la settimana", href: PROPOSE_HREF }]),
    { id: "copy", label: "Copia la settimana scorsa", ...(previousHasEntries ? {} : { disabled: true, hint: "Niente da copiare" }), onSelect: () => setCopying(true) },
    { id: "verify", label: "Verifica del piano", href: "/app/piano/settimana?verifica=1" },
    { id: "goals", label: "Obiettivi e pasti", href: DIET_HREF },
  ];

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Piano</h1>
        <nav className={styles.headLinks} aria-label="Sezioni del piano">
          <Link href="/app/ricette" className={ui.textLink}>
            Ricette
          </Link>
          <Link href="/app/spesa" className={ui.textLink}>
            Spesa
          </Link>
          <Link href="/app/preparazioni" className={ui.textLink}>
            Preparazioni
          </Link>
        </nav>
      </div>

      {/* il pulsante pieno è «Proponi la settimana» se da oggi a domenica non c'è niente, altrimenti «Cucina» sulla prima ricetta */}
      <TonightSection data={data} primaryCook={!rows.empty} />

      <section className={ui.section} aria-label="Questa settimana">
        <SectionHeader label="Questa settimana" actionLabel="Apri" actionHref="/app/piano/settimana" />
        <ul className={styles.weekList}>
          {rows.days.map((d) => (
            <li key={d.date}>
              <Link href={`/app/piano/settimana?giorno=${d.date}`} className={styles.weekRow}>
                {d.text}
              </Link>
            </li>
          ))}
          {rows.pastMeals > 0 ? (
            <li>
              <Link href={`/app/piano/settimana?giorno=${firstDay}`} className={styles.weekRow}>
                Giorni passati: {mealsText(rows.pastMeals)} {rows.pastMeals === 1 ? "pianificato" : "pianificati"}
              </Link>
            </li>
          ) : null}
          <li>
            <Link href={`/app/piano/settimana?giorno=${nextMonday(data.today)}`} className={styles.weekRow}>
              Prossima settimana · {mealsText(mealCount(nextEntries))}
            </Link>
          </li>
        </ul>
        <div className={ui.row}>
          {rows.empty ? <Button href={PROPOSE_HREF}>Proponi la settimana</Button> : null}
          <MoreActions items={more} />
        </div>
      </section>

      {copying ? <CopyWeekSheet data={data} target={current} initial="previous" onClose={() => setCopying(false)} /> : null}
    </div>
  );
}
