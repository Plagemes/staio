"use client";

import { useMemo } from "react";
import { PRODUCT_CHECK_NOTICE } from "@/core/allergens";
import { needsStoreCodeConfirmation, type Product } from "@/core/catalog";
import { declaredLists, useDietDeclarations } from "../allergens";
import { DECLARATIONS_UNREADABLE_NOTE, assessForCard, isUnreliableSource, safetySourceNote, SAFETY_ADD_NOTE, SAFETY_FLAGS, SAFETY_HEADINGS, sortOutcomes } from "./safetyText";
import styles from "./BarcodeCapture.module.css";

/**
 * Dice subito che cosa risulta dai dati di Open Food Facts rispetto agli allergeni e alle esclusioni dichiarati (lettura
 * unica): mai un via libera, solo «contiene», «tracce», «incerto» o «non risulta».
 * Non compare se non c'è nulla di dichiarato. Non blocca l'aggiunta alla dispensa.
 */
export function ProductSafety({ product, confirmed = false }: { product: Product; /** L'utente ha confermato che il codice interno del negozio è ancora quel prodotto. */ confirmed?: boolean }) {
  const diet = useDietDeclarations();
  const lists = useMemo(() => (diet.state ? declaredLists(diet.state) : undefined), [diet.state]);
  const allergens = useMemo(() => lists?.allergens ?? [], [lists]);
  const excludedFoods = useMemo(() => lists?.excludedFoods ?? [], [lists]);
  // la scheda di Open Food Facts per un codice interno del negozio può essere di un altro prodotto: i suoi dati non contano
  const restricted = isUnreliableSource(product) || (needsStoreCodeConfirmation(product) && !confirmed);
  const assessment = useMemo(() => assessForCard(product, { allergens, excludedFoods }, { confirmed }), [product, allergens, excludedFoods, confirmed]);
  const sourceNote = restricted ? null : safetySourceNote(product, PRODUCT_CHECK_NOTICE);

  // se un posto delle dichiarazioni non si legge, le sue voci mancano: il controllo è incompleto e va detto, anche senza
  // altro da mostrare
  const failed = (diet.error !== undefined && diet.error !== null) || (diet.state !== undefined && !diet.state.complete);
  // finché le dichiarazioni non sono lette non si sa se c'è qualcosa di dichiarato: meglio aspettare che mostrare un esito monco
  if (!diet.state && !failed) return null;
  if (!diet.state || assessment.verdict === "none") {
    return failed ? (
      <p className={styles.safetyNote} role="alert">
        {DECLARATIONS_UNREADABLE_NOTE}
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
      {failed ? <p className={styles.safetyNote}>{DECLARATIONS_UNREADABLE_NOTE}</p> : null}
      {sourceNote ? <p className={styles.safetyNote}>{sourceNote}</p> : null}
    </section>
  );
}
