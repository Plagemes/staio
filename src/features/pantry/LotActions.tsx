"use client";

import { useId, useState, type FormEvent } from "react";
import type { DeclareEvent, DiscardReason, Location, PurchaseEvent } from "@/core/ledger";
import { formatQuantity } from "@/core/units";
import { Button, ExpiryTag } from "@/design";
import {
  buildConsume,
  buildDiscard,
  buildEdit,
  buildMove,
  buildOpen,
  canEditPrice,
  formFromLot,
  type ActionContext,
  type AmountChoice,
  type EditErrors,
  type EditForm,
  type EditResult,
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
import { expiryExplanation, expiryTagView, previewExpiryAfterMove, type PantryEntry } from "../lots";
import ui from "../ui.module.css";
import styles from "./LotSheet.module.css";

/**
 * Scrive gli eventi di un'azione. Restituisce il risultato solo se è fallita, altrimenti null.
 * Con `inline` l'errore non va nell'avviso del pannello: lo mostra il campo che l'ha provocato.
 */
export type Perform = (build: (ctx: ActionContext) => EditResult, inline?: boolean) => Promise<EditResult | null>;

type Mode = "menu" | "eat" | "discard" | "move" | "edit";

interface LotActionsProps {
  entry: PantryEntry;
  creation: PurchaseEvent | DeclareEvent | undefined;
  now: string;
  busy: boolean;
  perform: Perform;
  /** Il pannello mostra qui gli errori generici di un'azione. */
  error: string | null;
}

export function LotActions({ entry, creation, now, busy, perform, error }: LotActionsProps) {
  const [mode, setMode] = useState<Mode>("menu");
  const { lot } = entry;
  const back = () => setMode("menu");

  return (
    <section className={styles.actions} aria-label="Azioni">
      {mode === "menu" ? (
        <div className={styles.menu}>
          <Button onClick={() => setMode("eat")}>Mangiato</Button>
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
            {lot.openedAt !== undefined ? "Già aperto" : "Aperto"}
          </Button>
          <Button variant="outline" onClick={() => setMode("move")}>
            Sposta
          </Button>
          <Button variant="outline" disabled={!creation} onClick={() => setMode("edit")}>
            Modifica
          </Button>
        </div>
      ) : null}

      {mode === "eat" ? <AmountForm entry={entry} kind="eat" busy={busy} perform={perform} onBack={back} /> : null}
      {mode === "discard" ? <AmountForm entry={entry} kind="discard" busy={busy} perform={perform} onBack={back} /> : null}
      {mode === "move" ? <MoveForm entry={entry} now={now} busy={busy} perform={perform} onBack={back} /> : null}
      {mode === "edit" && creation ? (
        <EditFormView entry={entry} creation={creation} busy={busy} perform={perform} onBack={back} />
      ) : null}

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

interface SubFormProps {
  entry: PantryEntry;
  busy: boolean;
  perform: Perform;
  onBack: () => void;
}

function AmountForm({ entry, kind, busy, perform, onBack }: SubFormProps & { kind: "eat" | "discard" }) {
  const { lot } = entry;
  const ids = useId();
  const [text, setText] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const level = entry.urgency?.level;
  const [reason, setReason] = useState<DiscardReason>(level === "expired" || level === "past_quality" ? "expired" : "other");

  const total = formatQuantity({ value: lot.remaining, unit: lot.unit });
  const verb = kind === "eat" ? "mangiato" : "buttato";

  async function go(choice: AmountChoice) {
    const failed = await perform(
      (ctx) => (kind === "eat" ? buildConsume(lot, choice, ctx) : buildDiscard(lot, choice, reason, ctx)),
      choice.kind === "text",
    );
    if (failed && choice.kind === "text") setFieldError(failed.ok ? null : failed.error);
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

function MoveForm({ entry, now, busy, perform, onBack }: SubFormProps & { now: string }) {
  const { lot } = entry;
  const ids = useId();
  const targets = LOCATION_ORDER.filter((l) => l !== lot.location);
  const [to, setTo] = useState<Location>(targets[0]);
  const preview = previewExpiryAfterMove(lot, to, now);
  const tag = preview ? expiryTagView(preview) : undefined;
  const crossesFreezer = to === "freezer" || lot.location === "freezer";

  return (
    <div className={styles.form}>
      <h3 className={styles.formTitle}>Dove lo sposti?</h3>
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
        <Button disabled={busy} onClick={() => void perform((ctx) => buildMove(lot, to, ctx))}>
          {`Sposta in ${LOCATION_LABELS[to].toLowerCase()}`}
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
  creation,
  busy,
  perform,
  onBack,
}: SubFormProps & { creation: PurchaseEvent | DeclareEvent }) {
  const { lot } = entry;
  const ids = useId();
  const [form, setForm] = useState<EditForm>(() => formFromLot(lot));
  const [errors, setErrors] = useState<EditErrors>({});
  const set = <K extends keyof EditForm>(key: K, value: EditForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors({});
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const failed = await perform((ctx) => buildEdit(creation, lot, form, ctx), true);
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
          Salva modifiche
        </Button>
        <Button variant="text" onClick={onBack}>
          Indietro
        </Button>
      </div>
    </form>
  );
}
