"use client";

import Link from "next/link";
import { useMemo } from "react";
import { activeLots } from "@/core/ledger";
import { useEventLog, usePantry } from "@/data";
import { LedgerRow, Label, PantryRow, SectionHeader, Value, Wordmark } from "@/design";
import { dayOf, formatDayLabel } from "../format";
import { buildJournal } from "../journal";
import { evaluateLots, levelPercent } from "../lots";
import { entryDetail, entryExpiry } from "../pantry/rows";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import styles from "./Today.module.css";

const EAT_FIRST_COUNT = 4;

export function Today() {
  const pantry = usePantry();
  const log = useEventLog();
  const now = useNow();

  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );
  const rows = useMemo(
    () => (pantry.data && log.data && now ? buildJournal(log.data, pantry.data, dayOf(now)) : []),
    [pantry.data, log.data, now],
  );

  const ready = pantry.data !== undefined && log.data !== undefined && now !== null;
  const today = now ? dayOf(now) : "";

  return (
    <div className={ui.screen}>
      <h1 className={ui.srOnly}>Oggi</h1>
      <div className={styles.topbar}>
        <Wordmark />
        <div className={styles.topRight}>
          {now ? <Label>{formatDayLabel(now)}</Label> : null}
          <Link href="/app/impostazioni" className={styles.settings} aria-label="Impostazioni">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M5.6 18.4l1.8-1.8M16.6 7.4l1.8-1.8" />
            </svg>
          </Link>
        </div>
      </div>

      {pantry.error || log.error ? <StorageError /> : null}
      {!ready && !pantry.error && !log.error ? <LoadingLine /> : null}

      {ready ? (
        <>
          <section className={ui.section}>
            <SectionHeader label="Da mangiare prima" actionLabel="Tutta la dispensa" actionHref="/app/dispensa" />
            {entries.length === 0 ? (
              <EmptyState
                title="Ancora niente da mangiare"
                text="Qui comparirà ciò che scade per primo, in ordine. Comincia aggiungendo quello che hai in casa."
              />
            ) : (
              <ul className={styles.list}>
                {entries.slice(0, EAT_FIRST_COUNT).map((entry) => (
                  <li key={entry.lot.lotId}>
                    <PantryRow
                      name={entry.lot.productRef}
                      detail={entryDetail(entry, today)}
                      level={levelPercent(entry.lot)}
                      levelLabel={`Rimasto circa il ${Math.round(levelPercent(entry.lot))} per cento`}
                      expiry={entryExpiry(entry)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={ui.section}>
            <SectionHeader label="Registro di oggi" />
            {rows.length === 0 ? (
              <EmptyState
                title="Oggi non è ancora successo niente"
                text="Quando aggiungi, mangi, apri, sposti o butti qualcosa, lo trovi qui con l'orario e la quantità."
                actionLabel="Aggiungi il primo alimento"
              />
            ) : (
              <ul className={styles.list}>
                {rows.map((row) => (
                  <li key={row.id}>
                    <LedgerRow
                      time={row.time}
                      description={row.description}
                      value={row.estimated ? <Value certainty="estimated">{row.value}</Value> : row.value}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
