"use client";

import { useId, useState, type ReactElement } from "react";
import { Button } from "@/design";
import { parseQuantityInUnit } from "../actions";
import { ActionList, Sheet, type ActionItem } from "../common";
import ui from "../ui.module.css";
import { formatQuantity } from "@/core/units";
import type { StockRow } from "./stockView";

/** Ogni azione è una sola scrittura: il foglio si chiude, poi compare l'avviso con «Annulla». */
export interface StockActions {
  set: (value: number) => void;
  remove: () => void;
}

const PLACEHOLDER = { pz: "2", ml: "1 l", g: "500 g" } as const;

/** Il foglio di una scorta minima: il campo con «Salva» nel piede, il suggerimento e «Togli la scorta» sotto. */
export function StockSheet({ row, actions, onClose }: { row: StockRow; actions: StockActions; onClose: () => void }): ReactElement {
  const fieldId = useId();
  const formId = useId();
  const [text, setText] = useState(row.minimumText ?? "");
  const [error, setError] = useState<string | null>(null);
  const changed = text.trim() !== (row.minimumText ?? "");

  function save() {
    const read = parseQuantityInUnit(text, row.unit);
    if (!read.ok) return setError(read.error);
    if (read.quantity.value === row.minimum) return onClose();
    actions.set(read.quantity.value);
  }

  const rows: ActionItem[] = [
    ...(row.suggestion ? [{ id: "use", label: `Usa il suggerimento: ${formatQuantity({ value: row.suggestion.suggested, unit: row.unit })}`, onSelect: () => actions.set(row.suggestion!.suggested) }] : []),
    ...(row.minimum !== undefined ? [{ id: "remove", label: "Togli la scorta", danger: true, onSelect: actions.remove }] : []),
  ];

  return (
    <Sheet
      title={`Scorta minima di ${row.name}`}
      onClose={onClose}
      head={
        <div>
          <p className={ui.hint}>{row.stockText}.</p>
          <p className={ui.hint}>{row.suggestionText ? `${row.suggestionText}.` : row.noSuggestionText}</p>
        </div>
      }
      footer={
        <Button type="submit" form={formId} disabled={!changed}>
          Salva
        </Button>
      }
    >
      <form
        id={formId}
        className={ui.field}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        noValidate
      >
        <label className={ui.fieldLabel} htmlFor={fieldId}>
          Scorta minima
        </label>
        <input
          id={fieldId}
          className={ui.input}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder={PLACEHOLDER[row.unit]}
          autoComplete="off"
          aria-invalid={error ? true : undefined}
        />
      </form>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      {rows.length > 0 ? <ActionList items={rows} /> : null}
    </Sheet>
  );
}
