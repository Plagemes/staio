"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ALLERGEN_CHECK_NOTICE } from "@/core/allergens";
import type { Lot } from "@/core/ledger";
import type { FoodComposition } from "@/core/nutrition";
import type { Recipe } from "@/core/recipes";
import { createTasteIndex, pairingsOf, resolveTasteFood, type Pairing, type TasteSubject } from "@/core/taste";
import { useProducts } from "../nutrition/useNutrition";
import { doubtText, hiddenText, homeSubjects, recipeSubjects } from "../taste/logic";
import { useTasteData } from "../taste/useTasteData";
import ui from "../ui.module.css";
import { pantryFoods } from "./allergenLinks";
import { mainCandidates } from "./mainIngredient";
import styles from "./recipes.module.css";
import { makeFoodIdOf } from "./substitutes";
import type { RecipeSafetyState } from "./useRecipeSafety";

const SHOWN = 6;
const SOURCE_URL = "https://github.com/lamypark/FlavorGraph";

/**
 * «Con cosa sta bene» nella scheda della ricetta: una riga richiudibile, chiusa all'apertura. I dati di gusto si
 * caricano solo quando la riga si apre. Mostra gli abbinamenti dell'ingrediente principale, prima ciò che hai in casa,
 * già passati dal controllo di allergeni ed esclusioni; «Vedi tutti» porta alla schermata completa.
 */
export function PairingsRow({
  recipe,
  lots,
  foods,
  safety,
}: {
  recipe: Recipe;
  lots: readonly Lot[];
  foods: readonly FoodComposition[] | undefined;
  safety: RecipeSafetyState;
}) {
  const [open, setOpen] = useState(false);
  const first = mainCandidates(recipe.ingredients)[0];
  const label = first === undefined ? undefined : recipe.ingredients[first]?.name;
  return (
    <details className={styles.filters} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        Con cosa sta bene
        {label ? <span className={styles.summaryNote}>{label}</span> : null}
      </summary>
      {open ? <Body recipe={recipe} lots={lots} foods={foods} safety={safety} /> : null}
    </details>
  );
}

function Body({
  recipe,
  lots,
  foods,
  safety,
}: {
  recipe: Recipe;
  lots: readonly Lot[];
  foods: readonly FoodComposition[] | undefined;
  safety: RecipeSafetyState;
}) {
  const taste = useTasteData();
  const products = useProducts();
  const index = useMemo(() => (taste.status === "ready" ? createTasteIndex(taste.data) : undefined), [taste]);

  const view = useMemo(() => {
    if (!index || !foods || !products || safety.status === "loading") return undefined;
    const declared = safety.status === "ready" ? safety.declared : { allergens: [], excludedFoods: [] };
    const foodIdOf = makeFoodIdOf(foods);
    const subjects = recipeSubjects(recipe, foodIdOf);
    const picked = mainCandidates(recipe.ingredients)
      .map((i) => subjects[i])
      .find((s): s is TasteSubject => s !== undefined && resolveTasteFood(index, s) !== undefined);
    if (!picked) return { kind: "none" as const };
    const home = homeSubjects(pantryFoods(lots, products), foodIdOf);
    const result = pairingsOf(index, picked, { home, ...declared, limit: SHOWN });
    if (result.status !== "ok") return { kind: "none" as const };
    const ordered = [...result.pairings.filter((p) => p.inHome), ...result.pairings.filter((p) => !p.inHome)].slice(0, SHOWN);
    return {
      kind: "ok" as const,
      name: result.members[0]?.name ?? picked.name,
      pairings: ordered,
      hidden: hiddenText(result.hiddenCount),
      basis: result.basis.text,
      declared: declared.allergens.length > 0 || declared.excludedFoods.length > 0,
    };
  }, [index, foods, products, safety, recipe, lots]);

  const seeAll = (
    <Link href={`/app/ricette/abbinamenti?ricetta=${encodeURIComponent(recipe.recipeId)}`} className={ui.textLink}>
      Vedi tutti gli abbinamenti
    </Link>
  );

  if (taste.status === "error") {
    return (
      <div className={styles.pairBody}>
        <p className={ui.hint} role="alert">
          Non riesco a caricare l&apos;elenco degli abbinamenti. Controlla la connessione e riprova.
        </p>
      </div>
    );
  }
  if (!view) {
    return (
      <div className={styles.pairBody}>
        <p className={ui.hint}>Carico gli abbinamenti…</p>
      </div>
    );
  }
  if (view.kind === "none") {
    return (
      <div className={styles.pairBody}>
        <p className={ui.hint}>Nessun ingrediente di questa ricetta è nell&apos;elenco degli abbinamenti.</p>
        {seeAll}
      </div>
    );
  }
  return (
    <div className={styles.pairBody} aria-live="polite">
      <p className={styles.noteStrong}>Con {view.name.toLowerCase()}, l&apos;ingrediente principale:</p>
      <ul className={styles.pairList}>
        {view.pairings.map((p) => (
          <PairItem key={p.food.key} pairing={p} />
        ))}
      </ul>
      {view.hidden ? <p className={ui.hint}>{view.hidden}</p> : null}
      {view.declared ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}
      <p className={ui.hint}>
        {view.basis} Dati{" "}
        <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={ui.textLink}>
          FlavorGraph
        </a>{" "}
        (Park e altri, 2021), CC BY-NC-SA 3.0, solo uso non commerciale.
      </p>
      {seeAll}
    </div>
  );
}

function PairItem({ pairing }: { pairing: Pairing }) {
  return (
    <li>
      {pairing.food.name}
      {pairing.inHome ? <span className={styles.noteAccent}> · in casa</span> : null}
      {pairing.doubt ? <span className={styles.noteStrong}> {doubtText(pairing.doubt)}</span> : null}
    </li>
  );
}
