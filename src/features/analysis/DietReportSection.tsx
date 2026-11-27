"use client";

import Link from "next/link";
import { useMemo } from "react";
import { summarizePeriod } from "@/core/diet";
import { SectionHeader } from "@/design";
import { NOT_MEDICAL_TEXT, dietHref, useDietHistory } from "../diet";
import ui from "../ui.module.css";
import { dietReportLines } from "./reportView";
import styles from "./analysis.module.css";

/** «Qualità di ciò che mangi» nel rapporto: il riepilogo delle settimane del periodo, con il rimando al dettaglio. */
export function DietReportSection({ from, to }: { from: string; to: string }) {
  const { history } = useDietHistory();
  const lines = useMemo(() => (history ? dietReportLines(summarizePeriod(history, from, to)) : undefined), [history, from, to]);
  if (!lines) return null;
  return (
    <section className={ui.section}>
      <SectionHeader label="Qualità di ciò che mangi" />
      <div className={styles.card}>
        {lines.map((line) => (
          <p key={line} className={styles.range}>
            {line}
          </p>
        ))}
        <p className={styles.note}>{NOT_MEDICAL_TEXT}</p>
        <Link href={dietHref({ week: from })} className={`${ui.textLink} ${styles.noPrint}`}>
          Apri il dettaglio
        </Link>
      </div>
    </section>
  );
}
