"use client";

// Il foglio «Voce»: una voce di un pasto si corregge dal posto. La quantità con «Salva», il momento in un passo dello
// stesso foglio, oppure si toglie. Ogni azione riuscita scrive una volta sola, chiude il foglio e lascia l'avviso con
// «Annulla»; un errore resta scritto dentro il foglio. Una voce «fuori casa» non ha una quantità: al suo posto si
// sceglie la taglia, e «Salva» riscrive la voce con la stima nuova.
import { useId, useRef, useState } from "react";
import {
  changeConsumeQuantity,
  changeItem,
  moveItem,
  removeConsume,
  removeItem,
  localMoment,
  type DiaryState,
  type MealItem,
  type MealKind,
} from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import type { ConsumeEvent, Lot } from "@/core/ledger";
import { OUT_OF_HOME_SIZES, estimateOutOfHome, type IntakeLine, type OutOfHomeSize } from "@/core/nutrition";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId } from "@/data";
import { Button } from "@/design";
import { ActionList, QuantityPicker, Sheet, type ActionItem, type QuantityOption, type QuantityValue } from "../common";
import { OUT_OF_HOME_SIZE_LABELS, energyEstimateText, isOutOfHomeItem, outOfHomeBasisText, outOfHomeName, outOfHomeSizeOf } from "../meals";
import { useNotice } from "../notice";
import { buildChangeMoment } from "../pantry/eaten";
import { rememberPortion } from "../pantry/usePortions";
import { pieceChoices } from "../pieces";
import ui from "../ui.module.css";
import { consumeRemovedText, itemMovedText, itemRemovedText, momentTargets, outOfHomeCorrectedText, quantityCorrectedText } from "./editText";
import { lineNutrientText } from "./lineText";
import { inSentence } from "./summaries";
import styles from "./MealEntries.module.css";

export type SheetWrite =
  | { ok: true; events: readonly AnyEvent[]; message: string; /** Dopo la scrittura riuscita, prima di chiudere. */ afterWrite?: () => void }
  | { ok: false; error: string };

/**
 * Le scritture di un foglio, una alla volta e sempre in quest'ordine: una sola `appendEvents` con tutti gli eventi, il
 * foglio si chiude, poi nasce l'avviso, il cui «Annulla» annulla proprio quegli eventi. Se non c'è niente da scrivere
 * il foglio si chiude senza avviso; un errore resta in `error` e il foglio resta aperto.
 */
export function useSheetWrite(onClose: () => void) {
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);

  async function write(build: (ctx: { deviceId: string; now: string }) => SheetWrite): Promise<void> {
    // un secondo tocco mentre la prima scrittura è in corso non fa niente
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = build({ deviceId: await getDeviceId(), now: new Date().toISOString() });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (result.events.length === 0) {
        onClose();
        return;
      }
      const written = await appendEvents(result.events);
      if (written.added === 0 || written.rejected.length > 0) {
        setError("Non sono riuscito a salvare. Riprova.");
        return;
      }
      result.afterWrite?.();
      onClose();
      notice.show({ message: result.message, undo: result.events });
    } catch {
      setError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  return { write, busy, error, clearError: () => setError(null) };
}

/** La voce com'è adesso nel diario. */
export type EntryTarget =
  | {
      type: "pantry";
      consume: ConsumeEvent;
      /** Il nome dell'alimento (dal lotto). */
      name: string;
      /** L'alimento in dispensa; assente se è stato eliminato. */
      lot: Lot | undefined;
      line: IntakeLine | undefined;
      /** Il momento del pasto in cui sta. */
      kind: MealKind;
      /** L'istante del pasto in cui sta (dal diario): giorno e ora valgono da qui, non dal consumo. */
      mealAt: string;
    }
  | { type: "free"; mealId: string; index: number; item: MealItem; line: IntakeLine | undefined; kind: MealKind };

interface Props {
  /** Il nome dell'alimento: resta nel titolo anche se la voce nel frattempo è sparita. */
  title: string;
  /** `undefined`: la voce non c'è più (tolta da un altro telefono mentre il foglio era aperto). */
  entry: EntryTarget | undefined;
  /** Il giorno mostrato, `YYYY-MM-DD`: quello del pasto. */
  date: string;
  today: string;
  diary: DiaryState;
  log: readonly AnyEvent[];
  /**
   * Per una voce «fuori casa»: l'energia dei pasti registrati negli ultimi 30 giorni in quel momento (`mealEnergyHistory`).
   * Si chiede solo quando la taglia cambia. `undefined` finché i nutrienti non sono calcolati: fino ad allora la
   * taglia non si può cambiare.
   */
  energyHistoryOf?: (kind: MealKind) => readonly number[] | undefined;
  onClose: () => void;
}

const EPSILON = 1e-9;

export function EntrySheet({ title, entry, date, today, diary, log, energyHistoryOf, onClose }: Props) {
  const { write, busy, error, clearError } = useSheetWrite(onClose);
  const ids = useId();
  const [step, setStep] = useState<"main" | "moment">("main");
  /** La taglia scelta per una voce «fuori casa»; `null` finché non si tocca: vale quella scritta. */
  const [sizePicked, setSizePicked] = useState<OutOfHomeSize | null>(null);
  /** La quantità scelta; `undefined` finché non si tocca il selettore: vale quella di adesso. */
  const [picked, setPicked] = useState<QuantityValue | null | undefined>(undefined);
  /** Dove si legge l'errore: sotto il selettore se è nato da «Salva», altrimenti sotto l'elenco. */
  const [errorAt, setErrorAt] = useState<"quantity" | "list">("list");

  if (!entry) {
    return (
      <Sheet title={title} onClose={onClose} busy={busy}>
        {/* durante una scrittura la voce sparisce un attimo prima che il foglio si chiuda: non è un errore */}
        {busy ? null : <p className={ui.hint}>Questa voce non c&apos;è più.</p>}
      </Sheet>
    );
  }

  const timeZone = diary.timeZone;
  const current = entry;
  const pantry = current.type === "pantry" ? current : undefined;
  const name = current.type === "pantry" ? current.name : current.item.name;
  const quantity = current.type === "pantry" ? current.consume.quantity : current.item.quantity;
  const { unit } = quantity;
  const wasEstimated = (current.type === "pantry" ? current.consume.certainty : current.item.certainty) === "estimated";
  const lot = pantry?.lot;
  // Quanto si può mangiare al massimo: ciò che resta nell'alimento più questa voce. Se l'alimento non c'è più, solo questa voce.
  const available = pantry ? (lot && lot.unit === unit ? lot.remaining : 0) + quantity.value : undefined;

  const options: QuantityOption[] =
    lot && lot.unit === unit && available !== undefined
      ? pieceChoices({ ...lot, remaining: available }).map((p) => ({ id: p.id, label: p.short, value: p.quantity.value, estimated: p.estimated }))
      : [];

  const amount = picked === undefined ? { value: quantity.value, estimated: wasEstimated } : picked;
  const over = amount !== null && available !== undefined && amount.value - available > EPSILON;
  // Un numero riscritto uguale non è una correzione. A parità di numero cambia qualcosa solo se una voce di dispensa
  // misurata diventa una stima (mezzo pezzo): la certezza può peggiorare, mai migliorare.
  const changed = amount !== null && !over && (amount.value !== quantity.value || (pantry !== undefined && amount.estimated && !wasEstimated));
  const quantityError =
    over && available !== undefined ? `Ne restavano ${formatQuantity({ value: available, unit })}.` : errorAt === "quantity" ? error : null;

  // Giorno e ora del pasto, non del consumo: una voce di un pasto di lunedì resta a lunedì anche se è stata scritta oggi.
  // Una voce libera resta nel giorno del suo pasto.
  const targets =
    current.type === "pantry"
      ? momentTargets({ date, minutes: localMoment(current.mealAt, timeZone)?.minutes, today, kind: current.kind }, true)
      : momentTargets({ date, today, kind: current.kind }, false);

  const go = (next: "main" | "moment") => {
    setStep(next);
    clearError();
    // un campo lasciato vuoto non è una scelta: tornando dal passo si riparte dalla quantità di adesso
    if (picked === null) setPicked(undefined);
  };

  function save() {
    if (amount === null || !changed) return;
    const next = amount;
    setErrorAt("quantity");
    void write(({ deviceId, now }) => {
      const ctx = { deviceId, now, timeZone };
      const edit =
        current.type === "pantry"
          ? changeConsumeQuantity(current.consume, { value: next.value, estimated: next.estimated }, available ?? quantity.value, ctx)
          : changeItem(current.mealId, current.index, { quantity: { value: next.value, unit } }, log, ctx);
      if (!edit.ok) return edit;
      // una voce libera tiene la sua certezza, e quella di una voce di dispensa non migliora: si legge da ciò che si scrive
      const written = edit.events.find((e) => e.type === "consume");
      const estimated = written ? written.certainty === "estimated" : wasEstimated;
      const portion = { value: next.value, unit, ...(estimated ? { estimated: true } : {}) };
      return {
        ok: true,
        events: edit.events,
        message: quantityCorrectedText({ name, quantity: { value: next.value, unit }, estimated, kind: current.kind, date, today }),
        // una correzione dell'utente sostituisce la porzione ricordata; senza l'alimento non si sa di chi sia
        ...(lot ? { afterWrite: () => void rememberPortion(lot.productRef, portion, now) } : {}),
      };
    });
  }

  // Una voce «fuori casa»: la taglia al posto della quantità. Il numero scritto resta finché la taglia non cambia.
  const outOfHome = current.type === "free" && isOutOfHomeItem(current.item) ? current : undefined;
  const sizeNow = outOfHome ? outOfHomeSizeOf(outOfHome.item.name) : undefined;
  const size = sizePicked ?? sizeNow;
  const sizeChanged = size !== undefined && size !== sizeNow;
  const history = outOfHome && sizeChanged ? energyHistoryOf?.(current.kind) : undefined;
  const nextEstimate = outOfHome && sizeChanged && history ? estimateOutOfHome(current.kind, size, history) : undefined;

  function saveSize() {
    if (!outOfHome || !nextEstimate || size === undefined) return;
    const target = outOfHome;
    const next = { size, energyKcal: nextEstimate.energyKcal };
    setErrorAt("quantity");
    void write(({ deviceId, now }) => {
      const edit = changeItem(target.mealId, target.index, { name: outOfHomeName(next.size), energyKcal: next.energyKcal }, log, { deviceId, now, timeZone });
      if (!edit.ok) return edit;
      return { ok: true, events: edit.events, message: outOfHomeCorrectedText({ kind: target.kind, ...next }) };
    });
  }

  function moveTo(target: { kind: MealKind; date: string }) {
    setErrorAt("list");
    void write(({ deviceId, now }) => {
      if (current.type === "pantry") {
        const marked = {
          consumes: [current.consume],
          mealId: current.consume.mealId ?? "",
          kind: current.kind,
          date,
          joined: false,
          name: inSentence(name),
          amount: formatQuantity(quantity),
        };
        const moved = buildChangeMoment(marked, target, { deviceId, now }, diary);
        return moved.ok ? { ok: true, events: moved.events, message: moved.message } : moved;
      }
      // una voce libera resta nel giorno del suo pasto
      const edit = moveItem(current.mealId, current.index, { kind: target.kind }, log, diary, { deviceId, now, timeZone });
      return edit.ok ? { ok: true, events: edit.events, message: itemMovedText({ name, kind: target.kind, date, today }) } : edit;
    });
  }

  function remove() {
    setErrorAt("list");
    void write(({ deviceId, now }) => {
      const ctx = { deviceId, now, timeZone };
      // una voce della dispensa si toglie con tutta la sua famiglia di consumi: vedi `removeConsume`
      const edit = current.type === "pantry" ? removeConsume(current.consume, log, ctx) : removeItem(current.mealId, current.index, log, ctx);
      if (!edit.ok) return edit;
      return { ok: true, events: edit.events, message: current.type === "pantry" ? consumeRemovedText(name, quantity) : itemRemovedText(name) };
    });
  }

  const listError =
    error && errorAt === "list" ? (
      <p className={ui.error} role="alert">
        {error}
      </p>
    ) : null;

  if (step === "moment") {
    const moments: ActionItem[] = targets.map((t) => ({ id: `${t.date}-${t.kind}`, label: t.label, disabled: busy, onSelect: () => moveTo(t) }));
    return (
      <Sheet
        title={title}
        onClose={onClose}
        busy={busy}
        onBack={() => go("main")}
        footer={
          <Button variant="text" className={styles.back} disabled={busy} onClick={() => go("main")}>
            Indietro
          </Button>
        }
      >
        <p className={ui.fieldLabel}>Cambia momento</p>
        <ActionList items={moments} />
        {listError}
      </Sheet>
    );
  }

  const actions: ActionItem[] = [
    ...(targets.length > 0 ? [{ id: "moment", label: "Cambia momento", disabled: busy, onSelect: () => go("moment") }] : []),
    ...(lot && lot.status === "active" ? [{ id: "lot", label: "Apri l'alimento", href: `/app/dispensa?lotto=${encodeURIComponent(lot.lotId)}` }] : []),
    // a una stima «fuori casa» non c'è un alimento da collegare
    ...(!outOfHome && lineNutrientText(current.line) === "senza dato" ? [{ id: "values", label: "Collega i valori", href: "/app/salute/nutrizione" }] : []),
    { id: "remove", label: "Togli", danger: true, disabled: busy, onSelect: remove },
  ];

  if (outOfHome) {
    const written = outOfHome.item.energyKcal ?? 0;
    const sizeNote = !sizeChanged
      ? `${energyEstimateText(written)}. È la stima scritta quando l'hai registrato.`
      : nextEstimate && size !== undefined
        ? `${energyEstimateText(nextEstimate.energyKcal)}. ${outOfHomeBasisText(outOfHome.kind, size, nextEstimate)}`
        : "Calcolo la stima…";
    return (
      <Sheet
        title={title}
        onClose={onClose}
        busy={busy}
        footer={
          <Button disabled={busy || !nextEstimate} onClick={saveSize}>
            Salva
          </Button>
        }
      >
        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Quanto</legend>
          <div className={ui.choices}>
            {OUT_OF_HOME_SIZES.map((s) => (
              <label key={s} className={ui.choice}>
                <input
                  type="radio"
                  name={`${ids}-size`}
                  value={s}
                  checked={size === s}
                  disabled={busy}
                  onChange={() => {
                    setSizePicked(s);
                    clearError();
                  }}
                />
                <span>{OUT_OF_HOME_SIZE_LABELS[s]}</span>
              </label>
            ))}
          </div>
          <p className={ui.hint}>{sizeNote}</p>
          {error && errorAt === "quantity" ? (
            <p className={ui.error} role="alert">
              {error}
            </p>
          ) : null}
        </fieldset>
        <ActionList items={actions} />
        {listError}
      </Sheet>
    );
  }

  return (
    <Sheet
      title={title}
      onClose={onClose}
      busy={busy}
      footer={
        <Button disabled={busy || !changed} onClick={save}>
          Salva
        </Button>
      }
    >
      <QuantityPicker
        label="Quanto"
        unit={unit}
        options={options}
        value={amount}
        onChange={(next) => {
          setPicked(next);
          clearError();
        }}
        error={quantityError}
      />
      <ActionList items={actions} />
      {listError}
    </Sheet>
  );
}
