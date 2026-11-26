"use client";

import Link from "next/link";
import { useMemo } from "react";
import { PantryRow } from "@/design";
import { ideasHref } from "../ai-capture/ideasFood";
import { Disclosure } from "../common";
import { LOCATION_LABELS } from "../labels";
import { expiryTagView, isExpiring, levelPercent, type PantryEntry } from "../lots";
import { breakdownText, groupEntries, groupName } from "../pantry/groups";
import { entryDetail, entryExpiry } from "../pantry/rows";
import ui from "../ui.module.css";
import { expiringSummary } from "./summaries";
import styles from "./Today.module.css";

/**
 * «In scadenza»: una riga richiusa che dice quanti alimenti sono scaduti o scadono entro tre giorni, e qual è il primo.
 * Dentro, una riga per alimento che si tocca per intero e apre la sua scheda in Dispensa (dove «Sposta in freezer» è in
 * testa e il resto in «Altro»); in fondo «Cosa cucinare» e «Tutta la dispensa». Non compare se non c'è niente in scadenza.
 */
export function Expiring({ entries, today }: { entries: readonly PantryEntry[]; today: string }) {
  // `entries` arriva nell'ordine «da mangiare prima»: il primo gruppo è quello che scade prima
  const groups = useMemo(() => groupEntries(entries.filter(isExpiring)), [entries]);
  if (groups.length === 0) return null;

  return (
    <Disclosure title="In scadenza" summary={expiringSummary(groups[0].entries[0], groups.length)}>
      <ul className={styles.list}>
        {groups.map((group) => {
          const entry = group.entries[0];
          const breakdown = breakdownText(group);
          return (
            <li key={group.key} className={ui.stateRow} data-state={expiryTagView(entry)?.level}>
              <Link href={`/app/dispensa?lotto=${encodeURIComponent(entry.lot.lotId)}`} className={styles.rowLink}>
                <PantryRow
                  name={groupName(group)}
                  detail={
                    breakdown ? (
                      <>
                        {LOCATION_LABELS[entry.lot.location]} · {breakdown}
                      </>
                    ) : (
                      entryDetail(entry, today)
                    )
                  }
                  level={levelPercent(entry.lot)}
                  levelLabel={`Rimasto circa il ${Math.round(levelPercent(entry.lot))} per cento`}
                  expiry={entryExpiry(entry)}
                />
              </Link>
            </li>
          );
        })}
      </ul>
      <div className={ui.row}>
        <Link href={groups.length === 1 ? ideasHref(groupName(groups[0])) : "/app/ricette/idee"} className={ui.textLink}>
          Cosa cucinare
        </Link>
        <Link href="/app/dispensa" className={ui.textLink}>
          Tutta la dispensa
        </Link>
      </div>
    </Disclosure>
  );
}
