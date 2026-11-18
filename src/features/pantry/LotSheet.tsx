"use client";

// La scheda di un alimento: quanto ne resta e un solo pulsante pieno, «Mangiato», con la quantità già scelta.
// «Buttato» e «Aperto» sono accanto, il resto è dietro «Altro». Ogni azione riuscita chiude la scheda e lascia
// l'avviso con «Annulla»; un errore resta scritto dentro la scheda.
import { useId, useMemo, useRef, useState, type ReactNode } from "react";
import { isLocalProduct } from "@/core/catalog";
import { deriveDiary, type DiaryState } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { buildLotStory, type DeclareEvent, type Location, type PurchaseEvent } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { appendEvents, getAllEvents, getDeviceId, getPantry, useDiary, useEventLog, usePantry } from "@/data";
import { Button, ExpiryTag, Label, LevelBar, Value } from "@/design";
import { recipeForUnknown } from "@/models3d/fallback";
import ModelViewer from "@/models3d/ModelViewer";
import { buildOpen, findCreationEvent, type EditResult } from "../actions";
import { Disclosure, QuantityPicker, Sheet, type QuantityValue } from "../common";
import { dayOf, formatCalendarDate, formatPrice, relativeDay } from "../format";
import { FOOD_CATEGORY_LABELS, LOCATION_LABELS, MODEL_CATEGORY_OF } from "../labels";
import { evaluateLots, expiryExplanation, expiryTagView, isFoodCategory, levelPercent, previewExpiryAfterMove, type PantryEntry } from "../lots";
import { useNotice } from "../notice";
import { useProducts } from "../nutrition/useNutrition";
import { addManualEntries } from "../shopping";
import ui from "../ui.module.css";
import { buildEaten, inSentence, undoPlacement } from "./eaten";
import { byNearestExpiry, entryDate } from "./groups";
import { LotActions, type Perform, type Step } from "./LotActions";
import { LotHistory } from "./LotHistory";
import { LotNutrition, lotValuesSummary, useLotValues } from "./LotNutrition";
import { amountFor, amountLabel, quantityOptions, remembersPortion } from "./quantityOptions";
import { SAVE_LABELS, saveActions } from "./saveActions";
import { storyLines, storySummary } from "./storyText";
import { rememberPortion, useUsualPortion } from "./usePortions";
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

/** «17 nov»: l'anno si scrive solo se non è quello in corso. */
function shortDate(date: string, today: string): string {
  const text = formatCalendarDate(date);
  return date.slice(0, 4) === today.slice(0, 4) ? text.replace(/\s\d{4}$/, "") : text;
}

/** Una frase che finisce con un punto solo. */
const sentence = (text: string): string => `${text.replace(/\.+$/, "")}.`;

export function LotSheet({ entry: initialEntry, creation: givenCreation, group, initialLotId, now, onClose }: LotSheetProps) {
  const log = useEventLog();
  const pantry = usePantry();
  const diary = useDiary();
  const products = useProducts();
  const notice = useNotice();
  const ids = useId();
  /** Dove i passi di conferma mettono il loro pulsante pieno: la riga del piede, accanto a «Indietro». */
  const [actionSlot, setActionSlot] = useState<HTMLDivElement | null>(null);
  const members = useMemo(() => (group && group.length > 1 ? byNearestExpiry(group) : []), [group]);
  const [chosenId, setChosenId] = useState<string | null>(initialLotId ?? null);
  const entry = members.find((m) => m.lot.lotId === chosenId) ?? members[0] ?? initialEntry;
  const { lot } = entry;
  const registryRead = log.data !== undefined && pantry.data !== undefined;
  const ownCreation = log.data && pantry.data ? findCreationEvent(log.data, lot.lotId, pantry.data.voidedEventIds) : undefined;
  // per un gruppo la creazione data è quella della prima confezione, non di quella scelta
  const creation = group ? ownCreation : (givenCreation ?? ownCreation);

  const [step, setStep] = useState<Step>("main");
  /** Luogo con cui si apre «Sposta»: il freezer se si arriva da «Sposta in freezer». */
  const [moveTo, setMoveTo] = useState<Location | undefined>();
  /** La quantità scelta a mano; `undefined` finché non si tocca il selettore: vale quella proposta. */
  const [picked, setPicked] = useState<QuantityValue | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const values = useLotValues(lot);
  const usual = useUsualPortion(lot.productRef, lot.unit);

  const recipe = useMemo(
    () =>
      recipeForUnknown({
        name: lot.productRef,
        category: isFoodCategory(lot.category) ? MODEL_CATEGORY_OF[lot.category] : undefined,
        quantity: { value: lot.initial, unit: lot.unit },
      }).recipe,
    [lot.productRef, lot.category, lot.initial, lot.unit],
  );

  const timeZone = diary.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const today = dayOf(now, timeZone);
  const choices = quantityOptions({ lot, group: members.map((m) => m.lot), usual });
  const amount = picked === undefined ? choices.initial : picked;

  const go = (next: Step) => {
    setStep(next);
    setError(null);
  };
  /** Un passo indietro: da «Date diverse» a «Correggi», da ogni altro passo alla scheda. Lo fa «Indietro» nel piede e lo fa il tasto indietro del telefono. */
  const stepBack = () => go(step === "dates" ? "correct" : "main");

  // la storia compare quando il registro è stato letto: prima mancherebbero i pasti, i prezzi e i campi corretti
  const story = useMemo(() => {
    if (!log.data) return undefined;
    const rows = buildLotStory(lot, log.data);
    if (rows.length === 0) return undefined;
    return {
      summary: storySummary(rows, { timeZone, now }),
      lines: storyLines(rows, { unit: lot.unit, diary: diary.data, timeZone, now }),
    };
  }, [lot, log.data, diary.data, timeZone, now]);

  /** Una scrittura alla volta: un secondo tocco mentre la prima è in corso non fa niente. */
  const begin = (): boolean => {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    return true;
  };
  const end = () => {
    busyRef.current = false;
    setBusy(false);
  };

  const perform: Perform = async (build, inline = false) => {
    if (!begin()) return null;
    const fail = (message: string): EditResult => {
      if (!inline) setError(message);
      return { ok: false, error: message };
    };
    try {
      const result = build({ now: new Date().toISOString(), deviceId: await getDeviceId() });
      if (!result.ok) {
        if (!inline) setError(result.error);
        return result;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) return fail("Non sono riuscito a salvare. Riprova.");
      // prima la scheda si chiude, poi nasce l'avviso: sotto una scheda aperta non si vedrebbe
      onClose();
      notice.show({ message: result.message, undo: result.events });
      return null;
    } catch {
      return fail("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      end();
    }
  };

  /** «Mangiato»: il consumo va nel diario del giorno, nel momento dell'ora (vedi `eaten.ts`). */
  async function eat() {
    if (!amount || !begin()) return;
    const { target, choice } = amountFor(amount);
    const lots = target === "group" ? members.map((m) => m.lot) : [lot];
    try {
      const state: DiaryState | undefined = diary.data ?? (log.data ? deriveDiary(log.data) : undefined);
      if (!state) {
        setError("Un attimo, sto ancora caricando. Riprova.");
        return;
      }
      const at = new Date().toISOString();
      const result = buildEaten(lots, choice, { now: at, deviceId: await getDeviceId() }, state);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      const eaten = result.marked.consumes[0]?.quantity;
      // «1 confezione» è una porzione solo se la confezione era intatta
      const intact = amount.optionId !== "pack-one" || (eaten !== undefined && eaten.unit === lot.unit && Math.abs(eaten.value - lot.initial) < 1e-6);
      if (remembersPortion(amount) && intact && eaten) {
        void rememberPortion(lot.productRef, { ...eaten, ...(amount.estimated ? { estimated: true } : {}) }, at);
      }

      const { events } = result;
      const date = result.marked.date;
      const firstId = result.marked.consumes[0]?.id;
      const params = [...(date === dayOf(at, timeZone) ? [] : [`giorno=${date}`]), ...(firstId ? [`voce=${encodeURIComponent(firstId)}`] : [])];
      onClose();
      notice.show({
        message: result.message,
        // «Annulla» guarda il registro com'è in quel momento: il pasto si annulla solo se nessun altro consumo lo usa
        onUndo: async () => {
          const [all, current] = await Promise.all([getAllEvents(), getPantry()]);
          await appendEvents(undoPlacement(events, all, current.voidedEventIds, { now: new Date().toISOString(), deviceId: await getDeviceId() }));
        },
        link: { label: "Vedi in Oggi", href: params.length > 0 ? `/app?${params.join("&")}` : "/app" },
      });
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      end();
    }
  }

  /** «Aperto»: l'avviso dice anche la scadenza che vale da adesso. */
  const markOpened = () =>
    void perform((ctx) => {
      const result = buildOpen(lot, ctx);
      if (!result.ok) return result;
      const after = evaluateLots([{ ...lot, openedAt: ctx.now }], ctx.now)[0];
      const message = `Segnato aperto: ${inSentence(lot.productRef)}.`;
      if (!after?.expiry) return { ...result, message };
      const { expiry } = after;
      // la durata dopo l'apertura è una stima, salvo che venga dall'etichetta del prodotto
      const text =
        expiry.basis === "opened"
          ? `Dopo l'apertura: entro ${formatCalendarDate(expiry.date)}${expiry.openedFrom === "product" ? "" : ", stima"}`
          : expiryExplanation(after);
      return { ...result, message: `${message} ${sentence(text)}` };
    });

  /** Rimette in lista la quantità con cui era entrato: si cambia poi nella lista. */
  async function addToList() {
    if (!begin()) return;
    try {
      const result = await addManualEntries([{ product: lot.productRef, quantity: { value: lot.initial, unit: lot.unit } }]);
      if (result.added === 0) {
        setError("Non sono riuscito ad aggiungerlo alla lista. Riprova.");
        return;
      }
      onClose();
      notice.show({ message: `Aggiunto alla lista della spesa: ${lot.productRef}.`, onUndo: result.undo });
    } catch {
      setError("Non sono riuscito ad aggiungerlo alla lista. Riprova.");
    } finally {
      end();
    }
  }

  const tag = expiryTagView(entry);
  const left = lot.remaining > 0;
  const opened = lot.openedAt !== undefined;
  const partial = lot.remaining < lot.initial;
  const remainingText = formatQuantity({ value: lot.remaining, unit: lot.unit });
  const initialText = formatQuantity({ value: lot.initial, unit: lot.unit });
  const remainingCertainty = lot.remainingCertainty === "estimated" ? "estimated" : "measured";
  const freezeEntry = saveActions(entry).includes("freeze") ? previewExpiryAfterMove(lot, "freezer", now) : undefined;
  const freezePreview = freezeEntry?.expiry
    ? `In freezer: fino al ${formatCalendarDate(freezeEntry.expiry.date)}${freezeEntry.expiry.certainty === "estimated" ? ", stima" : ""}.`
    : null;
  const qualityHref =
    lot.barcode && !isLocalProduct(products?.get(lot.barcode)) ? `/app/qualita/prodotto?codice=${encodeURIComponent(lot.barcode)}` : undefined;

  const detailsSummary = [
    isFoodCategory(lot.category) ? FOOD_CATEGORY_LABELS[lot.category] : undefined,
    `entrato il ${shortDate(dayOf(lot.createdAt), today)}`,
    tag?.estimated ? "scadenza stimata" : undefined,
  ]
    .filter((part) => part !== undefined)
    .join(" · ");

  const head = (
    <div className={styles.head}>
      <div className={styles.top}>
        <div className={styles.figure}>
          <ModelViewer recipe={recipe} seed={lot.lotId} signal={tag?.level === "urgent"} autoRotate />
        </div>
        <div className={styles.heading}>
          <p className={styles.name}>{lot.productRef}</p>
          <p className={styles.sub}>
            {LOCATION_LABELS[lot.location]}
            {left ? (
              <>
                {lot.unit === "pz" && lot.remaining === 1 ? " · resta " : " · restano "}
                <Value certainty={remainingCertainty}>{remainingText}</Value>
              </>
            ) : null}
            {lot.openedAt ? ` · aperto ${relativeDay(dayOf(lot.openedAt), today)}` : ""}
          </p>
          {tag ? (
            <ExpiryTag level={tag.level} estimated={tag.estimated}>
              {tag.text}
            </ExpiryTag>
          ) : null}
        </div>
      </div>

      {step === "main" && freezeEntry ? (
        <div className={styles.save}>
          <div className={styles.saveLine}>
            <span className={styles.saveText}>Sta per scadere.</span>
            <Button
              variant="outline"
              onClick={() => {
                setMoveTo("freezer");
                go("move");
              }}
            >
              {SAVE_LABELS.freeze}
            </Button>
          </div>
          {freezePreview ? <span className={ui.hint}>{freezePreview}</span> : null}
        </div>
      ) : null}

      {members.length > 1 ? (
        <div className={styles.groupPick}>
          <label htmlFor={`${ids}-pack`} className={ui.fieldLabel}>
            Hai {members.length} confezioni uguali. Agisci su
          </label>
          <select
            id={`${ids}-pack`}
            className={ui.input}
            value={lot.lotId}
            disabled={busy}
            onChange={(e) => {
              setChosenId(e.target.value);
              setPicked(undefined);
              setError(null);
            }}
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
    </div>
  );

  const errorLine = error ? (
    <p className={ui.error} role="alert">
      {error}
    </p>
  ) : null;

  let footer: ReactNode;
  if (step === "correct" || step === "discard" || step === "move" || step === "dates") {
    // un passo con un solo pulsante che conferma: «Indietro» a sinistra, il pulsante del passo (messo da `LotActions`) a destra
    footer = (
      <div className={styles.stepFooter}>
        <Button variant="text" className={styles.backInline} disabled={busy} onClick={stepBack}>
          Indietro
        </Button>
        <div ref={setActionSlot} className={styles.stepAction} />
      </div>
    );
  } else if (step !== "main") {
    footer = (
      <Button variant="text" className={styles.back} disabled={busy} onClick={stepBack}>
        Indietro
      </Button>
    );
  } else if (left) {
    footer = (
      <>
        <Button disabled={busy || amount === null} onClick={() => void eat()}>
          {amountLabel("Mangiato", amount, choices.options, lot.unit)}
        </Button>
        <div className={styles.secondary}>
          <Button variant="outline" disabled={busy} onClick={() => go("discard")}>
            Buttato
          </Button>
          {opened ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setMoveTo(undefined);
                go("move");
              }}
            >
              Sposta
            </Button>
          ) : (
            <Button variant="outline" disabled={busy} onClick={markOpened}>
              Aperto
            </Button>
          )}
          <Button variant="text" disabled={busy} onClick={() => go("more")}>
            Altro
          </Button>
        </div>
        {errorLine}
      </>
    );
  } else {
    footer = (
      <>
        <div className={styles.secondary}>
          <Button variant="outline" disabled={busy} onClick={() => void addToList()}>
            Aggiungi alla spesa
          </Button>
          <button type="button" className={ui.danger} disabled={busy} onClick={() => go("remove")}>
            Elimina dalla dispensa
          </button>
        </div>
        {errorLine}
      </>
    );
  }

  return (
    <Sheet title={lot.productRef} titleHidden head={head} footer={footer} busy={busy} onClose={onClose} onBack={step === "main" ? undefined : stepBack}>
      {step === "main" ? (
        <>
          {left ? (
            <div className={styles.quantity}>
              <QuantityPicker
                key={lot.lotId}
                label="Quanto"
                unit={lot.unit}
                options={choices.options}
                value={amount}
                onChange={(next) => {
                  setPicked(next);
                  setError(null);
                }}
                max={lot.remaining}
              />
              {amount === null ? <p className={ui.hint}>Scegli quanto</p> : null}
            </div>
          ) : (
            <p className={ui.hint}>Di questo alimento non resta niente.</p>
          )}

          <div className={styles.rows}>
            <Disclosure title="Dettagli" summary={detailsSummary}>
              <dl className={styles.data}>
                <div className={styles.dataRow}>
                  <dt>
                    <Label>Quantità</Label>
                  </dt>
                  <dd>
                    <Value certainty={remainingCertainty}>{remainingText}</Value>
                    {partial ? <span className={styles.muted}> di {initialText}</span> : null}
                    <LevelBar value={levelPercent(lot)} label={`Rimasto circa il ${Math.round(levelPercent(lot))} per cento`} />
                  </dd>
                </div>
                <div className={styles.dataRow}>
                  <dt>
                    <Label>Scadenza</Label>
                  </dt>
                  <dd>{entry.expiry ? expiryExplanation(entry) : "Nessuna scadenza nota. Scegli una categoria con «Correggi», in «Altro», per avere una stima."}</dd>
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
            </Disclosure>
            <Disclosure title="Valori nutrizionali" summary={lotValuesSummary(values)}>
              <LotNutrition lot={lot} />
            </Disclosure>
            {story ? (
              <Disclosure title="Storia" summary={story.summary}>
                <LotHistory lines={story.lines} />
              </Disclosure>
            ) : null}
          </div>
        </>
      ) : (
        <LotActions
          step={step}
          entry={entry}
          creation={creation}
          creationKnown={registryRead}
          group={members}
          now={now}
          busy={busy}
          perform={perform}
          error={error}
          moveTo={moveTo}
          moveInFooter={opened}
          actionSlot={actionSlot}
          formId={`${ids}-step`}
          qualityHref={qualityHref}
          onStep={(next) => {
            if (next === "move") setMoveTo(undefined);
            go(next);
          }}
          onAddToList={() => void addToList()}
        />
      )}
    </Sheet>
  );
}
