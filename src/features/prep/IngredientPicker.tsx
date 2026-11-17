"use client";

import { useId } from "react";
import { formatQuantity } from "@/core/units";
import { Button, ExpiryTag } from "@/design";
import { expiryTagView, type PantryEntry } from "../lots";
import ui from "../ui.module.css";
import styles from "./prep.module.css";

export interface PickRow {
  lotId: string;
  quantityText: string;
}

interface IngredientPickerProps {
  /** Lotti della dispensa nell'ordine «da mangiare prima». */
  entries: readonly PantryEntry[];
  picks: readonly PickRow[];
  onChange: (picks: PickRow[]) => void;
  /** Per `lotId`. */
  errors?: Record<string, string>;
  label?: string;
}

/** Scelta degli ingredienti dalla dispensa con la quantità di ciascuno. Un lotto compare una volta sola. */
export function IngredientPicker({ entries, picks, onChange, errors = {}, label = "Dalla dispensa" }: IngredientPickerProps) {
  const ids = useId();
  const byId = new Map(entries.map((e) => [e.lot.lotId, e]));
  const chosen = new Set(picks.map((p) => p.lotId));
  const available = entries.filter((e) => !chosen.has(e.lot.lotId) && e.lot.remaining > 0);

  return (
    <section className={ui.field} aria-labelledby={`${ids}-h`}>
      <h2 className={ui.fieldLabel} id={`${ids}-h`}>
        {label}
      </h2>
      {entries.length === 0 ? (
        <p className={ui.hint}>La dispensa è vuota: aggiungi prima gli alimenti che userai.</p>
      ) : null}
      {picks.length > 0 ? (
        <ul className={styles.picks}>
          {picks.map((pick) => {
            const entry = byId.get(pick.lotId);
            if (!entry) return null;
            const { lot } = entry;
            const tag = expiryTagView(entry);
            const err = errors[lot.lotId];
            return (
              <li key={lot.lotId} className={styles.pick}>
                <div className={styles.pickHead}>
                  <span className={styles.pickName}>{lot.productRef}</span>
                  {tag ? (
                    <ExpiryTag level={tag.level} estimated={tag.estimated}>
                      {tag.text}
                    </ExpiryTag>
                  ) : null}
                </div>
                <span className={styles.pickLeft}>
                  Ne restano {formatQuantity({ value: lot.remaining, unit: lot.unit })}
                  {lot.remainingCertainty === "estimated" ? " (stima)" : ""}
                </span>
                <div className={styles.pickFields}>
                  <input
                    className={ui.input}
                    type="text"
                    value={pick.quantityText}
                    onChange={(e) => onChange(picks.map((p) => (p.lotId === pick.lotId ? { ...p, quantityText: e.target.value } : p)))}
                    autoComplete="off"
                    placeholder={lot.unit === "pz" ? "2" : lot.unit === "ml" ? "200 ml" : "200 g"}
                    aria-label={`Quantità di ${lot.productRef}`}
                    aria-invalid={err ? true : undefined}
                  />
                  <Button variant="text" onClick={() => onChange(picks.filter((p) => p.lotId !== pick.lotId))}>
                    Togli
                  </Button>
                </div>
                {err ? <p className={ui.error}>{err}</p> : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      {available.length > 0 ? (
        <div className={ui.field}>
          <label className={ui.hint} htmlFor={`${ids}-add`}>
            Aggiungi un alimento
          </label>
          <select
            id={`${ids}-add`}
            className={ui.input}
            value=""
            onChange={(e) => {
              const entry = byId.get(e.target.value);
              if (!entry) return;
              onChange([...picks, { lotId: entry.lot.lotId, quantityText: formatQuantity({ value: entry.lot.remaining, unit: entry.lot.unit }) }]);
            }}
          >
            <option value="">Scegli dalla dispensa…</option>
            {available.map((e) => (
              <option key={e.lot.lotId} value={e.lot.lotId}>
                {e.lot.productRef} · {formatQuantity({ value: e.lot.remaining, unit: e.lot.unit })}
              </option>
            ))}
          </select>
        </div>
      ) : null}
    </section>
  );
}
