"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { activeLots, estimatedPantryValue, type Location } from "@/core/ledger";
import { appendEvents, getDeviceId, useEventLog, usePantry } from "@/data";
import { Figure, FigureGrid, Label, PantryRow, Tabs, Value } from "@/design";
import { buildRemoveMany, type RemoveManyKind } from "../actions";
import { dayOf, formatPrice } from "../format";
import { LOCATION_LABELS } from "../labels";
import { useNotice } from "../notice";
import { evaluateLots, expiryTagView, isExpiring, levelPercent } from "../lots";
import { piecesText } from "../pieces";
import { breakdownText, groupEntries, groupName } from "./groups";
import { entryDetail, entryExpiry } from "./rows";
import { orderForRealign } from "../realign";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { LotSheet } from "./LotSheet";
import { SelectionBar } from "./SelectionBar";
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
  /** La scheda aperta: il gruppo scelto e i suoi lotti, per ritrovarla quando mangiare un po' cambia il gruppo (non è più intatta). */
  const [selected, setSelected] = useState<{ key: string; lotIds: readonly string[] } | null>(null);
  const notice = useNotice();
  const pickIds = useId();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );
  const toConfirm = useMemo(
    () => (pantry.data && now ? orderForRealign(activeLots(pantry.data), now).length : 0),
    [pantry.data, now],
  );
  const value = useMemo(() => (pantry.data ? estimatedPantryValue(pantry.data) : undefined), [pantry.data]);

  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
    setRemoveError(null);
  };
  const togglePicked = (lotIds: readonly string[], on: boolean) =>
    setPicked((prev) => {
      const next = new Set(prev);
      for (const id of lotIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

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
  const pickedLots = shown.filter((e) => picked.has(e.lot.lotId)).map((e) => e.lot);

  async function removePicked(kind: RemoveManyKind) {
    if (!pantry.data || !log.data) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const result = buildRemoveMany(pickedLots, kind, log.data, pantry.data.voidedEventIds, {
        now: new Date().toISOString(),
        deviceId: await getDeviceId(),
      });
      if (!result.ok) {
        setRemoveError(result.error);
        return;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setRemoveError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      stopSelecting();
      notice.show({ message: result.message, undo: result.events });
    } catch {
      setRemoveError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setRemoving(false);
    }
  }

  const groups = groupEntries(shown);
  const allGroups = selected ? groupEntries(entries) : [];
  const selectedGroup = selected
    ? (allGroups.find((g) => g.key === selected.key) ?? allGroups.find((g) => g.entries.some((e) => selected.lotIds.includes(e.lot.lotId))))
    : undefined;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Dispensa</h1>
        <div className={styles.headTools}>
          {entries.length > 0 && !selecting ? (
            <button type="button" className={styles.tool} onClick={() => setSelecting(true)}>
              Seleziona
            </button>
          ) : null}
          <Label>{entries.length === 1 ? "1 voce" : `${entries.length} voci`}</Label>
        </div>
      </div>
      {selecting ? (
        <div className={styles.headTools}>
          <button
            type="button"
            className={styles.tool}
            onClick={() => setPicked(new Set(shown.map((e) => e.lot.lotId)))}
            disabled={shown.length === 0 || pickedLots.length === shown.length}
          >
            Seleziona tutti
          </button>
          <button type="button" className={styles.tool} onClick={stopSelecting}>
            Annulla selezione
          </button>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState
          title="La dispensa è vuota"
          text="Segna la prima cosa che hai in casa: poi vedrai quanto ne resta, dove sta e quando scade."
          actionLabel="Aggiungi alla dispensa"
          actionHref="/app/cattura/veloce"
          secondaryLabel="Leggi un codice a barre"
          secondaryHref="/app/cattura/codice"
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
            <Tabs label="Luogo" items={TAB_ITEMS} value={tab} onChange={(id) => {
                setTab(id as Tab);
                setPicked(new Set());
              }} />
            <div role="tabpanel" aria-label={TAB_ITEMS.find((t) => t.id === tab)?.label}>
              {shown.length === 0 ? (
                <EmptyState
                  title={`Niente in ${tab === "all" ? "dispensa" : LOCATION_LABELS[tab as Location].toLowerCase()}`}
                  text="Quando aggiungi o sposti qui un alimento, lo trovi in questo elenco."
                />
              ) : (
                <ul className={`${styles.list} ${ui.group}`}>
                  {groups.map((group) => {
                    const entry = group.entries[0];
                    const lotIds = group.entries.map((e) => e.lot.lotId);
                    const allPicked = lotIds.every((id) => picked.has(id));
                    const detailBreakdown = breakdownText(group);
                    const row = (
                      <PantryRow
                        name={groupName(group)}
                        detail={
                          detailBreakdown ? (
                            <>
                              {LOCATION_LABELS[entry.lot.location]} · {detailBreakdown}
                              {piecesText(group.entries.map((e) => e.lot)) ? ` · ${piecesText(group.entries.map((e) => e.lot))}` : ""}
                            </>
                          ) : (
                            entryDetail(entry, today, group.entries)
                          )
                        }
                        level={levelPercent(entry.lot)}
                        levelLabel={`Rimasto circa il ${Math.round(levelPercent(entry.lot))} per cento`}
                        expiry={entryExpiry(entry)}
                      />
                    );
                    return (
                      <li key={group.key} className={`${selecting ? styles.itemPick : styles.item} ${ui.stateRow}`} data-state={expiryTagView(entry)?.level}>
                        {selecting ? (
                          <>
                            <span className={styles.checkCell}>
                              <input
                                id={`${pickIds}-${group.key}`}
                                type="checkbox"
                                className={styles.check}
                                checked={allPicked}
                                onChange={() => togglePicked(lotIds, !allPicked)}
                                aria-label={`Seleziona ${groupName(group)}`}
                              />
                            </span>
                            <label htmlFor={`${pickIds}-${group.key}`} className={allPicked ? styles.picked : undefined}>
                              {row}
                            </label>
                          </>
                        ) : (
                          <>
                            {row}
                            <button
                              type="button"
                              className={styles.open}
                              aria-label={`Apri ${groupName(group)}`}
                              onClick={() => setSelected({ key: group.key, lotIds: lotIds })}
                            />
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
          {toConfirm > 0 ? (
            <div className={`${styles.realign} ${ui.tile} ${ui.tone}`} data-tone="near">
              <div className={styles.realignText}>
                <span className={styles.realignTitle}>
                  {toConfirm === 1 ? "1 quantità da controllare" : `${toConfirm} quantità da controllare`}
                </span>
                <span className={styles.realignHint}>Sono stime o non le guardi da una settimana. Basta un minuto.</span>
              </div>
              <Link href="/app/dispensa/riallinea" className={styles.realignLink}>
                Riallinea
              </Link>
            </div>
          ) : null}
          <div className={`${styles.photoRow} ${ui.tile} ${ui.tone}`} data-tone="plan">
            <span className={styles.realignText}>
              <span className={styles.realignTitle}>Cosa cucinare</span>
              <span className={styles.realignHint}>Idee di ricette con ciò che hai, a partire da ciò che scade.</span>
            </span>
            <Link href="/app/ricette/idee" className={styles.realignLink}>
              Apri
            </Link>
          </div>
          <div className={`${styles.photoRow} ${ui.tile} ${ui.tone}`} data-tone="pantry">
            <span className={styles.realignText}>
              <span className={styles.realignTitle}>Vedi in 3D</span>
              <span className={styles.realignHint}>Il frigo come lo trovi aprendolo.</span>
            </span>
            <Link href="/app/dispensa/frigo" className={styles.realignLink}>
              Apri
            </Link>
          </div>
          <div className={`${styles.photoRow} ${ui.tile} ${ui.tone}`} data-tone="capture">
            <span className={styles.realignText}>
              <span className={styles.realignTitle}>Controlla con una foto</span>
              <span className={styles.realignHint}>Fotografa uno scaffale e confronta con la dispensa.</span>
            </span>
            <Link href="/app/dispensa/foto" className={styles.realignLink}>
              Apri
            </Link>
          </div>
        </>
      )}

      {selecting ? (
        <>
          <div className={styles.barSpace} aria-hidden="true" />
          <SelectionBar
            key={pickedLots.length === 0 ? "empty" : "some"}
            count={pickedLots.length}
            products={new Set(pickedLots.map((l) => l.barcode ?? l.productRef.trim().toLowerCase())).size}
            busy={removing || !log.data}
            error={removeError}
            onRemove={(kind) => void removePicked(kind)}
          />
        </>
      ) : null}

      {selectedGroup ? (
        <LotSheet
          key={selected?.key}
          entry={selectedGroup.entries[0]}
          creation={undefined}
          group={selectedGroup.entries}
          now={now}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
