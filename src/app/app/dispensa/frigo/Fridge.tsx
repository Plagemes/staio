"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useMemo, useState } from "react";
import { activeLots, type Location } from "@/core/ledger";
import { useEventLog, usePantry } from "@/data";
import { Button, Label, Tabs } from "@/design";
import { findCreationEvent } from "@/features/actions";
import { dayOf } from "@/features/format";
import { LOCATION_LABELS } from "@/features/labels";
import { evaluateLots, isExpiring } from "@/features/lots";
import { groupEntries } from "@/features/pantry/groups";
import { LotSheet } from "@/features/pantry/LotSheet";
import { entryDetail, entryExpiry } from "@/features/pantry/rows";
import { EmptyState, LoadingLine, StorageError } from "@/features/shell/EmptyState";
import ui from "@/features/ui.module.css";
import { useNow } from "@/features/useNow";
import { furnitureForLocation, furnitureSpec } from "@/models3d/fridge/furniture";
import { sceneItemsFor } from "./items";
import styles from "./frigo.module.css";

// La scena carica three solo quando serve; sul server non c'è WebGL.
const FridgeScene = dynamic(() => import("@/models3d/fridge/FridgeScene"), {
  ssr: false,
  loading: () => <div className={styles.placeholder} aria-hidden="true" />,
});

const TAB_ITEMS = [
  { id: "frigo", label: LOCATION_LABELS.frigo },
  { id: "freezer", label: LOCATION_LABELS.freezer },
  { id: "dispensa", label: LOCATION_LABELS.dispensa },
];

export function Fridge() {
  const pantry = usePantry();
  const log = useEventLog();
  const now = useNow();
  const [place, setPlace] = useState<Location>("frigo");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [hidden, setHidden] = useState<string[]>([]);

  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );
  const inPlace = useMemo(() => entries.filter((e) => e.lot.location === place), [entries, place]);
  const items = useMemo(() => sceneItemsFor(inPlace), [inPlace]);
  const onLayout = useCallback((summary: { hidden: string[] }) => setHidden(summary.hidden), []);
  const onSelect = useCallback((id: string | null) => setSelectedId(id), []);

  if (pantry.error) return <StorageError />;
  if (!pantry.data || !now) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Frigo</h1>
        <LoadingLine />
      </div>
    );
  }

  const today = dayOf(now);
  const placeLabel = LOCATION_LABELS[place];
  const expiring = inPlace.filter(isExpiring).length;
  const selected = selectedId ? inPlace.find((e) => e.lot.lotId === selectedId) : undefined;
  const sheetEntry = sheetId ? entries.find((e) => e.lot.lotId === sheetId) : undefined;
  const sheetGroup = sheetEntry
    ? groupEntries(entries).find((g) => g.entries.length > 1 && g.entries.some((e) => e.lot.lotId === sheetEntry.lot.lotId))
    : undefined;
  const creation =
    sheetEntry && log.data ? findCreationEvent(log.data, sheetEntry.lot.lotId, pantry.data.voidedEventIds) : undefined;
  const hiddenHere = hidden.filter((id) => inPlace.some((e) => e.lot.lotId === id)).length;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>{placeLabel}</h1>
        <Link href="/app/dispensa" className={styles.back}>
          Elenco
        </Link>
      </div>

      <Tabs
        label="Luogo"
        items={TAB_ITEMS}
        value={place}
        onChange={(id) => {
          setPlace(id as Location);
          setSelectedId(null);
          setHidden([]);
        }}
      />

      {inPlace.length === 0 ? (
        <EmptyState
          title={`Niente in ${placeLabel.toLowerCase()}`}
          text="Quando aggiungi o sposti qui un alimento, lo vedi sul ripiano."
        />
      ) : (
        <>
          <FridgeScene
            kind={furnitureForLocation(place)}
            items={items}
            selectedId={selectedId}
            onSelect={onSelect}
            onLayout={onLayout}
            aspect={furnitureSpec(furnitureForLocation(place)).aspect}
            className={styles.scene}
            label={`${placeLabel} con ${inPlace.length === 1 ? "1 alimento" : `${inPlace.length} alimenti`}`}
          />
          <div className={styles.status} role="status">
            <Label>
              {inPlace.length === 1 ? "1 voce" : `${inPlace.length} voci`}
              {expiring > 0 ? ` · ${expiring} in scadenza` : ""}
            </Label>
            {hiddenHere > 0 ? (
              <p className={styles.note}>
                {hiddenHere === 1 ? "1 alimento non entra" : `${hiddenHere} alimenti non entrano`} in scena: restano fuori i meno
                urgenti. Li trovi nell&apos;elenco.
              </p>
            ) : null}
            <p className={styles.note}>
              In rosso ciò che scade presto. Una confezione più piccola è una confezione più vuota. Bottiglie e cartoni stanno nello sportello, frutta e verdura nel cassetto. Tocca un alimento per vederlo.
            </p>
          </div>

          {selected ? (
            <div className={styles.card}>
              <div className={styles.cardText}>
                <p className={styles.cardName}>{selected.lot.productRef}</p>
                <p className={styles.cardDetail}>{entryDetail(selected, today)}</p>
                {entryExpiry(selected)}
              </div>
              <Button variant="outline" onClick={() => setSheetId(selected.lot.lotId)}>
                Apri scheda
              </Button>
            </div>
          ) : null}
        </>
      )}

      {sheetEntry ? (
        <LotSheet
          key={sheetGroup ? sheetGroup.key : sheetEntry.lot.lotId}
          entry={sheetGroup ? sheetGroup.entries[0] : sheetEntry}
          creation={creation}
          group={sheetGroup?.entries}
          initialLotId={sheetEntry.lot.lotId}
          now={now}
          onClose={() => setSheetId(null)}
        />
      ) : null}
    </div>
  );
}
