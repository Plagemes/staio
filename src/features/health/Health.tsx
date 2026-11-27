"use client";

import { useMemo, useState } from "react";
import { getDay } from "@/core/diary";
import { useDiary, useEventLog } from "@/data";
import { Label, SectionHeader } from "@/design";
import { Disclosure, MoreActions, type ActionItem } from "../common";
import { dayOf } from "../format";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import { BodyLines } from "../today/BodyRow";
import { bodyLines } from "../today/dayRows";
import { useWaterGoal } from "../today/useWaterGoal";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { QualityCard } from "./QualityCard";
import { FeelingSheet, SupplementSheet, WeightEntrySheet, type HealthSheetKind } from "./HealthSheets";
import { Trends } from "./Trends";
import styles from "./health.module.css";

const MORE_ITEMS: readonly ActionItem[] = [
  { id: "analysis", label: "Analisi", href: "/app/salute/analisi" },
  { id: "experiments", label: "Esperimenti", href: "/app/salute/esperimenti" },
  { id: "report", label: "Rapporto", href: "/app/salute/rapporto" },
  { id: "quality", label: "Qualità dei prodotti", href: "/app/qualita" },
];

const MARKS: readonly { kind: HealthSheetKind; label: string }[] = [
  { kind: "weight", label: "Peso" },
  { kind: "feeling", label: "Come sto" },
  { kind: "supplement", label: "Integratore" },
];

/**
 * Salute: qui si segna come si sta e si guarda come va. In cima le tre cose che si segnano (ognuna nel suo foglio),
 * poi ciò che è segnato oggi (le stesse righe della riga «Corpo» di Oggi, da toccare e correggere), poi l'andamento
 * in quattro righe richiuse. Acqua e bevande si segnano in Oggi: qui se ne vede solo l'andamento.
 */
export function Health() {
  const diary = useDiary();
  const log = useEventLog();
  const now = useNow();
  const waterGoalMl = useWaterGoal();
  const [sheet, setSheet] = useState<HealthSheetKind | null>(null);

  const state = diary.data;
  const events = log.data;
  const today = state && now ? dayOf(now, state.timeZone) : null;
  const lines = useMemo(() => (state && today ? bodyLines(getDay(state, today), state.timeZone) : []), [state, today]);
  const close = () => setSheet(null);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Salute</h1>
        <MoreActions items={MORE_ITEMS} />
      </div>

      {diary.error || log.error ? <StorageError /> : diary.loading || log.loading ? <LoadingLine /> : null}

      {state && events && today ? (
        <>
          <div className={`${styles.mark} ${ui.tile} ${ui.tone}`} data-tone="health">
            <Label>Segna</Label>
            <div className={styles.markChips} role="group" aria-label="Segna">
              {MARKS.map((mark) => (
                <button key={mark.kind} type="button" className={styles.markChip} aria-haspopup="dialog" onClick={() => setSheet(mark.kind)}>
                  {mark.label}
                </button>
              ))}
            </div>
          </div>

          {lines.length > 0 ? (
            <section className={ui.section}>
              <SectionHeader label="Oggi" />
              <div className={ui.group}>
                <BodyLines lines={lines} log={events} />
              </div>
            </section>
          ) : null}

          <QualityCard />

          <section className={ui.section}>
            <SectionHeader label="Andamento" actionLabel="Nutrizione" actionHref="/app/salute/nutrizione" />
            <Trends diary={state} today={today} waterGoalMl={waterGoalMl} />
            <div className={styles.meaning}>
              <Disclosure quiet title="Che cosa significa">
                <p>
                  Sono note tue, giorno per giorno. Dove i dati sono pochi lo dico, invece di disegnare tendenze. Nessun parere medico: per quello
                  c&apos;è il medico.
                </p>
                <p>Nel grafico del peso conta la linea, non il singolo punto: il peso oscilla da un giorno all&apos;altro.</p>
              </Disclosure>
            </div>
          </section>

          {/* fuori dal blocco tinto: i fogli non ne ereditano i colori */}
          {sheet === "weight" ? <WeightEntrySheet diary={state} today={today} onClose={close} /> : null}
          {sheet === "feeling" ? <FeelingSheet onClose={close} /> : null}
          {sheet === "supplement" ? <SupplementSheet diary={state} today={today} onClose={close} /> : null}
        </>
      ) : null}
    </div>
  );
}
