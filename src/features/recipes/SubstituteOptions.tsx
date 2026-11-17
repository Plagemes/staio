"use client";

import type { Substitute } from "@/core/recipes";
import { Button } from "@/design";
import styles from "./recipes.module.css";
import { SUBSTITUTE_NOTICE } from "./substitutes";

/**
 * Sotto un ingrediente che non è in dispensa: ciò che hai in casa e può prenderne il posto, al massimo due. Un tocco sceglie,
 * un tocco toglie. Ogni proposta dice che è una sostituzione; l'avviso di un allergene non verificabile sta accanto al nome.
 */
export function SubstituteOptions({
  ingredient,
  options,
  chosen,
  onChoose,
}: {
  ingredient: string;
  options: readonly Substitute[];
  chosen: string | undefined;
  onChoose: (name: string | null) => void;
}) {
  const shown = chosen !== undefined && !options.some((o) => o.name === chosen) ? [{ name: chosen } as Pick<Substitute, "name" | "doubt" | "note">, ...options] : options;
  return (
    <div className={styles.substitutes} role="group" aria-label={`Al posto di ${ingredient}`}>
      <span className={styles.note}>Al posto di «{ingredient}» hai in casa:</span>
      <div className={styles.subChoices}>
        {shown.map((o) => {
          const on = o.name === chosen;
          return (
            <button
              key={o.name}
              type="button"
              className={on ? styles.subChoiceOn : styles.subChoice}
              aria-pressed={on}
              onClick={() => onChoose(on ? null : o.name)}
            >
              {o.name}
            </button>
          );
        })}
      </div>
      <p className={styles.note}>
        {SUBSTITUTE_NOTICE}
        {chosen !== undefined ? " Stessa quantità: la cambi quando registri il pasto." : ""}
      </p>
      {shown.flatMap((o) => [
        ...(o.doubt ?? []).map((line, i) => (
          <p key={`${o.name}-d${i}`} className={styles.noteStrong}>
            {line}
          </p>
        )),
        ...(o.note ? [<p key={`${o.name}-n`} className={styles.note}>{o.note}</p>] : []),
      ])}
      {chosen !== undefined ? (
        <div>
          <Button variant="text" onClick={() => onChoose(null)}>
            Togli la sostituzione
          </Button>
        </div>
      ) : null}
    </div>
  );
}
