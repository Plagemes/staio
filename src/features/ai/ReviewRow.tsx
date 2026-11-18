"use client";

import { useState } from "react";
import { freshExpiryEstimate, shortcutDate, type ExpiryChoice } from "@/core/ai/receiptExpiry";
import { isCalendarDate } from "@/core/ledger";
import { Button } from "@/design";
import { EXPIRY_SHORTCUTS } from "../barcode/expiryShortcuts";
import { formatCalendarDate, formatPrice } from "../format";
import { FOOD_CATEGORY_GROUPS, FOOD_CATEGORY_LABELS, LOCATION_LABELS, LOCATION_ORDER } from "../labels";
import ui from "../ui.module.css";
import { LineBarcode } from "./LineBarcode";
import type { ReviewLine } from "./receiptEvents";
import { linkedProductText, unlinkPatch, type LinePatch } from "./receiptProduct";
import { categoryLabel, doubtText, doubtsOf, expiryNote, lineDetails, showsExpiryField } from "./receiptReview";
import styles from "./ReceiptCapture.module.css";

/** Cosa ricordo di una riga, detto in poche parole. */
function rememberedText(line: ReviewLine): string {
  const entry = line.remembered?.entry;
  if (!entry) return "";
  if (entry.ignore) return "l'hai ignorata";
  return `${entry.name}, ${entry.quantity}, in ${LOCATION_LABELS[entry.location].toLowerCase()}`;
}

/** La scadenza di un fresco, dentro la riga aperta: la stima già proposta, i tasti rapidi, la data in etichetta. */
function ExpiryField({
  id,
  estimate,
  choice,
  today,
  error,
  onChoose,
}: {
  id: string;
  /** Stima per categoria; assente se la riga non è un fresco (il campo si vede perché c'è una data scelta). */
  estimate: string | undefined;
  choice: ExpiryChoice | undefined;
  today: string | null;
  error?: string;
  onChoose: (choice: ExpiryChoice | undefined) => void;
}) {
  const labelDate = choice?.via === "label" ? choice.date : "";
  const past = today !== null && labelDate !== "" && isCalendarDate(labelDate) && labelDate < today;
  return (
    <fieldset className={ui.field}>
      <legend className={ui.fieldLabel}>Scadenza</legend>
      <p className={ui.hint} role="status">
        {choice && isCalendarDate(choice.date)
          ? `${formatCalendarDate(choice.date)}${choice.via === "shortcut" ? ", una tua stima" : ", dall'etichetta"}.`
          : estimate !== undefined
            ? `Stimata dalla categoria: ${formatCalendarDate(estimate)}. Per i freschi conta la data stampata.`
            : "Senza data scelta vale la stima per categoria."}
      </p>
      {today ? (
        <div className={styles.shortcuts}>
          {EXPIRY_SHORTCUTS.map(([label, days]) => {
            const date = shortcutDate(today, days);
            const active = choice?.via === "shortcut" && choice.date === date;
            return (
              <button key={days} type="button" className={styles.shortcut} aria-pressed={active} onClick={() => onChoose(active ? undefined : { date, via: "shortcut" })}>
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${id}-expiry`}>
          Data in etichetta
        </label>
        <input
          id={`${id}-expiry`}
          className={`${ui.input} ${styles.dateInput}`}
          type="date"
          value={labelDate}
          onChange={(e) => onChoose(e.target.value === "" ? undefined : { date: e.target.value, via: "label" })}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-expiry-error` : undefined}
        />
        {error ? (
          <p className={ui.error} id={`${id}-expiry-error`}>
            {error}
          </p>
        ) : past ? (
          <p className={ui.hint}>La data è già passata: controlla di averla scritta bene.</p>
        ) : null}
      </div>
    </fieldset>
  );
}

/**
 * Una riga della revisione. Chiusa: l'interruttore e una riga con nome, quantità, luogo, prezzo (e la scadenza dei
 * freschi); un tocco la apre. Aperta: i campi. Il dubbio, se c'è, si legge sempre, aperta o chiusa.
 */
export function ReviewRow({
  idBase,
  line,
  error,
  expiryError,
  open,
  onOpenChange,
  purchaseAt,
  today,
  onChange,
  onExpiry,
  onConfirmCategory,
  onUseRemembered,
  onStopIgnoring,
}: {
  idBase: string;
  line: ReviewLine;
  error?: string;
  expiryError?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Istante dell'acquisto (data dello scontrino): serve alla stima della scadenza. */
  purchaseAt: string;
  /** Oggi, `YYYY-MM-DD`; nullo finché non si sa (i tasti rapidi aspettano). */
  today: string | null;
  onChange: (patch: LinePatch) => void;
  onExpiry: (choice: ExpiryChoice | undefined) => void;
  /** «Va bene» sulla categoria dedotta: la riga la tiene. */
  onConfirmCategory: () => void;
  onUseRemembered: () => void;
  /** «Non ignorarla più»: toglie subito anche il ricordo. */
  onStopIgnoring: () => void;
}) {
  const id = `${idBase}-${line.key}`;
  const [reading, setReading] = useState(false);
  const discountText = line.discountCents > 0 ? ` · scontato di ${formatPrice(line.discountCents)}` : "";
  const same = line.remembered?.applied && !line.touched;
  const proposal = line.remembered && !line.remembered.applied && !line.touched;
  const doubts = doubtsOf(line, error);
  const note = expiryNote(line, purchaseAt);
  const estimate = line.include ? freshExpiryEstimate({ category: line.category, location: line.location, at: purchaseAt }) : undefined;
  const name = line.name.trim() === "" ? "Senza nome" : line.name;

  return (
    <li className={line.include ? styles.row : `${styles.row} ${styles.rowOff}`} id={`${id}-row`}>
      <div className={styles.rowHead}>
        <label className={ui.switch}>
          <input
            type="checkbox"
            role="switch"
            checked={line.include}
            aria-label={`Aggiungi ${name}`}
            onChange={(e) => onChange({ include: e.target.checked, ...(e.target.checked ? { ignoreAlways: false } : {}) })}
          />
        </label>
        <button type="button" className={styles.rowToggle} aria-expanded={open} aria-controls={`${id}-body`} onClick={() => onOpenChange(!open)}>
          <span className={styles.rowText}>
            <span className={styles.rowName}>{name}</span>
            <span className={ui.hint}>
              {lineDetails(line)}
              {discountText}
              {note ? ` · ${note}` : ""}
            </span>
            {same ? (
              <span className={ui.hint}>
                Come l&apos;ultima volta{line.remembered?.entry.ignore ? ": la salto" : ""}
              </span>
            ) : null}
          </span>
          <svg className={styles.rowArrow} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>

      {doubts.map((d) =>
        d === "error" ? (
          <p key={d} className={ui.error} id={`${id}-error`} role="alert">
            {doubtText(d, error)}
          </p>
        ) : d === "category_guessed" ? (
          <div key={d} className={ui.row}>
            <p className={ui.hint}>
              <strong>{doubtText(d, categoryLabel(line.category))}</strong>
            </p>
            <Button variant="text" onClick={onConfirmCategory}>
              Va bene
            </Button>
          </div>
        ) : (
          <p key={d} className={ui.hint}>
            <strong>{doubtText(d)}</strong>
          </p>
        ),
      )}

      {open ? (
        <div id={`${id}-body`} className={styles.fields}>
          {line.raw !== "" ? <p className={styles.raw}>Sullo scontrino: {line.raw}</p> : null}
          {proposal ? (
            <div className={ui.row}>
              <p className={ui.hint}>L&apos;ultima volta {rememberedText(line)}.</p>
              <Button variant="text" onClick={onUseRemembered}>
                Usa
              </Button>
            </div>
          ) : null}
          {line.ignoreAlways ? (
            <div className={ui.row}>
              <p className={ui.hint}>Da ora la salto, in questo negozio.</p>
              <Button variant="text" onClick={onStopIgnoring}>
                Non ignorarla più
              </Button>
            </div>
          ) : null}

          {line.include ? (
            <>
              {line.barcode ? (
                <div className={ui.row}>
                  <p className={ui.hint}>
                    {linkedProductText({ barcode: line.barcode, ...(line.productLabel ? { productLabel: line.productLabel } : {}), ...(line.localProduct ? { localProduct: true as const } : {}) })}
                  </p>
                  <Button variant="text" onClick={() => onChange(unlinkPatch())}>
                    Scollega
                  </Button>
                </div>
              ) : null}
              <div className={ui.field}>
                <label className={ui.fieldLabel} htmlFor={`${id}-name`}>
                  Nome
                </label>
                <input
                  id={`${id}-name`}
                  className={ui.input}
                  type="text"
                  value={line.name}
                  onChange={(e) => onChange({ name: e.target.value })}
                  autoComplete="off"
                  aria-invalid={error ? true : undefined}
                  aria-describedby={error ? `${id}-error` : undefined}
                />
              </div>
              <div className={ui.field}>
                <label className={ui.fieldLabel} htmlFor={`${id}-quantity`}>
                  Quantità
                </label>
                <input
                  id={`${id}-quantity`}
                  className={ui.input}
                  type="text"
                  value={line.quantityText}
                  onChange={(e) => onChange({ quantityText: e.target.value, quantityGuessed: false })}
                  autoComplete="off"
                  autoCapitalize="none"
                  aria-describedby={`${id}-quantity-hint`}
                />
                <p className={ui.hint} id={`${id}-quantity-hint`}>
                  {line.quantityGuessed ? "Non c'era sullo scontrino: ho messo 1 pezzo, correggila." : "Per esempio 500 g, 1 l, 6 pz."}
                </p>
              </div>
              <div className={ui.field}>
                <label className={ui.fieldLabel} htmlFor={`${id}-category`}>
                  Categoria
                </label>
                <select id={`${id}-category`} className={ui.input} value={line.category} onChange={(e) => onChange({ category: e.target.value })}>
                  <option value="">Scegli una categoria</option>
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
              </div>
              <fieldset className={ui.field}>
                <legend className={ui.fieldLabel}>Dove lo metti</legend>
                <div className={ui.choices}>
                  {LOCATION_ORDER.map((l) => (
                    <label key={l} className={ui.choice}>
                      <input type="radio" name={`${id}-location`} value={l} checked={line.location === l} onChange={() => onChange({ location: l })} />
                      <span>{LOCATION_LABELS[l]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {showsExpiryField(line, purchaseAt) ? (
                <ExpiryField id={id} estimate={estimate} choice={line.expiry} today={today} error={expiryError} onChoose={onExpiry} />
              ) : null}
              {reading ? (
                <LineBarcode
                  onLinked={(patch) => {
                    onChange(patch);
                    setReading(false);
                  }}
                  onClose={() => setReading(false)}
                />
              ) : null}
            </>
          ) : null}

          {!reading && !line.ignoreAlways ? (
            <div className={ui.row}>
              {line.include && !line.barcode ? (
                <Button variant="text" onClick={() => setReading(true)}>
                  Leggi il codice
                </Button>
              ) : null}
              <Button variant="text" onClick={() => onChange({ include: false, ignoreAlways: true })}>
                Ignora sempre
              </Button>
            </div>
          ) : null}
        </div>
      ) : expiryError ? (
        <p className={ui.error}>{expiryError}</p>
      ) : null}
    </li>
  );
}
