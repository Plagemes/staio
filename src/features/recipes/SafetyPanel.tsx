import { ALLERGEN_CHECK_NOTICE } from "@/core/allergens";
import ui from "../ui.module.css";
import styles from "./recipes.module.css";
import { clearText, type IngredientFlag } from "./safety";
import type { RecipeSafetyState } from "./useRecipeSafety";

/** L'esito del controllo per una ricetta: contiene, non verificabile, nessuna corrispondenza (mai «sicura»). */
export function SafetyPanel({ state, notice = true, title = "Allergeni ed esclusioni" }: { state: RecipeSafetyState; notice?: boolean; title?: string }) {
  if (state.status === "none") return null;
  if (state.status === "loading") {
    return (
      <section className={ui.section} aria-label={title}>
        <p className={ui.hint}>Controllo gli ingredienti…</p>
      </section>
    );
  }
  const { safety, declared } = state;
  return (
    <section className={ui.section} aria-label={title}>
      {safety.contains.length > 0 ? (
        <div role="alert" className={styles.safetyContains}>
          <strong>Contiene qualcosa che hai dichiarato</strong>
          {safety.contains.map((l, i) => (
            <p key={i} className={styles.safetyLine}>
              {l}
            </p>
          ))}
        </div>
      ) : null}
      {safety.uncertain.length > 0 ? (
        <div className={styles.safetyUncertain}>
          <strong>Non verificabile</strong>
          {safety.uncertain.map((l, i) => (
            <p key={i} className={styles.safetyLine}>
              {l}
            </p>
          ))}
        </div>
      ) : null}
      {safety.verdict === "clear" ? <p className={ui.paragraph}>{clearText(declared)}</p> : null}
      {notice ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}
    </section>
  );
}

/** Accanto all'ingrediente: «contiene latte» o «non so cosa contiene: controlla l'etichetta». */
export function FlagText({ flag }: { flag: IngredientFlag | undefined }) {
  if (!flag) return null;
  return <span className={flag.verdict === "contains" ? styles.flagContains : styles.flagUncertain}>{flag.text}</span>;
}
