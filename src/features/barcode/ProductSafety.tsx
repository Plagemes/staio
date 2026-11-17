"use client";

import { useMemo } from "react";
import { PRODUCT_CHECK_NOTICE, assessProduct } from "@/core/allergens";
import type { Product } from "@/core/catalog";
import { usePlan } from "@/data";
import { useRecipePrefs } from "../recipes/prefs";
import { unionDeclared } from "../recipes/safety";
import { PLAN_UNREADABLE_NOTE, SAFETY_ADD_NOTE, SAFETY_FLAGS, SAFETY_HEADINGS, sortOutcomes } from "./safetyText";
import styles from "./BarcodeCapture.module.css";

/**
 * Dice subito che cosa risulta dai dati di Open Food Facts rispetto agli allergeni e alle esclusioni dichiarati nel
 * ricettario e nel piano: mai un via libera, solo «contiene», «tracce», «incerto» o «non risulta».
 * Non compare se non c'è nulla di dichiarato. Non blocca l'aggiunta alla dispensa.
 */
export function ProductSafety({ product }: { product: Product }) {
  const plan = usePlan();
  const { prefs, ready } = useRecipePrefs();
  const planAllergens = plan.data?.structure?.allergens;
  const planExcluded = plan.data?.structure?.excludedFoods;
  const allergens = useMemo(() => unionDeclared(prefs.allergens, planAllergens ?? []), [prefs.allergens, planAllergens]);
  const excludedFoods = useMemo(() => unionDeclared(prefs.excludedFoods, planExcluded ?? []), [prefs.excludedFoods, planExcluded]);
  const assessment = useMemo(() => assessProduct(product, { allergens, excludedFoods }), [product, allergens, excludedFoods]);

  // se il piano non si legge, i suoi allergeni mancano: il controllo è incompleto e va detto, anche senza altro da mostrare
  const planFailed = plan.error !== undefined && plan.error !== null;
  // finché le preferenze non sono lette non si sa se c'è qualcosa di dichiarato: meglio aspettare che mostrare un esito monco
  if (!ready || (plan.loading && !plan.data && !planFailed)) return null;
  if (assessment.verdict === "none") {
    return planFailed ? (
      <p className={styles.safetyNote} role="status">
        {PLAN_UNREADABLE_NOTE}
      </p>
    ) : null;
  }
  const verdict = assessment.verdict;
  const tone = verdict === "contains" ? styles.safetyContains : verdict === "traces" ? styles.safetyTraces : styles.safetyOpen;

  return (
    <section className={tone} aria-label="Controllo di allergeni ed esclusioni">
      <h3 className={styles.safetyTitle}>{SAFETY_HEADINGS[verdict]}</h3>
      <ul className={styles.safetyList}>
        {sortOutcomes(assessment.outcomes).map((o) => (
          <li key={`${o.kind}:${o.declared}`} className={styles.safetyItem}>
            <span className={o.verdict === "contains" ? styles.flagContains : o.verdict === "traces" ? styles.flagTraces : styles.flagOpen}>
              {SAFETY_FLAGS[o.verdict]}
            </span>{" "}
            <strong>{o.declared}</strong>
            <span className={styles.safetyText}>{o.text}</span>
          </li>
        ))}
      </ul>
      {verdict === "contains" ? <p className={styles.safetyNote}>{SAFETY_ADD_NOTE}</p> : null}
      {planFailed ? <p className={styles.safetyNote}>{PLAN_UNREADABLE_NOTE}</p> : null}
      <p className={styles.safetyNote}>{PRODUCT_CHECK_NOTICE}</p>
    </section>
  );
}
