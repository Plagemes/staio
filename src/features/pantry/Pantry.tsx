"use client";

import { useMemo, useState } from "react";
import { activeLots, estimatedPantryValue, type Location } from "@/core/ledger";
import { useEventLog, usePantry } from "@/data";
import { Figure, FigureGrid, Label, PantryRow, Tabs, Value } from "@/design";
import { findCreationEvent } from "../actions";
import { dayOf, formatPrice } from "../format";
import { LOCATION_LABELS } from "../labels";
import { evaluateLots, isExpiring, levelPercent } from "../lots";
import { entryDetail, entryExpiry } from "./rows";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { LotSheet } from "./LotSheet";
import styles from "./Pantry.module.css";

type Tab = "all" | Location;

const TAB_ITEMS = [
  { id: "all", label: "Tutto" },
  { id: "frigo", label: LOCATION_LABELS.frigo },
  { id: "freezer", label: LOCATION_LABELS.freezer },
  { id: "dispensa", label: LOCATION_LABELS.dispensa },
];

export function Pantry() {
  const pantry = usePantry();
  const log = useEventLog();
  const now = useNow();
  const [tab, setTab] = useState<Tab>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );
  const value = useMemo(() => (pantry.data ? estimatedPantryValue(pantry.data) : undefined), [pantry.data]);

  if (pantry.error) return <StorageError />;
  if (!pantry.data || !now) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Dispensa</h1>
        <LoadingLine />
      </div>
    );
  }

  const today = dayOf(now);
  const shown = tab === "all" ? entries : entries.filter((e) => e.lot.location === tab);
  const expiring = entries.filter(isExpiring).length;
  const selected = selectedId ? entries.find((e) => e.lot.lotId === selectedId) : undefined;
  const creation =
    selected && log.data ? findCreationEvent(log.data, selected.lot.lotId, pantry.data.voidedEventIds) : undefined;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Dispensa</h1>
        <Label>{entries.length === 1 ? "1 voce" : `${entries.length} voci`}</Label>
      </div>

      {entries.length === 0 ? (
        <EmptyState
          title="La dispensa è vuota"
          text="Qui comparirà ciò che aggiungi: quanto ne resta, dove sta e quando scade. Il resto lo ricostruisce il registro."
        />
      ) : (
        <>
          <FigureGrid>
            <Figure label="Voci">
              <Value>{entries.length}</Value>
            </Figure>
            <Figure label="In scadenza" tone={expiring > 0 ? "signal" : "default"}>
              <Value>{expiring}</Value>
            </Figure>
            <Figure label="Valore">
              {value && value.lotsWithPrice > 0 ? (
                <Value certainty={value.certainty === "estimated" ? "estimated" : "measured"}>{formatPrice(value.cents)}</Value>
              ) : (
                <Value certainty="untracked" />
              )}
            </Figure>
          </FigureGrid>

          <div>
            <Tabs label="Luogo" items={TAB_ITEMS} value={tab} onChange={(id) => setTab(id as Tab)} />
            <div role="tabpanel" aria-label={TAB_ITEMS.find((t) => t.id === tab)?.label}>
              {shown.length === 0 ? (
                <EmptyState
                  title={`Niente in ${tab === "all" ? "dispensa" : LOCATION_LABELS[tab as Location].toLowerCase()}`}
                  text="Quando aggiungi o sposti qui un alimento, lo trovi in questo elenco."
                />
              ) : (
                <ul className={styles.list}>
                  {shown.map((entry) => (
                    <li key={entry.lot.lotId} className={styles.item}>
                      <PantryRow
                        name={entry.lot.productRef}
                        detail={entryDetail(entry, today)}
                        level={levelPercent(entry.lot)}
                        levelLabel={`Rimasto circa il ${Math.round(levelPercent(entry.lot))} per cento`}
                        expiry={entryExpiry(entry)}
                      />
                      <button
                        type="button"
                        className={styles.open}
                        aria-label={`Apri ${entry.lot.productRef}`}
                        onClick={() => setSelectedId(entry.lot.lotId)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </>
      )}

      {selected ? (
        <LotSheet key={selected.lot.lotId} entry={selected} creation={creation} now={now} onClose={() => setSelectedId(null)} />
      ) : null}
    </div>
  );
}
