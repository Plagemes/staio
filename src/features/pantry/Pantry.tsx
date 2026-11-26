"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useLayoutEffect, useMemo, useState } from "react";
import { activeLots, estimatedPantryValue, pantryValueParts, type Location, type PantryState } from "@/core/ledger";
import { appendEvents, getDeviceId, getPantry, useEventLog, usePantry } from "@/data";
import { Button, FoodThumb, Label, PantryRow, Tabs, Value, cx } from "@/design";
import { buildRemoveMany, type RemoveManyKind } from "../actions";
import { configIssue } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import { useReceiptDraft } from "../ai/receiptDraft";
import { BreakdownSheet, MoreActions, type ActionItem } from "../common";
import { Hint } from "../common/Hint";
import { dayOf, formatPrice } from "../format";
import { LOCATION_LABELS } from "../labels";
import { useNotice } from "../notice";
import { evaluateLots, expiryTagView, levelPercent } from "../lots";
import { piecesText } from "../pieces";
import { orderForRealign } from "../realign";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import { addManualEntries } from "../shopping";
import { foodKindOf } from "../foodKind";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { filterEntries, normalizeSearch, splitByExpiry } from "./filter";
import { breakdownText, groupEntries, groupName, type LotGroup } from "./groups";
import { LotSheet } from "./LotSheet";
import { pantryValueContent } from "./valueBreakdown";
import { LOT_WAIT_MS, lotLinkVerdict } from "./lotLink";
import { entryDetail, entryExpiry } from "./rows";
import { SelectionBar } from "./SelectionBar";
import { NOTHING_LEFT_TEXT, buildMoveSelection, listMessage, planList, planMove, shoppingNames } from "./selectionActions";
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
  const lottoParam = useSearchParams().get("lotto");
  const [tab, setTab] = useState<Tab>("all");
  const [query, setQuery] = useState("");
  const [listError, setListError] = useState<string | null>(null);
  /** La scheda aperta: il gruppo scelto e i suoi lotti, per ritrovarla quando mangiare un po' cambia il gruppo (non è più intatta). */
  const [selected, setSelected] = useState<{ key: string; lotIds: readonly string[]; initialLotId?: string } | null>(null);
  /**
   * L'alimento chiesto dall'indirizzo (`?lotto=`): la sua scheda si apre quando l'indirizzo è tornato pulito. `seen` è
   * la dispensa in cui lo si è cercato la prima volta, `waitedMs` quanto si è aspettato (`lotLinkVerdict`).
   */
  const [wanted, setWanted] = useState<{ lotId: string; seen: PantryState | null; waitedMs: number } | null>(null);
  const [missing, setMissing] = useState(false);
  const notice = useNotice();
  const pickIds = useId();
  const searchId = useId();
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [working, setWorking] = useState(false);
  const [barError, setBarError] = useState<string | null>(null);

  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );
  const toConfirm = useMemo(
    () => (pantry.data && now ? orderForRealign(activeLots(pantry.data), now).length : 0),
    [pantry.data, now],
  );
  const value = useMemo(() => (pantry.data ? estimatedPantryValue(pantry.data) : undefined), [pantry.data]);
  // «Da cosa è fatto»: il contenuto nasce dalle parti dello stesso stato, solo quando il foglio è aperto
  const [valueOpen, setValueOpen] = useState(false);
  const valueSheet = useMemo(() => (valueOpen && pantry.data && now ? pantryValueContent(pantryValueParts(pantry.data), now) : null), [valueOpen, pantry.data, now]);
  // uno scontrino lasciato a metà si propone qui; si riprende solo con un tocco
  const receiptDraft = useReceiptDraft(now);
  const ai = useAiSettings();
  const canResume = receiptDraft.draft !== undefined && ai.ready && configIssue(ai.settings) === null;

  // `?lotto=` si legge una volta e si toglie subito dall'indirizzo, prima che la scheda si apra (`replaceState`, che il
  // router integra: indirizzo e router restano d'accordo). Così la scheda si apre come con un tocco e chiuderla è un
  // semplice passo indietro, senza navigazioni che corrono contro il foglio.
  if (lottoParam !== null && lottoParam !== wanted?.lotId) setWanted({ lotId: lottoParam, seen: null, waitedMs: 0 });
  useEffect(() => {
    if (lottoParam === null) return;
    const url = new URL(window.location.href);
    url.searchParams.delete("lotto");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [lottoParam]);

  // l'attesa di un alimento che non c'è ancora: passato il tempo, si ridisegna e `lotLinkVerdict` decide
  const wantedId = wanted?.lotId ?? null;
  useEffect(() => {
    if (wantedId === null) return;
    const timer = window.setTimeout(() => setWanted((w) => (w?.lotId === wantedId ? { ...w, waitedMs: LOT_WAIT_MS } : w)), LOT_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [wantedId]);

  // La pagina resta viva tra una visita e l'altra: ciò che è solo di passaggio se ne va uscendo. Il luogo scelto resta.
  useLayoutEffect(
    () => () => {
      setMissing(false);
      setQuery("");
      setListError(null);
      setSelecting(false);
      setPicked(new Set());
      setBarError(null);
      setValueOpen(false);
    },
    [],
  );

  const stopSelecting = () => {
    setSelecting(false);
    setPicked(new Set());
    setBarError(null);
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

  const allGroups = groupEntries(entries);
  if (wanted !== null && lottoParam === null) {
    // Si rifà a ogni disegno finché la richiesta è aperta: subito dopo un salvataggio la dispensa in mano può essere
    // ancora quella di prima, e l'alimento compare con lo stato dopo.
    const linked = allGroups.find((g) => g.entries.some((e) => e.lot.lotId === wanted.lotId));
    const verdict = lotLinkVerdict({ found: linked !== undefined, stateChanged: wanted.seen !== null && wanted.seen !== pantry.data, waitedMs: wanted.waitedMs });
    if (verdict === "wait") {
      if (wanted.seen === null) setWanted({ ...wanted, seen: pantry.data });
    } else {
      setWanted(null);
      if (linked) setSelected({ key: linked.key, lotIds: linked.entries.map((e) => e.lot.lotId), initialLotId: wanted.lotId });
      else setMissing(true);
    }
  }
  const selectedGroup = selected
    ? (allGroups.find((g) => g.key === selected.key) ?? allGroups.find((g) => g.entries.some((e) => selected.lotIds.includes(e.lot.lotId))))
    : undefined;
  // L'ultima confezione se n'è andata mentre la scheda era aperta: la scheda sparisce e non si riapre.
  if (selected && !selectedGroup) setSelected(null);

  const today = dayOf(now);
  const searching = normalizeSearch(query) !== "";
  // Con un testo scritto la ricerca vale in tutti i luoghi.
  const shown = searching ? filterEntries(entries, query) : tab === "all" ? entries : entries.filter((e) => e.lot.location === tab);
  const pickedLots = shown.filter((e) => picked.has(e.lot.lotId)).map((e) => e.lot);
  const groups = groupEntries(shown);
  const { expiring, rest } = splitByExpiry(groups);
  const queryText = query.trim().replace(/\s+/g, " ");

  async function removePicked(kind: RemoveManyKind) {
    if (!pantry.data || !log.data) return;
    setWorking(true);
    setBarError(null);
    try {
      const result = buildRemoveMany(pickedLots, kind, log.data, pantry.data.voidedEventIds, {
        now: new Date().toISOString(),
        deviceId: await getDeviceId(),
      });
      if (!result.ok) {
        setBarError(result.error);
        return;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setBarError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      stopSelecting();
      notice.show({ message: result.message, undo: result.events });
    } catch {
      setBarError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setWorking(false);
    }
  }

  /** «Sposta»: una sola scrittura per tutte le confezioni; prima si rilegge la dispensa, perché qualcuna può essere cambiata. */
  async function movePicked(to: Location) {
    if (working) return;
    const ids = pickedLots.map((l) => l.lotId);
    setWorking(true);
    setBarError(null);
    try {
      const plan = planMove(activeLots(await getPantry()), ids, to);
      const result = buildMoveSelection(plan, to, { now: new Date().toISOString(), deviceId: await getDeviceId() });
      if (!result.ok) {
        setBarError(result.error);
        return;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setBarError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      stopSelecting();
      notice.show({ message: result.message, undo: result.events });
    } catch {
      setBarError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setWorking(false);
    }
  }

  /** «Aggiungi alla spesa»: un nome per prodotto, una unità come col «+»; la lista è un'impostazione, non il registro. */
  async function addPickedToList() {
    if (working) return;
    const ids = pickedLots.map((l) => l.lotId);
    setWorking(true);
    setBarError(null);
    try {
      const { lots, gone } = planList(activeLots(await getPantry()), ids);
      const names = shoppingNames(lots);
      if (names.length === 0) {
        setBarError(NOTHING_LEFT_TEXT);
        return;
      }
      const result = await addManualEntries(names.map((product) => ({ product, quantity: { value: 1, unit: "pz" as const } })));
      if (result.added === 0) {
        setBarError("Non sono riuscito ad aggiungerli alla spesa. Riprova.");
        return;
      }
      stopSelecting();
      notice.show({ message: listMessage(names, gone), onUndo: result.undo, link: { label: "Vedi", href: "/app/spesa" } });
    } catch {
      setBarError("Non sono riuscito ad aggiungerli alla spesa. Riprova.");
    } finally {
      setWorking(false);
    }
  }

  /** Mette in lista ciò che si è cercato e non c'è: una unità, che si cambia poi nella lista. */
  async function addSearchToList() {
    setListError(null);
    try {
      const result = await addManualEntries([{ product: queryText, quantity: { value: 1, unit: "pz" } }]);
      if (result.added === 0) return;
      notice.show({ message: `Aggiunto alla lista della spesa: ${queryText}.`, onUndo: result.undo });
    } catch {
      setListError("Non sono riuscito ad aggiungerlo alla spesa. Riprova.");
    }
  }

  const moreItems: ActionItem[] = [];
  if (entries.length > 0) {
    if (!selecting) moreItems.push({ id: "select", label: "Seleziona più alimenti", onSelect: () => setSelecting(true) });
    if (toConfirm > 0) moreItems.push({ id: "realign", label: `Controlla le quantità (${toConfirm})`, href: "/app/dispensa/riallinea" });
    moreItems.push(
      { id: "ideas", label: "Cosa cucinare", href: "/app/ricette/idee" },
      { id: "fridge", label: "Vedi in 3D", href: "/app/dispensa/frigo" },
      { id: "photo", label: "Controlla con una foto", href: "/app/dispensa/foto" },
    );
  }

  const renderGroup = (group: LotGroup) => {
    const entry = group.entries[0];
    const lotIds = group.entries.map((e) => e.lot.lotId);
    const allPicked = lotIds.every((id) => picked.has(id));
    const detailBreakdown = breakdownText(group);
    const row = (
      <PantryRow
        name={groupName(group)}
        thumb={<FoodThumb kind={foodKindOf(entry.lot.category)} />}
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
              onClick={() => {
                setMissing(false);
                // chi tocca un alimento mentre quello dell'indirizzo è atteso ha scelto che cosa guardare
                setWanted(null);
                setSelected({ key: group.key, lotIds });
              }}
            />
          </>
        )}
      </li>
    );
  };

  const renderList = (list: LotGroup[], title: string | null, soon = false) => (
    <div className={cx(styles.block, soon && styles.soon)}>
      {title ? (
        <Label as="h2" className={styles.groupLabel}>
          {`${title} (${list.length})`}
        </Label>
      ) : null}
      <ul className={`${styles.list} ${ui.group}`}>{list.map(renderGroup)}</ul>
    </div>
  );

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Dispensa</h1>
        <div className={styles.headTools}>
          <Label>{entries.length === 1 ? "1 voce" : `${entries.length} voci`}</Label>
          <MoreActions items={moreItems} />
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
            Chiudi la selezione
          </button>
        </div>
      ) : null}

      {canResume ? (
        <div className={`${ui.callout} ${styles.checkRow}`}>
          <span>Hai uno scontrino a metà</span>
          <Link href="/app/cattura/scontrino?riprendi=1" className={styles.checkLink}>
            Riprendi
          </Link>
        </div>
      ) : null}

      {missing ? <p className={ui.callout}>Questo alimento non c&apos;è più.</p> : null}

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
          <div className={styles.section}>
            <div>
              <label htmlFor={searchId} className={ui.srOnly}>
                Cerca in dispensa
              </label>
              <input
                id={searchId}
                type="search"
                className={ui.input}
                placeholder="Cerca in dispensa"
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setListError(null);
                }}
              />
            </div>
            <Tabs
              label="Luogo"
              items={TAB_ITEMS}
              value={tab}
              onChange={(id) => {
                setTab(id as Tab);
                setPicked(new Set());
              }}
            />
            {toConfirm > 0 ? (
              <div className={`${ui.callout} ${styles.checkRow}`}>
                <span>{toConfirm === 1 ? "1 quantità da controllare" : `${toConfirm} quantità da controllare`}</span>
                <Link href="/app/dispensa/riallinea" className={styles.checkLink}>
                  Controlla
                </Link>
              </div>
            ) : null}
            {!searching && !selecting ? <Hint id="pantryRow" /> : null}
            <div className={styles.lists} role="tabpanel" aria-label={searching ? "Risultati della ricerca" : TAB_ITEMS.find((t) => t.id === tab)?.label}>
              {shown.length === 0 && searching ? (
                <div className={ui.empty}>
                  <p className={ui.emptyText}>{`Nessun alimento con “${queryText}”.`}</p>
                  <Button variant="outline" onClick={() => void addSearchToList()}>
                    {`Aggiungi “${queryText}” alla spesa`}
                  </Button>
                  {listError ? (
                    <p className={ui.error} role="alert">
                      {listError}
                    </p>
                  ) : null}
                </div>
              ) : shown.length === 0 ? (
                <EmptyState
                  title={`Niente in ${tab === "all" ? "dispensa" : LOCATION_LABELS[tab as Location].toLowerCase()}`}
                  text="Quando aggiungi o sposti qui un alimento, lo trovi in questo elenco."
                />
              ) : (
                <>
                  {/* Senza nulla in scadenza l'elenco è uno solo e senza etichetta; con l'altro gruppo vuoto resta il titolo di chi scade. */}
                  {expiring.length > 0 ? renderList(expiring, "In scadenza", true) : null}
                  {rest.length > 0 ? renderList(rest, expiring.length > 0 ? "Il resto" : null) : null}
                </>
              )}
            </div>
          </div>
          {value && value.lotsWithPrice > 0 ? (
            <p className={styles.value}>
              <button type="button" className={styles.valueTap} aria-haspopup="dialog" onClick={() => setValueOpen(true)}>
                Valore stimato: {value.lotsWithoutPrice > 0 ? "almeno " : ""}
                <Value certainty={value.certainty === "estimated" ? "estimated" : "measured"}>{formatPrice(value.cents)}</Value>
              </button>
            </p>
          ) : null}
        </>
      )}

      {selecting ? (
        <>
          <div className={styles.barSpace} aria-hidden="true" />
          <SelectionBar
            key={pickedLots.length === 0 ? "empty" : "some"}
            count={pickedLots.length}
            products={new Set(pickedLots.map((l) => l.barcode ?? l.productRef.trim().toLowerCase())).size}
            busy={working || !log.data}
            error={barError}
            onRemove={(kind) => void removePicked(kind)}
            onMove={(to) => void movePicked(to)}
            onAddToList={() => void addPickedToList()}
            onClearError={() => setBarError(null)}
          />
        </>
      ) : null}

      {valueSheet ? <BreakdownSheet {...valueSheet} onClose={() => setValueOpen(false)} /> : null}

      {selectedGroup ? (
        <LotSheet
          key={selected?.key}
          entry={selectedGroup.entries[0]}
          creation={undefined}
          group={selectedGroup.entries}
          initialLotId={selected?.initialLotId}
          now={now}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}
