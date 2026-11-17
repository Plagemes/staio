"use client";

import { useId } from "react";
import { Button } from "@/design";
import { MAX_PACKS, checkPackGroups, groupsTotal, packsLabel, type PackGroup, type PiecesResolved } from "../barcode/directAdd";
import { formatQuantity } from "@/core/units";
import type { Quantity } from "@/core/ledger";
import ui from "../ui.module.css";
import styles from "./PackControls.module.css";

/** Contatore − 1 + con aree di tocco comode. */
export function Stepper({
  value,
  min,
  max,
  onChange,
  lessLabel,
  moreLabel,
  valueLabel,
  display,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  lessLabel: string;
  moreLabel: string;
  valueLabel?: string;
  /** Testo al posto del numero (per esempio «nessuno»). */
  display?: string;
}) {
  return (
    <div className={styles.stepper}>
      <button type="button" className={styles.stepButton} aria-label={lessLabel} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <output className={styles.stepValue} aria-label={valueLabel}>
        {display ?? value}
      </output>
      <button type="button" className={styles.stepButton} aria-label={moreLabel} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </div>
  );
}

/** «Quante confezioni», con il totale («3 × 170 g») quando la quantità di una confezione si legge. */
export function PackCounter({ packs, onChange, quantityOne }: { packs: number; onChange: (n: number) => void; quantityOne: string }) {
  const id = useId();
  return (
    <div className={ui.field} role="group" aria-labelledby={`${id}-label`}>
      <span className={ui.fieldLabel} id={`${id}-label`}>
        Quante confezioni
      </span>
      <div className={styles.stepperRow}>
        <Stepper
          value={packs}
          min={1}
          max={MAX_PACKS}
          onChange={onChange}
          lessLabel="Una confezione in meno"
          moreLabel="Una confezione in più"
        />
        {quantityOne ? <span className={ui.hint}>{packsLabel(packs, quantityOne)}</span> : null}
      </div>
    </div>
  );
}

/** Gruppi di confezioni, ognuno con la sua data (vuota = stima); la somma deve dare il totale. */
export function PackGroupsEditor({
  groups,
  packs,
  onChange,
  onSameDate,
}: {
  groups: readonly PackGroup[];
  packs: number;
  onChange: (groups: PackGroup[]) => void;
  onSameDate: () => void;
}) {
  const setGroup = (index: number, patch: Partial<PackGroup>) =>
    onChange(groups.map((g, i) => (i === index ? { ...g, ...patch } : g)));
  return (
    <>
      {groups.map((g, i) => (
        <div key={i} className={styles.groupRow}>
          <Stepper
            value={g.count}
            min={0}
            max={MAX_PACKS}
            onChange={(n) => setGroup(i, { count: n })}
            lessLabel={`Una confezione in meno nel gruppo ${i + 1}`}
            moreLabel={`Una confezione in più nel gruppo ${i + 1}`}
            valueLabel={`Confezioni del gruppo ${i + 1}`}
          />
          <input
            className={`${ui.input} ${styles.groupDate}`}
            type="date"
            value={g.expiryDate}
            aria-label={`Data del gruppo ${i + 1}, vuota per la stima`}
            onChange={(e) => setGroup(i, { expiryDate: e.target.value })}
          />
        </div>
      ))}
      <p className={ui.hint} aria-live="polite">
        {checkPackGroups(groups, packs) ?? `Assegnate ${groupsTotal(groups)} confezioni su ${packs}. Un gruppo senza data usa la stima.`}
      </p>
      <div className={ui.row}>
        <Button variant="outline" onClick={() => onChange([...groups, { count: 0, expiryDate: "" }])}>
          Aggiungi un gruppo
        </Button>
        <Button variant="text" onClick={onSameDate}>
          Stessa data per tutte
        </Button>
      </div>
    </>
  );
}

const MAX_PIECES = 48;

/**
 * «Pezzi dentro la confezione»: facoltativo, con la grammatura di un pezzo calcolata da sola e modificabile.
 * Non è il numero di confezioni: qui si parla di ciò che sta dentro una confezione sola.
 */
export function PiecesField({
  total,
  count,
  onCount,
  eachText,
  onEachText,
  resolved,
  pieceName,
  note,
  suggestion,
}: {
  /** Quantità di una confezione; senza, i pezzi non si possono calcolare. */
  total: Quantity | undefined;
  count: number;
  onCount: (n: number) => void;
  eachText: string | null;
  onEachText: (text: string | null) => void;
  resolved: PiecesResolved;
  pieceName?: string;
  /** Da dove viene il valore («Secondo Open Food Facts…»). */
  note?: string;
  /** Una proposta da accettare con un tocco. */
  suggestion?: { text: string; onUse: () => void };
}) {
  const id = useId();
  if (total?.unit === "pz") return null;
  const noun = pieceName ?? "pezzo";
  const autoEach = total && count >= 2 ? Math.round((total.value / count) * 100) / 100 : undefined;
  return (
    <fieldset className={ui.field}>
      <legend className={ui.fieldLabel}>
        Pezzi dentro la confezione <span className={ui.optional}>(facoltativo)</span>
      </legend>
      <p className={ui.hint} id={`${id}-hint`}>
        Per esempio 2 piadine da 100 g in una busta sola. Non sono più confezioni: la busta resta una.
      </p>
      <div className={styles.stepperRow}>
        <Stepper
          value={count}
          min={0}
          max={MAX_PIECES}
          onChange={(n) => onCount(n === 1 ? (count === 0 ? 2 : 0) : n)}
          lessLabel="Un pezzo in meno dentro la confezione"
          moreLabel="Un pezzo in più dentro la confezione"
          valueLabel="Pezzi dentro la confezione"
          display={count === 0 ? "nessuno" : String(count)}
        />
        {count >= 2 ? <span className={ui.hint}>{noun === "pezzo" ? "pezzi" : noun}</span> : null}
      </div>
      {suggestion && count < 2 ? (
        <div className={ui.row}>
          <span className={ui.hint}>{suggestion.text}</span>
          <Button variant="outline" onClick={suggestion.onUse}>
            Usa
          </Button>
        </div>
      ) : null}
      {count >= 2 ? (
        total ? (
          <>
            <label className={ui.fieldLabel} htmlFor={`${id}-each`}>
              Quanto pesa un pezzo
            </label>
            <input
              id={`${id}-each`}
              className={ui.input}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={eachText ?? ""}
              placeholder={autoEach !== undefined ? formatQuantity({ value: autoEach, unit: total.unit }) : ""}
              onChange={(e) => onEachText(e.target.value === "" ? null : e.target.value)}
              aria-invalid={resolved.error ? true : undefined}
              aria-describedby={`${id}-each-note`}
            />
            <p className={resolved.error ? ui.error : ui.hint} id={`${id}-each-note`}>
              {resolved.error ??
                (resolved.agrees === false
                  ? `${count} × ${formatQuantity({ value: resolved.each ?? 0, unit: total.unit })} non fa ${formatQuantity(total)}: vale la quantità della confezione e i pezzi sono una stima.`
                  : eachText === null || eachText === ""
                    ? `Calcolato: ${formatQuantity(total)} ÷ ${count}. Puoi cambiarlo.`
                    : "")}
            </p>
          </>
        ) : (
          <p className={ui.hint}>Scrivi prima la quantità della confezione: da quella calcolo il peso di un pezzo.</p>
        )
      ) : null}
      {note && count >= 2 ? <p className={ui.hint}>{note}</p> : null}
    </fieldset>
  );
}
