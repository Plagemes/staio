"use client";

// I passi della scheda di un alimento oltre a quello principale: «Altro», «Buttato», «Sposta», «Correggi»,
// «Date diverse per confezione», «Elimina dalla dispensa». Cambiano il contenuto dello stesso foglio: il foglio,
// la testa e «Indietro» li mette `LotSheet`.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { addDays } from "@/core/expiry";
import type { DeclareEvent, DiscardReason, Location, PurchaseEvent } from "@/core/ledger";
import { useEventLog, usePantry } from "@/data";
import { Button, ExpiryTag } from "@/design";
import {
  findCreationEvent,
  buildDiscard,
  buildEdit,
  buildEditMany,
  buildForLots,
  buildRemoveMany,
  buildFinish,
  buildRemoveMistaken,
  buildSetExpiry,
  buildMove,
  canEditPrice,
  formFromLot,
  needsSameProductAnswer,
  type ActionContext,
  type EditErrors,
  type EditForm,
  type EditResult,
  type RemoveManyKind,
} from "../actions";
import { EXPIRY_SHORTCUTS } from "../barcode/expiryShortcuts";
import { cleanName } from "../capture";
import { ActionList, QuantityPicker, type ActionItem, type QuantityValue } from "../common";
import { readAmount, writeAmount } from "../common/quantity";
import { dayOf, formatCalendarDate } from "../format";
import {
  DISCARD_REASON_LABELS,
  DISCARD_REASON_ORDER,
  EXPIRY_KIND_LABELS,
  FOOD_CATEGORY_GROUPS,
  FOOD_CATEGORY_LABELS,
  LOCATION_LABELS,
  LOCATION_ORDER,
  type ChosenExpiryKind,
} from "../labels";
import { expiryExplanation, expiryTagView, previewExpiryAfterMove, type PantryEntry } from "../lots";
import ui from "../ui.module.css";
import { buildQuantityCorrection, mergeCorrection, overInitialQuestion, type QuantityCorrection } from "./correctQuantity";
import { entryDate } from "./groups";
import { amountFor, amountLabel, quantityOptions } from "./quantityOptions";
import { SAVE_LABELS, cookHref, pairHref } from "./saveActions";
import styles from "./LotSheet.module.css";

/**
 * Scrive gli eventi di un'azione; se riesce chiude la scheda e mostra l'avviso con «Annulla».
 * Restituisce il risultato solo se è fallita, altrimenti null.
 * Con `inline` l'errore non va nella riga della scheda: lo mostra il campo che l'ha provocato.
 */
export type Perform = (build: (ctx: ActionContext) => EditResult, inline?: boolean) => Promise<EditResult | null>;

/** I passi del foglio. `main` è la scheda com'è all'apertura; gli altri ne prendono il posto, con «Indietro». */
export type Step = "main" | "more" | "discard" | "move" | "correct" | "dates" | "remove";

interface LotActionsProps {
  /** Il passo da mostrare: mai `main`, che è di `LotSheet`. */
  step: Exclude<Step, "main">;
  entry: PantryEntry;
  creation: PurchaseEvent | DeclareEvent | undefined;
  /** Falso finché il registro non è stato letto: non si sa ancora se l'inserimento c'è. */
  creationKnown: boolean;
  /** Le confezioni uguali del gruppo (almeno due), la prima è la più vicina a scadere; vuoto se il lotto è solo. */
  group?: readonly PantryEntry[];
  now: string;
  busy: boolean;
  perform: Perform;
  /** La riga d'errore della scheda, sotto il comando che l'ha dato. */
  error: string | null;
  /** Luogo con cui si apre «Sposta»: il freezer se si arriva da «Sposta in freezer». */
  moveTo?: Location;
  /** «Sposta» è già nel piede (alimento aperto): in «Altro» non si ripete. */
  moveInFooter: boolean;
  /** La pagina «Qualità del prodotto», se l'alimento ha un codice e la sua scheda non l'ha scritta l'utente. */
  qualityHref?: string;
  onStep: (step: Step) => void;
  onAddToList: () => void;
}

export function LotActions({
  step,
  entry,
  creation,
  creationKnown,
  group = [],
  now,
  busy,
  perform,
  error,
  moveTo,
  moveInFooter,
  qualityHref,
  onStep,
  onAddToList,
}: LotActionsProps) {
  const { lot } = entry;
  // i moduli partono dai dati della confezione scelta: cambiando confezione ripartono
  const key = `${step}:${lot.lotId}`;
  const rootRef = useRef<HTMLDivElement>(null);

  // a ogni cambio di passo il fuoco va sul suo titolo: chi usa il lettore dello schermo sente dove si trova
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>("h3")?.focus();
  }, [step]);

  let content: ReactNode = null;
  if (step === "more") {
    const items: ActionItem[] = [
      ...(moveInFooter ? [] : [{ id: "move", label: "Sposta", onSelect: () => onStep("move") }]),
      {
        id: "correct",
        label: "Correggi",
        disabled: !creation,
        ...(creationKnown && !creation ? { hint: "Non trovo l'inserimento di questo alimento." } : {}),
        onSelect: () => onStep("correct"),
      },
      { id: "shopping", label: "Aggiungi alla spesa", disabled: busy, onSelect: onAddToList },
      { id: "meal", label: "Aggiungi a un pasto", href: `/app/pasto?lotto=${encodeURIComponent(lot.lotId)}` },
      { id: "cook", label: SAVE_LABELS.cook, href: cookHref(lot.productRef) },
      { id: "pair", label: SAVE_LABELS.pair, href: pairHref(lot.productRef) },
      ...(qualityHref ? [{ id: "quality", label: "Qualità del prodotto", href: qualityHref }] : []),
      { id: "remove", label: "Elimina dalla dispensa", danger: true, onSelect: () => onStep("remove") },
    ];
    content = (
      <div className={styles.form}>
        <StepTitle>Altro</StepTitle>
        <ActionList items={items} />
      </div>
    );
  } else if (step === "discard") {
    content = <DiscardForm key={key} entry={entry} busy={busy} perform={perform} />;
  } else if (step === "move") {
    content = <MoveForm key={key} entry={entry} group={group} now={now} initialTo={moveTo} busy={busy} perform={perform} />;
  } else if (step === "correct" && creation) {
    content = <CorrectForm key={key} entry={entry} group={group} creation={creation} now={now} busy={busy} perform={perform} onDates={() => onStep("dates")} />;
  } else if (step === "dates") {
    content = <DatesForm key={key} entry={entry} group={group} now={now} busy={busy} perform={perform} />;
  } else if (step === "remove") {
    content = <RemoveForm key={key} entry={entry} group={group} busy={busy} perform={perform} onDiscard={() => onStep("discard")} />;
  }

  return (
    <div ref={rootRef} className={styles.step}>
      {content}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Il titolo del passo: può ricevere il fuoco da codice, non con il tasto di tabulazione. */
function StepTitle({ children }: { children: ReactNode }) {
  return (
    <h3 tabIndex={-1} className={styles.formTitle}>
      {children}
    </h3>
  );
}

interface SubFormProps {
  entry: PantryEntry;
  /** Le confezioni uguali del gruppo (almeno due), oppure vuoto. */
  group?: readonly PantryEntry[];
  busy: boolean;
  perform: Perform;
}

type Scope = "one" | "all";

/** Una confezione o tutte quelle del gruppo: compare solo con un gruppo. */
function ScopePick({ count, value, onChange }: { count: number; value: Scope; onChange: (s: Scope) => void }) {
  const ids = useId();
  if (count < 2) return null;
  return (
    <fieldset className={ui.field}>
      <legend className={ui.fieldLabel}>Vale per</legend>
      <div className={ui.choices}>
        <label className={ui.choice}>
          <input type="radio" name={`${ids}-scope`} checked={value === "one"} onChange={() => onChange("one")} />
          <span>Questa confezione</span>
        </label>
        <label className={ui.choice}>
          <input type="radio" name={`${ids}-scope`} checked={value === "all"} onChange={() => onChange("all")} />
          <span>{`Tutte le ${count} confezioni`}</span>
        </label>
      </div>
    </fieldset>
  );
}

const packsText = (n: number) => (n === 1 ? "1 confezione" : `${n} confezioni`);

/** I tasti rapidi sotto un campo data: riempiono la data contando da oggi. */
function ExpiryShortcuts({ today, onPick }: { today: string; onPick: (date: string) => void }) {
  return (
    <div className={styles.shortcuts}>
      {EXPIRY_SHORTCUTS.map(([label, days]) => (
        <button key={days} type="button" className={styles.shortcut} onClick={() => onPick(addDays(today, days))}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** «Buttato»: motivo e quantità, della confezione scelta. */
function DiscardForm({ entry, busy, perform }: SubFormProps) {
  const { lot } = entry;
  const ids = useId();
  const level = entry.urgency?.level;
  const [reason, setReason] = useState<DiscardReason>(level === "expired" || level === "past_quality" ? "expired" : "other");
  const [amount, setAmount] = useState<QuantityValue | null>(null);
  const { options } = quantityOptions({ lot });

  return (
    <div className={styles.form}>
      <StepTitle>Che cosa butti?</StepTitle>

      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Motivo</legend>
        <div className={ui.choices}>
          {DISCARD_REASON_ORDER.map((r) => (
            <label key={r} className={ui.choice}>
              <input type="radio" name={`${ids}-reason`} value={r} checked={reason === r} onChange={() => setReason(r)} />
              <span>{DISCARD_REASON_LABELS[r]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.quantity}>
        <QuantityPicker label="Quanto" unit={lot.unit} options={options} value={amount} onChange={setAmount} max={lot.remaining} />
        {amount === null ? <p className={ui.hint}>Scegli quanto</p> : null}
      </div>

      <Button
        disabled={busy || amount === null}
        onClick={() => {
          if (amount) void perform((ctx) => buildDiscard(lot, amountFor(amount).choice, reason, ctx));
        }}
      >
        {amountLabel("Buttato", amount, options, lot.unit)}
      </Button>
    </div>
  );
}

function MoveForm({ entry, group = [], now, initialTo, busy, perform }: SubFormProps & { now: string; initialTo?: Location }) {
  const { lot } = entry;
  const [scope, setScope] = useState<Scope>("one");
  const lots = scope === "all" ? group.map((g) => g.lot) : [lot];
  const ids = useId();
  const targets = LOCATION_ORDER.filter((l) => l !== lot.location);
  const [to, setTo] = useState<Location>(initialTo && targets.includes(initialTo) ? initialTo : targets[0]);
  const preview = previewExpiryAfterMove(lot, to, now);
  const tag = preview ? expiryTagView(preview) : undefined;
  const crossesFreezer = to === "freezer" || lot.location === "freezer";

  return (
    <div className={styles.form}>
      <StepTitle>Dove lo sposti?</StepTitle>
      <ScopePick count={group.length} value={scope} onChange={setScope} />
      <fieldset className={ui.field}>
        <legend className={ui.srOnly}>Nuovo luogo</legend>
        <div className={ui.choices}>
          {targets.map((l) => (
            <label key={l} className={ui.choice}>
              <input type="radio" name={`${ids}-to`} value={l} checked={to === l} onChange={() => setTo(l)} />
              <span>{LOCATION_LABELS[l]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {preview && tag ? (
        <div className={styles.preview} aria-live="polite">
          <span className={ui.hint}>
            {crossesFreezer ? "Entrando o uscendo dal freezer la scadenza si ricalcola. " : "La scadenza stimata cambia con il luogo. "}
            Dopo lo spostamento:
          </span>
          <ExpiryTag level={tag.level} estimated={tag.estimated}>
            {tag.text}
          </ExpiryTag>
          <span className={ui.hint}>{expiryExplanation(preview)}</span>
        </div>
      ) : null}
      <Button
        disabled={busy}
        onClick={() =>
          void perform((ctx) =>
            buildForLots(
              lots,
              (l) => buildMove(l, to, ctx),
              (n, name) =>
                n === 1
                  ? `Spostato in ${LOCATION_LABELS[to].toLowerCase()}: ${name}.`
                  : `Spostate in ${LOCATION_LABELS[to].toLowerCase()}: ${n} confezioni di ${name}.`,
            ),
          )
        }
      >
        {`Sposta in ${LOCATION_LABELS[to].toLowerCase()}${lots.length > 1 ? ` (${packsText(lots.length)})` : ""}`}
      </Button>
    </div>
  );
}

type CorrectErrors = EditErrors & { remaining?: string };

/** «Correggi»: quanto ne resta, nome, categoria, scadenza, prezzo. Scrive tutto insieme, con un solo avviso. */
function CorrectForm({
  entry,
  group = [],
  creation,
  now,
  busy,
  perform,
  onDates,
}: SubFormProps & { creation: PurchaseEvent | DeclareEvent; now: string; onDates: () => void }) {
  const { lot } = entry;
  const ids = useId();
  const log = useEventLog();
  const pantry = usePantry();
  const [scope, setScope] = useState<Scope>("one");
  const [form, setForm] = useState<EditForm>(() => formFromLot(lot));
  const [remainingText, setRemainingText] = useState(() => writeAmount(lot.remaining));
  const [errors, setErrors] = useState<CorrectErrors>({});
  /** La domanda di conferma per un rimasto più grande di quanto era entrato; finché c'è, «Salva» lascia il posto alla risposta. */
  const [question, setQuestion] = useState<string | null>(null);
  const remainingRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors({});
  };
  const many = scope === "all" && group.length > 1;

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const wanted = many ? null : readAmount(remainingText);
    const ask = wanted === null ? null : overInitialQuestion(lot, wanted);
    if (ask) {
      setErrors({});
      setQuestion(ask);
      return;
    }
    void save();
  }

  async function save() {
    const events = log.data;
    const voided = pantry.data?.voidedEventIds;
    if (!events || !voided) {
      setErrors({ form: "Un attimo, sto ancora caricando. Riprova." });
      return;
    }
    const found: { remaining?: string } = {};
    const failed = await perform((ctx) => {
      const wanted = readAmount(remainingText);
      const quantity: QuantityCorrection | undefined = many
        ? undefined
        : buildQuantityCorrection({ lot, creation, remaining: wanted ?? Number.NaN, log: events, ctx });
      const targets = many
        ? group.flatMap((g) => {
            const c = findCreationEvent(events, g.lot.lotId, voided);
            return c ? [{ lot: g.lot, creation: c }] : [];
          })
        : [];
      const result = mergeCorrection({
        quantity,
        edit: many ? buildEditMany(targets, lot, form, ctx) : buildEdit(creation, lot, form, ctx),
        name: cleanName(form.name) || lot.productRef,
        ...(wanted !== null ? { remaining: { value: wanted, unit: lot.unit } } : {}),
        packs: many ? targets.length : 1,
      });
      if (!result.ok) found.remaining = result.remaining;
      return result;
    }, true);
    if (failed && !failed.ok) {
      const fields = "fields" in failed ? failed.fields : undefined;
      setErrors({ ...(fields ?? (found.remaining ? {} : { form: failed.error })), ...(found.remaining ? { remaining: found.remaining } : {}) });
    }
  }

  const field = (key: keyof CorrectErrors) =>
    errors[key] ? (
      <p className={ui.error} id={`${ids}-${key}-error`}>
        {errors[key]}
      </p>
    ) : null;
  const invalid = (key: keyof CorrectErrors) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${ids}-${key}-error` } : {});

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <StepTitle>Correggi</StepTitle>
      <ScopePick count={group.length} value={scope} onChange={setScope} />
      {many ? <p className={ui.hint}>Cambio solo ciò che correggi qui: le altre date restano come sono.</p> : null}

      {many ? null : (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-remaining`}>
            Quanto ne resta
          </label>
          <div className={styles.withUnit}>
            <input
              id={`${ids}-remaining`}
              ref={remainingRef}
              className={ui.input}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={remainingText}
              onChange={(e) => {
                setRemainingText(e.target.value);
                setErrors({});
                setQuestion(null);
              }}
              aria-describedby={errors.remaining ? `${ids}-unit ${ids}-remaining-error` : `${ids}-unit`}
              aria-invalid={errors.remaining ? true : undefined}
            />
            <span className={styles.unit} id={`${ids}-unit`}>
              {lot.unit}
            </span>
          </div>
          {field("remaining")}
        </div>
      )}

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-name`}>
          Nome
        </label>
        <input
          id={`${ids}-name`}
          className={ui.input}
          type="text"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
          autoComplete="off"
          {...invalid("name")}
        />
        {field("name")}
      </div>

      {needsSameProductAnswer(lot, form) ? (
        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>È ancora lo stesso prodotto?</legend>
          <p className={ui.hint}>
            Questo alimento è legato a un codice a barre. Se ora è un altro prodotto, tolgo il codice: così non prende i valori
            nutrizionali del vecchio.
          </p>
          <div className={ui.choices}>
            {(
              [
                ["yes", "Sì, è lo stesso"],
                ["no", "No, è un altro"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className={ui.choice}>
                <input type="radio" name={`${ids}-same`} value={value} checked={form.sameProduct === value} onChange={() => set("sameProduct", value)} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          {field("sameProduct")}
        </fieldset>
      ) : null}

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-category`}>
          Categoria
        </label>
        <select
          id={`${ids}-category`}
          className={ui.input}
          value={form.category}
          onChange={(e) => set("category", e.target.value)}
          {...invalid("category")}
        >
          <option value="">{lot.category ? "Scegli una categoria" : "Nessuna categoria"}</option>
          {FOOD_CATEGORY_GROUPS.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.categories.map((c) => (
                <option key={c} value={c}>
                  {FOOD_CATEGORY_LABELS[c]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {field("category")}
      </div>

      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Scadenza</legend>
        <div className={ui.choices}>
          {(["use_by", "best_before", "none"] as const satisfies readonly (ChosenExpiryKind | "none")[]).map((k) => (
            <label key={k} className={ui.choice}>
              <input
                type="radio"
                name={`${ids}-kind`}
                value={k}
                checked={form.expiryKind === k}
                onChange={() => set("expiryKind", k)}
              />
              <span>{EXPIRY_KIND_LABELS[k]}</span>
            </label>
          ))}
        </div>
        {form.expiryKind !== "none" ? (
          <>
            <label className={ui.fieldLabel} htmlFor={`${ids}-date`}>
              Data in etichetta
            </label>
            <input
              id={`${ids}-date`}
              className={ui.input}
              type="date"
              value={form.expiryDate}
              onChange={(e) => set("expiryDate", e.target.value)}
              {...invalid("expiryDate")}
            />
            {field("expiryDate")}
            <ExpiryShortcuts today={dayOf(now)} onPick={(date) => set("expiryDate", date)} />
          </>
        ) : null}
      </fieldset>

      {canEditPrice(creation) ? (
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-price`}>
            Prezzo <span className={ui.optional}>(facoltativo)</span>
          </label>
          <input
            id={`${ids}-price`}
            className={ui.input}
            type="text"
            inputMode="decimal"
            value={form.priceText}
            onChange={(e) => set("priceText", e.target.value)}
            autoComplete="off"
            placeholder="3,50"
            {...invalid("price")}
          />
          {field("price")}
        </div>
      ) : null}

      {errors.form ? (
        <p className={ui.error} role="alert">
          {errors.form}
        </p>
      ) : null}

      {question && !many ? (
        <div className={ui.calloutStrong} role="alert">
          <p className={ui.paragraph}>{question}</p>
          <div className={ui.row}>
            <Button disabled={busy} onClick={() => void save()}>
              Confermo
            </Button>
            <Button
              variant="text"
              disabled={busy}
              onClick={() => {
                setQuestion(null);
                remainingRef.current?.focus();
              }}
            >
              Correggo il numero
            </Button>
          </div>
        </div>
      ) : (
        <Button type="submit" disabled={busy}>
          {many ? `Salva (${packsText(group.length)})` : "Salva"}
        </Button>
      )}
      {group.length > 1 ? (
        <Button variant="text" onClick={onDates}>
          Date diverse per confezione
        </Button>
      ) : null}
    </form>
  );
}

function RemoveForm({ entry, group = [], busy, perform, onDiscard }: SubFormProps & { onDiscard: () => void }) {
  const { lot } = entry;
  const log = useEventLog();
  const pantry = usePantry();
  const ready = log.data !== undefined && pantry.data !== undefined;
  const [scope, setScope] = useState<Scope>("one");
  const many = scope === "all" && group.length > 1;
  const lots = many ? group.map((g) => g.lot) : [lot];
  const left = lot.remaining > 0;

  function run(kind: RemoveManyKind) {
    void perform((ctx) =>
      lots.length > 1
        ? buildRemoveMany(lots, kind, log.data ?? [], pantry.data?.voidedEventIds ?? [], ctx)
        : kind === "mistaken"
          ? buildRemoveMistaken(lot, log.data ?? [], pantry.data?.voidedEventIds ?? [], ctx)
          : buildFinish(lot, ctx),
    );
  }

  return (
    <div className={styles.form}>
      <StepTitle>Elimina dalla dispensa</StepTitle>
      <ScopePick count={group.length} value={scope} onChange={setScope} />
      <p className={ui.hint}>
        {many
          ? "Inserite per sbaglio: le tolgo come se non le avessi mai aggiunte, senza contarle come acquisto, spreco o spesa. Si può annullare subito dopo."
          : "Inserito per sbaglio: lo tolgo come se non l'avessi mai aggiunto, senza contarlo come acquisto, spreco o spesa. Si può annullare subito dopo."}
      </p>
      <Button variant="outline" disabled={busy || !ready} onClick={() => run("mistaken")}>
        {many ? `Inserite per sbaglio (${packsText(lots.length)})` : "Inserito per sbaglio"}
      </Button>
      {left ? (
        <>
          <p className={ui.hint}>Non c&apos;è più: finito, regalato o buttato. «Finito» non conta come spreco.</p>
          <div className={ui.row}>
            <Button variant="outline" disabled={busy || !ready} onClick={() => run("finished")}>
              {many ? `Finite (${packsText(lots.length)})` : "Finito"}
            </Button>
            {many ? null : (
              <Button variant="text" disabled={busy} onClick={onDiscard}>
                Buttato
              </Button>
            )}
          </div>
          {many ? <p className={ui.hint}>Per segnare come buttato, scegli «Questa confezione»: si fa una alla volta.</p> : null}
        </>
      ) : null}
    </div>
  );
}

/** Per un gruppo: una data diversa per alcune confezioni soltanto. */
function DatesForm({ entry, group = [], now, busy, perform }: SubFormProps & { now: string }) {
  const ids = useId();
  const log = useEventLog();
  const pantry = usePantry();
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set([entry.lot.lotId]));
  const [kind, setKind] = useState<ChosenExpiryKind>(entry.lot.expiry?.kind === "use_by" ? "use_by" : "best_before");
  const [date, setDate] = useState(entry.lot.expiry?.date ?? "");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const ready = log.data !== undefined && pantry.data !== undefined;
  const chosen = group.filter((g) => picked.has(g.lot.lotId)).map((g) => g.lot);

  async function save(expiry: { date: string; kind: ChosenExpiryKind } | null) {
    setFieldError(null);
    const failed = await perform(
      (ctx) => buildSetExpiry(chosen, expiry, log.data ?? [], pantry.data?.voidedEventIds ?? [], ctx),
      true,
    );
    if (failed && !failed.ok) setFieldError(failed.error);
  }

  return (
    <div className={styles.form}>
      <StepTitle>Date diverse per confezione</StepTitle>
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Per quali confezioni</legend>
        <div className={ui.choices}>
          {group.map((g, i) => {
            const d = entryDate(g);
            return (
              <label key={g.lot.lotId} className={ui.choice}>
                <input
                  type="checkbox"
                  checked={picked.has(g.lot.lotId)}
                  onChange={() =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (!next.delete(g.lot.lotId)) next.add(g.lot.lotId);
                      return next;
                    })
                  }
                />
                <span>{`${i + 1}: ${d ? formatCalendarDate(d) : "senza data"}`}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Tipo di data</legend>
        <div className={ui.choices}>
          {(["use_by", "best_before"] as const).map((k) => (
            <label key={k} className={ui.choice}>
              <input type="radio" name={`${ids}-kind`} value={k} checked={kind === k} onChange={() => setKind(k)} />
              <span>{EXPIRY_KIND_LABELS[k]}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-date`}>
          Nuova data
        </label>
        <input
          id={`${ids}-date`}
          className={ui.input}
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setFieldError(null);
          }}
        />
        {fieldError ? (
          <p className={ui.error} role="alert">
            {fieldError}
          </p>
        ) : null}
        <ExpiryShortcuts
          today={dayOf(now)}
          onPick={(next) => {
            setDate(next);
            setFieldError(null);
          }}
        />
      </div>
      <div className={ui.row}>
        <Button disabled={busy || !ready || chosen.length === 0 || date === ""} onClick={() => void save({ date, kind })}>
          Salva la data
        </Button>
        <Button variant="outline" disabled={busy || !ready || chosen.length === 0} onClick={() => void save(null)}>
          Togli la data
        </Button>
      </div>
    </div>
  );
}
