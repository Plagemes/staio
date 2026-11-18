"use client";

import { useId, useState, type ReactElement } from "react";
import { formatQuantity } from "@/core/units";
import { Button } from "@/design";
import ui from "../ui.module.css";
import styles from "./QuantityPicker.module.css";
import { nudge, readAmount, writeAmount } from "./quantity";

export interface QuantityOption {
  id: string;
  label: string;
  value: number;
  estimated?: boolean;
}

export interface QuantityValue {
  value: number;
  estimated: boolean;
  /** La pastiglia scelta; assente se il numero è scritto a mano. */
  optionId?: string;
}

export interface QuantityPickerProps {
  /** «Quanto». */
  label: string;
  unit: "g" | "ml" | "pz";
  /** Le pastiglie, già calcolate da chi chiama, nell'ordine dato. */
  options: readonly QuantityOption[];
  /** null: nessuna scelta. */
  value: QuantityValue | null;
  onChange: (value: QuantityValue | null) => void;
  /** Quanto ne resta: oltre, il campo dà errore. */
  max?: number;
  error?: string | null;
}

/** Il selettore di quantità: una riga di pastiglie e, dietro l'ultima, un campo numerico con l'unità fissa e i tasti «−» e «+». */
export function QuantityPicker({ label, unit, options, value, onChange, max, error }: QuantityPickerProps): ReactElement {
  const ids = useId();
  /**
   * «Altra quantità» scelta a mano: resta scelta anche mentre il campo è vuoto o sbagliato (valore `null`).
   * Parte già scelta se all'apertura c'è un valore che non è una pastiglia (una quantità da correggere): altrimenti,
   * svuotando il campo per riscriverla, il campo sparirebbe.
   */
  const [custom, setCustom] = useState(() => value !== null && !options.some((option) => option.id === value.optionId));
  const [text, setText] = useState("");

  const chosen = value === null ? undefined : options.find((option) => option.id === value.optionId);
  const customChosen = chosen === undefined && (custom || value !== null);
  // un valore arrivato da fuori che non è una pastiglia si legge nel campo
  const shown = value !== null && chosen === undefined && readAmount(text) !== value.value ? writeAmount(value.value) : text;

  const fieldError = (amount: number | null, written: string): string | null => {
    if (written.trim() === "") return null;
    if (amount === null || amount <= 0) return "Scrivi un numero maggiore di zero.";
    if (max !== undefined && amount > max) return `Ne restano ${formatQuantity({ value: max, unit })}.`;
    return null;
  };
  const typedError = customChosen ? fieldError(readAmount(shown), shown) : null;

  const write = (written: string) => {
    setText(written);
    const amount = readAmount(written);
    onChange(amount !== null && fieldError(amount, written) === null ?{ value: amount, estimated: false } : null);
  };

  const step = (direction: 1 | -1) => write(writeAmount(nudge(unit, readAmount(shown), direction, max)));

  return (
    <fieldset className={ui.field}>
      <legend className={ui.fieldLabel}>{label}</legend>
      <div className={ui.choices}>
        {options.map((option) => (
          <label key={option.id} className={ui.choice}>
            <input
              type="radio"
              name={`${ids}-quantity`}
              value={option.id}
              checked={chosen?.id === option.id}
              onChange={() => {
                setCustom(false);
                onChange({ value: option.value, estimated: option.estimated ?? false, optionId: option.id });
              }}
            />
            <span>{option.label}</span>
          </label>
        ))}
        <label className={ui.choice}>
          <input
            type="radio"
            name={`${ids}-quantity`}
            value=""
            checked={customChosen}
            onChange={() => {
              setCustom(true);
              // il campo parte dal valore corrente, se c'è: da lì in poi è un numero scritto a mano
              write(value !== null ? writeAmount(value.value) : "");
            }}
          />
          <span>Altra quantità</span>
        </label>
      </div>

      {customChosen ? (
        <div className={styles.custom}>
          <div className={styles.stepper}>
            <Button variant="outline" className={styles.step} aria-label="Meno" onClick={() => step(-1)}>
              −
            </Button>
            <input
              className={ui.input}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              aria-label="Altra quantità"
              aria-describedby={`${ids}-unit${typedError ? ` ${ids}-typed` : ""}`}
              aria-invalid={typedError ? true : undefined}
              value={shown}
              onChange={(event) => write(event.target.value)}
            />
            <span className={styles.unit} id={`${ids}-unit`}>
              {unit}
            </span>
            <Button variant="outline" className={styles.step} aria-label="Più" onClick={() => step(1)}>
              +
            </Button>
          </div>
          {typedError ? (
            <p className={ui.error} id={`${ids}-typed`} role="alert">
              {typedError}
            </p>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
