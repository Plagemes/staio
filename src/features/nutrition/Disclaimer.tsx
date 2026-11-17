import { NUTRITION_DISCLAIMER, NUTRITION_DISCLAIMER_SHORT } from "./labels";
import styles from "./nutrition.module.css";

/** Nota fissa in fondo alle schermate di nutrizione: fonte, stime, nessun parere medico. */
export function NutritionDisclaimer({ short = false }: { short?: boolean }) {
  return <p className={styles.disclaimer}>{short ? NUTRITION_DISCLAIMER_SHORT : NUTRITION_DISCLAIMER}</p>;
}
