"use client";

import { useId } from "react";
import type { DishRating } from "@/core/recipes";
import ui from "../ui.module.css";
import { RATING_LABELS, RATING_ORDER, type DishVote } from "./dishRating";

/**
 * Una riga sola, saltabile: «Com'era?» con tre scelte e «Lo rifarei». Un tocco sulla scelta già fatta la toglie.
 * Non è mai richiesta: lasciarla com'è vale come non votare.
 */
export function DishRatingRow({
  value,
  onChange,
  disabled,
  label = "Com'era?",
}: {
  value: DishVote;
  onChange: (next: DishVote) => void;
  disabled?: boolean;
  label?: string;
}) {
  const name = useId();
  const set = (rating: DishRating | undefined) => onChange({ ...(rating ? { rating } : {}), ...(value.again ? { again: true } : {}) });
  return (
    <div className={ui.field}>
      <div className={ui.row}>
        <span className={ui.fieldLabel} id={`${name}-l`}>
          {label}
        </span>
        <div className={ui.choices} role="radiogroup" aria-labelledby={`${name}-l`}>
          {RATING_ORDER.map((r) => (
            <label key={r} className={ui.choice}>
              <input
                type="radio"
                name={name}
                value={r}
                checked={value.rating === r}
                disabled={disabled}
                onChange={() => set(r)}
                onClick={() => {
                  if (value.rating === r) set(undefined);
                }}
              />
              <span>{RATING_LABELS[r]}</span>
            </label>
          ))}
        </div>
      </div>
      <label className={ui.switch}>
        <input
          type="checkbox"
          checked={value.again === true}
          disabled={disabled}
          onChange={(e) => onChange({ ...(value.rating ? { rating: value.rating } : {}), ...(e.target.checked ? { again: true } : {}) })}
        />
        <span className={ui.switchText}>Lo rifarei</span>
      </label>
    </div>
  );
}
