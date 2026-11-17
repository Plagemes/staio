"use client";

import { useState } from "react";
import { Button } from "@/design";
import { formatPrice } from "../format";
import { FOOD_CATEGORY_GROUPS, FOOD_CATEGORY_LABELS, LOCATION_LABELS, LOCATION_ORDER } from "../labels";
import ui from "../ui.module.css";
import { LineBarcode } from "./LineBarcode";
import type { ReviewLine } from "./receiptEvents";
import { linkedProductText, unlinkPatch, type LinePatch } from "./receiptProduct";
import styles from "./ReceiptCapture.module.css";

/** Cosa ricordo di una riga, detto in poche parole. */
function rememberedText(line: ReviewLine): string {
  const entry = line.remembered?.entry;
  if (!entry) return "";
  if (entry.ignore) return "l'hai ignorata";
  return `${entry.name}, ${entry.quantity}, in ${LOCATION_LABELS[entry.location].toLowerCase()}`;
}

export function ReviewRow({
  idBase,
  line,
  error,
  onChange,
  onUseRemembered,
  onStopIgnoring,
}: {
  idBase: string;
  line: ReviewLine;
  error?: string;
  onChange: (patch: LinePatch) => void;
  onUseRemembered: () => void;
  /** «Non ignorarla più»: toglie subito anche il ricordo. */
  onStopIgnoring: () => void;
}) {
  const id = `${idBase}-${line.key}`;
  const [reading, setReading] = useState(false);
  const priceText = line.priceCents !== undefined ? formatPrice(line.priceCents) : "prezzo non letto";
  const discountText = line.discountCents > 0 ? `, già scontato di ${formatPrice(line.discountCents)}` : "";
  const same = line.remembered?.applied && !line.touched;
  const proposal = line.remembered && !line.remembered.applied && !line.touched;
  return (
    <li className={line.include ? styles.row : `${styles.row} ${styles.rowOff}`}>
      <label className={ui.switch}>
        <input
          type="checkbox"
          role="switch"
          checked={line.include}
          onChange={(e) => onChange({ include: e.target.checked, ...(e.target.checked ? { ignoreAlways: false } : {}) })}
        />
        <span className={ui.switchText}>
          {line.name}
          <span className={ui.hint}>
            {priceText}
            {discountText}
            {line.isFood ? "" : " · non alimentare"}
          </span>
        </span>
      </label>
      {line.raw !== "" ? <p className={styles.raw}>Sullo scontrino: {line.raw}</p> : null}
      {same ? (
        <p className={ui.hint} role="status">
          Come l&apos;ultima volta{line.remembered?.entry.ignore ? ": la salto" : ""}.
        </p>
      ) : null}
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
        <div className={styles.fields}>
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
          {error ? (
            <p className={ui.error} id={`${id}-error`}>
              {error}
            </p>
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
        </div>
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
    </li>
  );
}
