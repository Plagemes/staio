"use client";

// «Come conto «Cracker integrali»»: il gruppo e la lavorazione di una voce, corretti dall'utente. Una sola scrittura
// (`saveClassOverride`), con l'avviso e «Annulla»; vale per tutte le voci con lo stesso nome (o codice). «Torna alla
// stima» toglie la correzione. Il foglio parte da ciò che l'app ha dedotto: finché non si tocca niente, «Salva» è spento.
import { useId, useRef, useState } from "react";
import { DIET_GROUPS, PROCESSING_LABEL, PROCESSING_LEVELS, type ClassOverride, type DietGroup, type ProcessingLevel } from "@/core/diet";
import { Button, cx } from "@/design";
import { Sheet } from "../common";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import styles from "./classSheet.module.css";
import { useClassOverrides } from "./useDiet";
import { saveClassOverride } from "./overrides";
import { CLASS_SHEET_RESET, CLASS_SHEET_SCOPE, capitalize, classSavedText, classSheetTitle, groupLabel } from "./texts";

/** L'avviso dopo «Torna alla stima». */
export const classResetText = (name: string): string => `Di nuovo la stima: «${name}»`;
const SAVE_FAILED_TEXT = "Non sono riuscito a salvare. Riprova.";

interface Props {
  /** Il nome della voce, nel titolo e negli avvisi. */
  name: string;
  /** `b:<codice>` o `n:<nome>`: la chiave della correzione (`LineClass.overrideKey`). */
  overrideKey: string;
  /** Ciò che l'app ha dedotto adesso: il foglio parte da qui. */
  current: { group?: DietGroup; processing?: ProcessingLevel };
  /** «Indietro» (e il tasto indietro del telefono) torna alla scheda della voce. */
  onBack: () => void;
  onClose: () => void;
}

export function ClassSheet({ name, overrideKey, current, onBack, onClose }: Props) {
  const ids = useId();
  const notice = useNotice();
  const { overrides } = useClassOverrides();
  const existing: ClassOverride | undefined = Object.hasOwn(overrides, overrideKey) ? overrides[overrideKey] : undefined;
  const [groupPicked, setGroupPicked] = useState<DietGroup | undefined>(undefined);
  const [processingPicked, setProcessingPicked] = useState<ProcessingLevel | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const group = groupPicked ?? existing?.group ?? current.group;
  const processing = processingPicked ?? existing?.processing ?? current.processing;
  // un tocco è una correzione anche se riconferma ciò che l'app aveva dedotto: da quel momento è «Corretto da te»
  const dirty = (groupPicked !== undefined && groupPicked !== existing?.group) || (processingPicked !== undefined && processingPicked !== existing?.processing);

  async function commit(value: ClassOverride | undefined, message: string) {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError(null);
    try {
      const { undo } = await saveClassOverride(overrideKey, value);
      onClose();
      notice.show({ message, onUndo: undo });
    } catch {
      setError(SAVE_FAILED_TEXT);
    } finally {
      running.current = false;
      setBusy(false);
    }
  }

  function save() {
    if (!dirty) return;
    void commit(
      {
        ...(existing ?? {}),
        ...(groupPicked !== undefined ? { group: groupPicked } : {}),
        ...(processingPicked !== undefined ? { processing: processingPicked } : {}),
      },
      classSavedText(name),
    );
  }

  const groupId = `${ids}-group`;
  const levelsId = `${ids}-levels`;

  return (
    <Sheet
      title={classSheetTitle(name)}
      onClose={onClose}
      onBack={onBack}
      busy={busy}
      footer={
        <Button disabled={busy || !dirty} onClick={save}>
          Salva
        </Button>
      }
    >
      <div className={styles.body}>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={groupId}>
            Gruppo
          </label>
          <select
            id={groupId}
            className={ui.input}
            value={group ?? ""}
            disabled={busy}
            onChange={(e) => {
              setGroupPicked(e.target.value as DietGroup);
              setError(null);
            }}
          >
            {group === undefined ? (
              <option value="" disabled>
                Scegli un gruppo
              </option>
            ) : null}
            {DIET_GROUPS.map((g) => (
              <option key={g} value={g}>
                {capitalize(groupLabel(g))}
              </option>
            ))}
          </select>
        </div>
        <div className={ui.field} role="radiogroup" aria-labelledby={levelsId}>
          <span id={levelsId} className={ui.fieldLabel}>
            Lavorazione
          </span>
          <div className={cx(ui.choices, styles.levels)}>
            {PROCESSING_LEVELS.map((level) => (
              <label key={level} className={ui.choice}>
                <input
                  type="radio"
                  name={`${ids}-processing`}
                  value={level}
                  checked={processing === level}
                  disabled={busy}
                  onChange={() => {
                    setProcessingPicked(level);
                    setError(null);
                  }}
                />
                <span>{capitalize(PROCESSING_LABEL[level])}</span>
              </label>
            ))}
          </div>
        </div>
        <div className={styles.foot}>
          <p className={ui.hint}>{CLASS_SHEET_SCOPE}</p>
          {existing ? (
            <Button variant="text" disabled={busy} onClick={() => void commit(undefined, classResetText(name))}>
              {CLASS_SHEET_RESET}
            </Button>
          ) : null}
        </div>
        {error ? (
          <p className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Sheet>
  );
}
