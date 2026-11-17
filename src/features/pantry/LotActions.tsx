"use client";

import { useId, useState, type FormEvent } from "react";
import type { DeclareEvent, DiscardReason, Location, Lot, PurchaseEvent } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
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
  buildOpen,
  canEditPrice,
  formFromLot,
  needsSameProductAnswer,
  type ActionContext,
  type AmountChoice,
  type EditErrors,
  type EditForm,
  type EditResult,
  type RemoveManyKind,
} from "../actions";
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
import { addManualEntries } from "../shopping";
import { entryDate } from "./groups";
import { SaveExpiringLinks } from "./SaveExpiring";
import { saveActions } from "./saveActions";
import { pieceChoices } from "../pieces";
import { formatCalendarDate } from "../format";
import { useNotice } from "../notice";
import { expiryExplanation, expiryTagView, previewExpiryAfterMove, type PantryEntry } from "../lots";
import ui from "../ui.module.css";
import styles from "./LotSheet.module.css";

/**
 * Scrive gli eventi di un'azione. Restituisce il risultato solo se è fallita, altrimenti null.
 * Con `inline` l'errore non va nell'avviso del pannello: lo mostra il campo che l'ha provocato.
 */
export type Perform = (build: (ctx: ActionContext) => EditResult, inline?: boolean) => Promise<EditResult | null>;

/**
 * «Mangiato»: scrive il consumo nel diario del giorno, nel momento giusto (vedi `eaten.ts`), e la scheda lo racconta.
 * Come `Perform`, restituisce il risultato solo se è fallita.
 */
export type Eat = (lots: readonly Lot[], choice: AmountChoice, inline?: boolean) => Promise<EditResult | null>;

type Mode = "menu" | "eat" | "discard" | "move" | "edit" | "remove" | "dates";

interface LotActionsProps {
  entry: PantryEntry;
  creation: PurchaseEvent | DeclareEvent | undefined;
  /** Le confezioni uguali del gruppo (almeno due), la prima è la più vicina a scadere; vuoto se il lotto è solo. */
  group?: readonly PantryEntry[];
  now: string;
  busy: boolean;
  perform: Perform;
  eat: Eat;
  /** Il pannello mostra qui gli errori generici di un'azione. */
  error: string | null;
}

export function LotActions({ entry, creation, group = [], now, busy, perform, eat, error }: LotActionsProps) {
  const [mode, setMode] = useState<Mode>("menu");
  const [listError, setListError] = useState<string | null>(null);
  /** Luogo con cui si apre «Sposta»: il freezer se si arriva da «Sposta in freezer». */
  const [moveTo, setMoveTo] = useState<Location | undefined>();
  const notice = useNotice();
  const { lot } = entry;
  const grouped = group.length > 1;
  const pieces = pieceChoices(lot);

  /** Rimette in lista la quantità con cui era entrato: si cambia poi nella lista. */
  async function addToList() {
    setListError(null);
    try {
      const result = await addManualEntries([{ product: lot.productRef, quantity: { value: lot.initial, unit: lot.unit } }]);
      if (result.added === 0) return;
      notice.show({ message: `Aggiunto alla lista della spesa: ${lot.productRef}.`, onUndo: result.undo });
    } catch {
      setListError("Non sono riuscito ad aggiungerlo alla lista. Riprova.");
    }
  }
  const back = () => setMode("menu");
  const freezeEntry = saveActions(entry).includes("freeze") ? previewExpiryAfterMove(lot, "freezer", now) : undefined;
  const freezePreview = freezeEntry?.expiry ? expiryExplanation(freezeEntry) : null;

  return (
    <section className={styles.actions} aria-label="Azioni">
      {mode === "menu" && saveActions(entry).length > 0 ? (
        <div className={styles.save}>
          <span className={ui.hint}>Sta per scadere. Per non buttarlo:</span>
          <SaveExpiringLinks
            entry={entry}
            onFreeze={() => {
              setMoveTo("freezer");
              setMode("move");
            }}
          />
          {freezePreview ? <span className={ui.hint}>{`In freezer: ${freezePreview}`}</span> : null}
        </div>
      ) : null}
      {mode === "menu" ? (
        <div className={styles.menu}>
          {grouped ? (
            <>
              <Button disabled={busy} onClick={() => void eat([lot], { kind: "all" })}>
                {pieces.length > 0 ? "Una confezione mangiata" : "Una mangiata"}
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => void eat(group.map((g) => g.lot), { kind: "all" })}>
                {`Tutte mangiate (${group.length})`}
              </Button>
              <Button variant="outline" onClick={() => setMode("dates")}>
                Cambia la data
              </Button>
            </>
          ) : null}
          {pieces.length > 0 ? (
            <>
              <Button disabled={busy} onClick={() => void eat([lot], { kind: "value", value: pieces[0].quantity.value })}>
                Un pezzo mangiato
              </Button>
              {pieces.some((p) => p.id === "pieces-half") ? (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void eat([lot], { kind: "value", value: pieces.find((p) => p.id === "pieces-half")!.quantity.value, estimated: true })}
                >
                  Mezzo pezzo
                </Button>
              ) : null}
            </>
          ) : null}
          <Button variant={grouped || pieces.length > 0 ? "outline" : "primary"} onClick={() => setMode("eat")}>
            {grouped ? "Mangiata in parte" : "Mangiato"}
          </Button>
          <Button variant="outline" href={`/app/pasto?lotto=${encodeURIComponent(lot.lotId)}`}>
            Mangiato in un pasto
          </Button>
          <Button variant="outline" onClick={() => setMode("discard")}>
            Buttato
          </Button>
          <Button
            variant="outline"
            disabled={busy || lot.openedAt !== undefined}
            onClick={() => void perform((ctx) => buildOpen(lot, ctx))}
          >
            {lot.openedAt !== undefined ? "Già aperto" : grouped ? "Una aperta" : "Aperto"}
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              setMoveTo(undefined);
              setMode("move");
            }}
          >
            Sposta
          </Button>
          <Button variant="outline" disabled={!creation} onClick={() => setMode("edit")}>
            Modifica
          </Button>
          <Button variant="outline" onClick={() => void addToList()}>
            Aggiungi alla spesa
          </Button>
          <div className={styles.removeZone}>
            <button type="button" className={ui.danger} onClick={() => setMode("remove")}>
              Elimina dalla dispensa
            </button>
          </div>
        </div>
      ) : null}

      {mode === "remove" ? <RemoveForm entry={entry} group={group} busy={busy} perform={perform} onBack={back} onDiscard={() => setMode("discard")} /> : null}
      {mode === "eat" ? <AmountForm entry={entry} kind="eat" busy={busy} perform={perform} eat={eat} onBack={back} /> : null}
      {mode === "discard" ? <AmountForm entry={entry} kind="discard" busy={busy} perform={perform} eat={eat} onBack={back} /> : null}
      {mode === "dates" ? <DatesForm entry={entry} group={group} busy={busy} perform={perform} onBack={back} /> : null}
      {mode === "move" ? <MoveForm entry={entry} group={group} now={now} initialTo={moveTo} busy={busy} perform={perform} onBack={back} /> : null}
      {mode === "edit" && creation ? (
        <EditFormView entry={entry} group={group} creation={creation} busy={busy} perform={perform} onBack={back} />
      ) : null}

      {error || listError ? (
        <p className={ui.error} role="alert">
          {error ?? listError}
        </p>
      ) : null}
    </section>
  );
}

interface SubFormProps {
  entry: PantryEntry;
  /** Le confezioni uguali del gruppo (almeno due), oppure vuoto. */
  group?: readonly PantryEntry[];
  busy: boolean;
  perform: Perform;
  onBack: () => void;
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

function AmountForm({ entry, kind, busy, perform, eat, onBack }: SubFormProps & { kind: "eat" | "discard"; eat: Eat }) {
  const { lot } = entry;
  const ids = useId();
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const level = entry.urgency?.level;
  const [reason, setReason] = useState<DiscardReason>(level === "expired" || level === "past_quality" ? "expired" : "other");

  const total = formatQuantity({ value: lot.remaining, unit: lot.unit });
  const verb = kind === "eat" ? "mangiato" : "buttato";

  async function go(choice: AmountChoice) {
    const failed = await (kind === "eat"
      ? eat([lot], choice, choice.kind === "text")
      : perform((ctx) => buildDiscard(lot, choice, reason, ctx), choice.kind === "text"));
    if (failed && choice.kind === "text") setFieldError(failed.ok ? null : failed.error);
    // mangiato: la scheda resta aperta con l'avviso di dove è finito, e si torna alle azioni
    if (!failed && kind === "eat") onBack();
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setFieldError(null);
    void go({ kind: "text", text });
  }

  return (
    <div className={styles.form}>
      <h3 className={styles.formTitle}>{kind === "eat" ? "Quanto hai mangiato?" : "Che cosa butti?"}</h3>

      {kind === "discard" ? (
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
      ) : null}

      {pieceChoices(lot).length > 0 ? (
        <div className={ui.row}>
          {pieceChoices(lot).map((p) => (
            <Button
              key={p.id}
              variant="outline"
              disabled={busy}
              onClick={() => void go({ kind: "value", value: p.quantity.value, estimated: p.estimated })}
            >
              {p.label}
            </Button>
          ))}
        </div>
      ) : null}

      <div className={ui.row}>
        <Button disabled={busy} onClick={() => void go({ kind: "all" })}>
          {kind === "eat" ? `Tutto (${total})` : `Butta tutto (${total})`}
        </Button>
        <Button variant="outline" disabled={busy} onClick={() => void go({ kind: "half" })}>
          Metà (stima)
        </Button>
      </div>

      <form className={ui.field} onSubmit={onSubmit} noValidate>
        <label className={ui.fieldLabel} htmlFor={`${ids}-amount`}>
          Oppure scrivi quanto
        </label>
        <div className={styles.inline}>
          <input
            id={`${ids}-amount`}
            className={ui.input}
            type="text"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setFieldError(null);
            }}
            autoComplete="off"
            placeholder={lot.unit === "pz" ? "2" : lot.unit === "ml" ? "200 ml" : "200 g"}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={fieldError ? `${ids}-amount-error` : undefined}
          />
          <Button type="submit" variant="outline" disabled={busy}>
            {`Segna ${verb}`}
          </Button>
        </div>
        {fieldError ? (
          <p className={ui.error} id={`${ids}-amount-error`}>
            {fieldError}
          </p>
        ) : null}
      </form>

      <Button variant="text" onClick={onBack}>
        Indietro
      </Button>
    </div>
  );
}

function MoveForm({ entry, group = [], now, initialTo, busy, perform, onBack }: SubFormProps & { now: string; initialTo?: Location }) {
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
      <h3 className={styles.formTitle}>Dove lo sposti?</h3>
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
      <div className={ui.row}>
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
        <Button variant="text" onClick={onBack}>
          Indietro
        </Button>
      </div>
    </div>
  );
}

function EditFormView({
  entry,
  group = [],
  creation,
  busy,
  perform,
  onBack,
}: SubFormProps & { creation: PurchaseEvent | DeclareEvent }) {
  const { lot } = entry;
  const ids = useId();
  const log = useEventLog();
  const pantry = usePantry();
  const [scope, setScope] = useState<Scope>("one");
  const [form, setForm] = useState<EditForm>(() => formFromLot(lot));
  const [errors, setErrors] = useState<EditErrors>({});
  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors({});
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const failed = await perform((ctx) => {
      if (scope === "one" || group.length < 2) return buildEdit(creation, lot, form, ctx);
      const targets = group.flatMap((g) => {
        const c = findCreationEvent(log.data ?? [], g.lot.lotId, pantry.data?.voidedEventIds ?? []);
        return c ? [{ lot: g.lot, creation: c }] : [];
      });
      return buildEditMany(targets, lot, form, ctx);
    }, true);
    if (failed && !failed.ok) setErrors("fields" in failed ? failed.fields : { form: failed.error });
  }

  const field = (key: keyof EditErrors) =>
    errors[key] ? (
      <p className={ui.error} id={`${ids}-${key}-error`}>
        {errors[key]}
      </p>
    ) : null;
  const invalid = (key: keyof EditErrors) => (errors[key] ? { "aria-invalid": true, "aria-describedby": `${ids}-${key}-error` } : {});

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <h3 className={styles.formTitle}>Modifica</h3>
      <ScopePick count={group.length} value={scope} onChange={setScope} />
      {scope === "all" ? <p className={ui.hint}>Cambio solo ciò che modifichi qui: le altre date restano come sono.</p> : null}

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

      <div className={ui.row}>
        <Button type="submit" disabled={busy}>
          {scope === "all" ? `Salva modifiche (${packsText(group.length)})` : "Salva modifiche"}
        </Button>
        <Button variant="text" onClick={onBack}>
          Indietro
        </Button>
      </div>
    </form>
  );
}

function RemoveForm({ entry, group = [], busy, perform, onBack, onDiscard }: SubFormProps & { onDiscard: () => void }) {
  const { lot } = entry;
  const log = useEventLog();
  const pantry = usePantry();
  const ready = log.data !== undefined && pantry.data !== undefined;
  const [scope, setScope] = useState<Scope>("one");
  const [pending, setPending] = useState<RemoveManyKind | null>(null);
  const many = scope === "all" && group.length > 1;
  const lots = many ? group.map((g) => g.lot) : [lot];

  function run(kind: RemoveManyKind) {
    void perform((ctx) =>
      lots.length > 1
        ? buildRemoveMany(lots, kind, log.data ?? [], pantry.data?.voidedEventIds ?? [], ctx)
        : kind === "mistaken"
          ? buildRemoveMistaken(lot, log.data ?? [], pantry.data?.voidedEventIds ?? [], ctx)
          : buildFinish(lot, ctx),
    );
  }

  if (pending) {
    return (
      <div className={styles.form}>
        <h3 className={styles.formTitle}>{`Eliminare ${packsText(lots.length)}?`}</h3>
        <p className={ui.hint}>
          {pending === "mistaken"
            ? "Le tolgo come se non le avessi mai aggiunte, senza contarle come acquisto, spreco o spesa. Si può annullare subito dopo."
            : "Le segno finite, senza contarle come spreco. Si può annullare subito dopo."}
        </p>
        <div className={ui.row}>
          <Button disabled={busy || !ready} onClick={() => run(pending)}>{`Elimina ${packsText(lots.length)}`}</Button>
          <Button variant="text" disabled={busy} onClick={() => setPending(null)}>
            Indietro
          </Button>
        </div>
      </div>
    );
  }

  const choose = (kind: RemoveManyKind) => (many ? setPending(kind) : run(kind));

  return (
    <div className={styles.form}>
      <h3 className={styles.formTitle}>Elimina dalla dispensa</h3>
      <ScopePick count={group.length} value={scope} onChange={setScope} />
      <p className={ui.hint}>
        Inserito per sbaglio: lo tolgo come se non l&apos;avessi mai aggiunto, senza contarlo come acquisto, spreco o spesa. Si
        può annullare subito dopo.
      </p>
      <Button variant="outline" disabled={busy || !ready} onClick={() => choose("mistaken")}>
        {many ? `Inserite per sbaglio (${packsText(lots.length)})` : "Inserito per sbaglio"}
      </Button>
      <p className={ui.hint}>Non c&apos;è più: finito, regalato o buttato.</p>
      <div className={ui.row}>
        <Button variant="outline" disabled={busy || !ready} onClick={() => choose("finished")}>
          {many ? `Finite (${packsText(lots.length)})` : "Finito"}
        </Button>
        <Button variant="outline" disabled={busy || many} onClick={onDiscard}>
          Buttato
        </Button>
      </div>
      {many ? <p className={ui.hint}>Per segnare come buttato, scegli «Questa confezione»: si fa una alla volta.</p> : null}
      <Button variant="text" onClick={onBack}>
        Indietro
      </Button>
    </div>
  );
}

function DatesForm({ entry, group, busy, perform, onBack }: SubFormProps & { group: readonly PantryEntry[] }) {
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
      <h3 className={styles.formTitle}>Cambia la data</h3>
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
        <input id={`${ids}-date`} className={ui.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        {fieldError ? <p className={ui.error}>{fieldError}</p> : null}
      </div>
      <div className={ui.row}>
        <Button disabled={busy || !ready || chosen.length === 0 || date === ""} onClick={() => void save({ date, kind })}>
          Salva la data
        </Button>
        <Button variant="outline" disabled={busy || !ready || chosen.length === 0} onClick={() => void save(null)}>
          Togli la data
        </Button>
        <Button variant="text" onClick={onBack}>
          Indietro
        </Button>
      </div>
    </div>
  );
}
