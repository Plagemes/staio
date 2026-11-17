"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isLocalProduct } from "@/core/catalog";
import { dayBefore, deriveDiary, localMoment, type DiaryState, type MealKind } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import type { DeclareEvent, PurchaseEvent } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { appendEvents, getAllEvents, getDeviceId, getPantry, useDiary, useEventLog, usePantry } from "@/data";
import { useProducts } from "../nutrition/useNutrition";
import { ExpiryTag, Label, LevelBar, Value } from "@/design";
import { recipeForUnknown } from "@/models3d/fallback";
import ModelViewer from "@/models3d/ModelViewer";
import { findCreationEvent, type EditResult } from "../actions";
import { dayOf, formatCalendarDate, formatPrice, relativeDay } from "../format";
import { byNearestExpiry, entryDate } from "./groups";
import { FOOD_CATEGORY_LABELS, LOCATION_LABELS, MODEL_CATEGORY_OF } from "../labels";
import { expiryExplanation, expiryTagView, isFoodCategory, levelPercent, type PantryEntry } from "../lots";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import { buildChangeMoment, buildEaten, eatenDayOf, eventsOfMarked, undoPlacement, type Marked } from "./eaten";
import { EatenPanel, UndoneNote } from "./EatenPanel";
import { LotActions, type Eat, type Perform } from "./LotActions";
import { LotNutrition, useLotValues } from "./LotNutrition";
import { saveActions } from "./saveActions";
import styles from "./LotSheet.module.css";

interface LotSheetProps {
  entry: PantryEntry;
  creation: PurchaseEvent | DeclareEvent | undefined;
  /** Confezioni uguali raggruppate in Dispensa: si agisce su una alla volta, per prima quella che scade prima. */
  group?: readonly PantryEntry[];
  /** Quale confezione del gruppo mostrare per prima; di norma la più vicina a scadere. */
  initialLotId?: string;
  now: string;
  onClose: () => void;
}

export function LotSheet({ entry: initialEntry, creation: givenCreation, group, initialLotId, now, onClose }: LotSheetProps) {
  const log = useEventLog();
  const pantry = usePantry();
  const members = useMemo(() => (group && group.length > 1 ? byNearestExpiry(group) : []), [group]);
  const [chosenId, setChosenId] = useState<string | null>(initialLotId ?? null);
  const entry = members.find((m) => m.lot.lotId === chosenId) ?? members[0] ?? initialEntry;
  const creation = group
    ? log.data && pantry.data
      ? findCreationEvent(log.data, entry.lot.lotId, pantry.data.voidedEventIds)
      : undefined
    : givenCreation;
  const { lot } = entry;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const notice = useNotice();
  const products = useProducts();
  const diary = useDiary();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** L'ultima cosa mangiata da questa scheda: resta visibile finché la scheda è aperta. */
  const [last, setLast] = useState<{ marked: Marked; message: string } | null>(null);
  const [undoneText, setUndoneText] = useState<string | null>(null);
  /** Ciò che l'avviso dirà quando la scheda si chiude (anche perché l'alimento è finito): testo, eventi da annullare, rimando. */
  const closing = useRef<{ message: string; events: readonly AnyEvent[]; href: string } | null>(null);
  const toToday = useRef(false);
  const values = useLotValues(lot);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);

  // la scheda si chiude (o sparisce, se l'alimento è finito): l'avviso con «Annulla» e il rimando a Oggi
  useEffect(
    () => () => {
      const c = closing.current;
      if (c && !toToday.current) {
        // «Annulla» guarda il registro com'è in quel momento: il pasto si annulla solo se nessun altro consumo lo usa
        const onUndo = async () => {
          const [events, pantry] = await Promise.all([getAllEvents(), getPantry()]);
          await appendEvents(undoPlacement(c.events, events, pantry.voidedEventIds, { now: new Date().toISOString(), deviceId: await getDeviceId() }));
        };
        notice.show({ message: c.message, onUndo, link: { label: "Vedi in Oggi", href: c.href } });
      }
    },
    [notice],
  );

  const close = () => dialogRef.current?.close();

  const recipe = useMemo(
    () =>
      recipeForUnknown({
        name: lot.productRef,
        category: isFoodCategory(lot.category) ? MODEL_CATEGORY_OF[lot.category] : undefined,
        quantity: { value: lot.initial, unit: lot.unit },
      }).recipe,
    [lot.productRef, lot.category, lot.initial, lot.unit],
  );

  const perform: Perform = async (build, inline = false) => {
    setBusy(true);
    setError(null);
    try {
      const result: EditResult = build({ now: new Date().toISOString(), deviceId: await getDeviceId() });
      if (!result.ok) {
        if (!inline) setError(result.error);
        return result;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        const failed: EditResult = { ok: false, error: "Non sono riuscito a salvare. Riprova." };
        if (!inline) setError(failed.error);
        return failed;
      }
      close();
      notice.show({ message: result.message, undo: result.events });
      return null;
    } catch {
      const failed: EditResult = { ok: false, error: "Non sono riuscito a salvare sul telefono. Riprova." };
      setError(failed.error);
      return failed;
    } finally {
      setBusy(false);
    }
  };

  const diaryNow = (): DiaryState | undefined => diary.data ?? (log.data ? deriveDiary(log.data) : undefined);
  const timeZone = diary.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const today = dayOf(now, timeZone);

  /** Scrive eventi e racconta che cosa è successo: nella scheda subito, e nell'avviso quando si chiude. */
  async function write(
    build: (ctx: { now: string; deviceId: string }, state: DiaryState | undefined) => ReturnType<typeof buildEaten>,
    inline: boolean,
  ): Promise<EditResult | null> {
    setBusy(true);
    setError(null);
    const fail = (message: string): EditResult => {
      if (!inline) setError(message);
      return { ok: false, error: message };
    };
    try {
      const state = diaryNow();
      if (!state) return fail("Un attimo, sto ancora caricando. Riprova.");
      const result = build({ now: new Date().toISOString(), deviceId: await getDeviceId() }, state);
      if (!result.ok) return fail(result.error);
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) return fail("Non sono riuscito a salvare. Riprova.");
      setLast({ marked: result.marked, message: result.message });
      setUndoneText(null);
      const date = result.marked.date;
      closing.current = { message: result.message, events: result.events, href: date === dayOf(new Date().toISOString(), timeZone) ? "/app" : `/app?giorno=${date}` };
      return null;
    } catch {
      return fail("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  // il giorno di un cambio di momento è quello in cui si è mangiato, non quello di adesso (pannello aperto a cavallo della mezzanotte)
  const eatenAt = last?.marked.consumes[0]?.at;
  const eatenDay = last ? eatenDayOf(last.marked, timeZone, today) : today;
  const eatenMinutes = (eatenAt ? localMoment(eatenAt, timeZone)?.minutes : undefined) ?? 1440;

  const eat: Eat = (lots, choice, inline = false) => write((ctx, state) => buildEaten(lots, choice, ctx, state), inline);

  function changeMoment(kind: MealKind, date: string) {
    if (!last) return;
    void write((ctx, state) => buildChangeMoment(last.marked, { kind, date }, ctx, state), false);
  }

  async function undoLast() {
    if (!last) return;
    setBusy(true);
    setError(null);
    try {
      const { marked } = last;
      const [events, pantry] = await Promise.all([getAllEvents(), getPantry()]);
      await appendEvents(undoPlacement(eventsOfMarked(marked, events), events, pantry.voidedEventIds, { now: new Date().toISOString(), deviceId: await getDeviceId() }));
      setLast(null);
      closing.current = null;
      setUndoneText(`Annullato: ${marked.amount} di ${marked.name} sono tornati in dispensa e non sono più in Oggi.`);
    } catch {
      setError("Non sono riuscito ad annullare. Riprova.");
    } finally {
      setBusy(false);
    }
  }

  const tag = expiryTagView(entry);
  const partial = lot.remaining < lot.initial;
  const remainingText = formatQuantity({ value: lot.remaining, unit: lot.unit });
  const initialText = formatQuantity({ value: lot.initial, unit: lot.unit });
  const urgent = tag?.level === "urgent";
  // vicino alla scadenza «Con cosa sta bene» sta già tra le azioni per salvarlo
  const pairsShown = saveActions(entry).includes("pair");

  return (
    <dialog
      ref={dialogRef}
      className={styles.sheet}
      aria-labelledby={titleId}
      // in sviluppo React monta due volte: un evento di chiusura che arriva a pannello già riaperto va ignorato
      onClose={(e) => {
        if (!e.currentTarget.open) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className={styles.body}>
        <div className={styles.grip} aria-hidden="true" />
        <header className={styles.top}>
          <div className={styles.figure}>
            <ModelViewer recipe={recipe} seed={lot.lotId} signal={urgent} autoRotate />
          </div>
          <div className={styles.heading}>
            <h2 id={titleId} className={styles.name}>
              {lot.productRef}
            </h2>
            <p className={styles.sub}>
              {LOCATION_LABELS[lot.location]}
              {lot.openedAt ? ` · aperto ${relativeDay(dayOf(lot.openedAt), today)}` : ""}
            </p>
            {tag ? (
              <ExpiryTag level={tag.level} estimated={tag.estimated}>
                {tag.text}
              </ExpiryTag>
            ) : null}
          </div>
          <button type="button" className={styles.closeButton} onClick={close}>
            Chiudi
          </button>
        </header>

        {members.length > 1 ? (
          <div className={styles.groupPick}>
            <label htmlFor={`${titleId}-pack`} className={ui.fieldLabel}>
              Hai {members.length} confezioni uguali. Agisci su
            </label>
            <select
              id={`${titleId}-pack`}
              className={ui.input}
              value={entry.lot.lotId}
              onChange={(e) => setChosenId(e.target.value)}
            >
              {members.map((m, i) => {
                const date = entryDate(m);
                return (
                  <option key={m.lot.lotId} value={m.lot.lotId}>
                    {`Confezione ${i + 1}: ${date ? `entro il ${formatCalendarDate(date)}` : "senza data"}${i === 0 ? " (la prima a scadere)" : ""}`}
                  </option>
                );
              })}
            </select>
          </div>
        ) : null}

        <dl className={styles.data}>
          <div className={styles.dataRow}>
            <dt>
              <Label>Quantità</Label>
            </dt>
            <dd>
              <Value certainty={lot.remainingCertainty === "estimated" ? "estimated" : "measured"}>{remainingText}</Value>
              {partial ? <span className={styles.muted}> di {initialText}</span> : null}
              <LevelBar value={levelPercent(lot)} label={`Rimasto circa il ${Math.round(levelPercent(lot))} per cento`} />
            </dd>
          </div>
          <div className={styles.dataRow}>
            <dt>
              <Label>Scadenza</Label>
            </dt>
            <dd>{expiryExplanation(entry)}</dd>
          </div>
          <div className={styles.dataRow}>
            <dt>
              <Label>Categoria</Label>
            </dt>
            <dd>{isFoodCategory(lot.category) ? FOOD_CATEGORY_LABELS[lot.category] : "Non scelta"}</dd>
          </div>
          <div className={styles.dataRow}>
            <dt>
              <Label>Entrato</Label>
            </dt>
            <dd>
              {lot.origin === "purchase" ? "Acquistato" : "Già in casa"} il {formatCalendarDate(dayOf(lot.createdAt))}
            </dd>
          </div>
          {lot.priceCents !== undefined ? (
            <div className={styles.dataRow}>
              <dt>
                <Label>Prezzo</Label>
              </dt>
              <dd>
                <Value certainty={lot.priceCertainty === "estimated" ? "estimated" : "measured"}>{formatPrice(lot.priceCents)}</Value>
              </dd>
            </div>
          ) : null}
        </dl>

        <section className={styles.nutrients} aria-label="Nutrienti">
          <LotNutrition lot={lot} />
        </section>

        {pairsShown && !lot.barcode ? null : (
        <div className={ui.row}>
          {pairsShown ? null : (
            <Link href={`/app/ricette/abbinamenti?alimento=${encodeURIComponent(lot.productRef)}`} className={ui.textLink}>
              Con cosa sta bene
            </Link>
          )}
          {lot.barcode && isLocalProduct(products?.get(lot.barcode)) ? (
            <p className={ui.hint}>Valori inseriti da te</p>
          ) : lot.barcode ? (
            <Link href={`/app/qualita/prodotto?codice=${encodeURIComponent(lot.barcode)}`} className={ui.textLink}>
              Qualità
            </Link>
          ) : null}
        </div>
        )}

        {lot.remaining > 0 ? (
          <LotActions entry={entry} creation={creation} group={members} now={now} busy={busy} perform={perform} eat={eat} error={error} />
        ) : (
          <p className={ui.hint}>Di questo alimento non resta niente.</p>
        )}

        {last ? (
          <EatenPanel
            message={last.message}
            marked={last.marked}
            hasValues={values.status === "loading" ? undefined : values.status === "found"}
            today={today}
            eatenDay={eatenDay}
            yesterday={dayBefore(eatenDay)}
            offerYesterday={eatenMinutes < 4 * 60}
            busy={busy}
            onMove={changeMoment}
            onUndo={() => void undoLast()}
            onOpenToday={() => {
              toToday.current = true;
            }}
          />
        ) : undoneText ? (
          <UndoneNote text={undoneText} />
        ) : null}
      </div>
    </dialog>
  );
}
