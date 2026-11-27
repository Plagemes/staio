"use client";

import { useId, type ReactElement } from "react";
import { ENERGY_LEVELS, type EnergyLevel, type SourceId, type WeekFrame } from "@/core/diet";
import { Disclosure } from "../common";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import { useDietLevel } from "./useDiet";
import { ESTIMATE_NOTE, NOT_MEDICAL_TEXT, levelNote, sourceDetail } from "./texts";
import { LEVEL_FAILED, LEVEL_LEGEND, LEVEL_SAVED, SECTION_HOW, SOURCE_UNVERIFIED, coverageLine, ruleTexts } from "./weekView";
import styles from "./diet.module.css";

/** Il livello energetico di esempio, tre scelte: ciò che si vede è sempre quello scritto, mai una copia. */
function LevelChoice(): ReactElement {
  const ids = useId();
  const { level, ready, save } = useDietLevel();
  const notice = useNotice();

  function choose(next: EnergyLevel) {
    if (next === level) return;
    save(next).then(
      ({ undo }) => notice.show({ message: LEVEL_SAVED(next), onUndo: undo }),
      () => notice.show({ message: LEVEL_FAILED }),
    );
  }

  return (
    <fieldset className={ui.field}>
      <legend className={ui.fieldLabel}>{LEVEL_LEGEND}</legend>
      <div className={ui.choices}>
        {ENERGY_LEVELS.map((l) => (
          <label key={l} className={ui.choice}>
            <input type="radio" name={`${ids}-level`} checked={level === l} disabled={!ready} onChange={() => choose(l)} />
            <span>{l} kcal</span>
          </label>
        ))}
      </div>
      <p className={styles.note}>{levelNote(level)}</p>
    </fieldset>
  );
}

/** «Come è calcolato»: regole, copertura della settimana, fonti, livello energetico e il fatto che non è un parere medico. */
export function HowComputed({ frame, sources }: { frame: WeekFrame; sources: readonly SourceId[] }): ReactElement {
  return (
    <Disclosure title={SECTION_HOW} quiet>
      <div className={styles.how}>
        <ul className={ui.bullets}>
          {ruleTexts().map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <p className={styles.note}>{coverageLine(frame)}</p>
        <p className={styles.note}>{ESTIMATE_NOTE}</p>
        <LevelChoice />
        <div>
          <p className={styles.subhead}>Fonti</p>
          <ul className={styles.sources}>
            {sources.map((id) => {
              const s = sourceDetail(id);
              return (
                <li key={id}>
                  {s.url ? (
                    <a className={ui.textLink} href={s.url} target="_blank" rel="noopener noreferrer">
                      {s.title}
                    </a>
                  ) : (
                    <span>{s.title}</span>
                  )}
                  {!s.verified ? <span className={styles.note}> ({SOURCE_UNVERIFIED})</span> : null}
                </li>
              );
            })}
          </ul>
        </div>
        <p className={styles.note}>{NOT_MEDICAL_TEXT}</p>
      </div>
    </Disclosure>
  );
}
