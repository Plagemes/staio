"use client";

// Le proposte di sostituzione per una ricetta aperta. I dati di gusto si caricano solo se serve davvero: se c'è almeno un
// ingrediente che manca e qualcosa in dispensa da proporre. La ricetta si apre e si legge senza aspettarli.
import { useEffect, useMemo, useState } from "react";
import { activeLots } from "@/core/ledger";
import { createTasteIndex, type TasteData, type TasteIndex } from "@/core/taste";
import { substitutesFor, type Recipe, type Substitute } from "@/core/recipes";
import { usePantry } from "@/data";
import { useFoods, useProducts } from "../nutrition/useNutrition";
import { recipeSubjects } from "../taste/logic";
import { loadTasteData } from "../taste/useTasteData";
import { pantryFoods } from "./allergenLinks";
import { homeFoodsOf, makeFoodIdOf, makeSubstituteScreen } from "./substitutes";
import { useConfirmations } from "./useConfirmations";
import { useDeclared } from "./useRecipeSafety";

export interface SubstitutesState {
  /** `idle`: niente da proporre (nulla manca, la dispensa è vuota o i dati non si sono caricati). */
  status: "idle" | "loading" | "ready";
  options: ReadonlyMap<number, readonly Substitute[]>;
  /** I dati di gusto non si sono potuti caricare. */
  failed: boolean;
}

const NONE: ReadonlyMap<number, readonly Substitute[]> = new Map();
const indexCache = new WeakMap<TasteData, TasteIndex>();

function indexOf(data: TasteData): TasteIndex {
  let index = indexCache.get(data);
  if (!index) indexCache.set(data, (index = createTasteIndex(data)));
  return index;
}

/**
 * `recipe` è la ricetta come è scritta (non quella con le sostituzioni scelte) e `missing` gli indici degli ingredienti
 * che non sono in dispensa. Per ognuno, fino a due sostituti tra ciò che c'è in casa, già passati dal controllo di
 * allergeni ed esclusioni: finché quello non è letto non si propone nulla.
 */
export function useSubstitutes(recipe: Recipe, missing: readonly number[]): SubstitutesState {
  const pantry = usePantry();
  const products = useProducts();
  const foods = useFoods();
  const { declared, ready } = useDeclared();
  const { byKey: confirmations } = useConfirmations();
  const lots = useMemo(() => (pantry.data ? activeLots(pantry.data) : []), [pantry.data]);
  const wanted = missing.length > 0 && lots.length > 0;

  const [taste, setTaste] = useState<TasteData | undefined>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!wanted || taste) return;
    let alive = true;
    loadTasteData().then(
      (data) => alive && setTaste(data),
      () => alive && setFailed(true),
    );
    return () => {
      alive = false;
    };
  }, [wanted, taste]);

  const missingKey = missing.join(",");
  const options = useMemo(() => {
    if (!wanted || !taste || !foods || !products || !ready || !confirmations) return undefined;
    const index = indexOf(taste);
    const foodIdOf = makeFoodIdOf(foods);
    const inHome = pantryFoods(lots, products);
    const home = homeFoodsOf(inHome, foodIdOf);
    const subjects = recipeSubjects(recipe, foodIdOf);
    const screen = makeSubstituteScreen({ ...declared, confirmations }, inHome);
    const out = new Map<number, readonly Substitute[]>();
    for (const i of missingKey === "" ? [] : missingKey.split(",").map(Number)) {
      const subject = subjects[i];
      const found = subject ? substitutesFor(index, subject, home, { screen }) : [];
      if (found.length > 0) out.set(i, found);
    }
    return out;
  }, [wanted, taste, foods, products, ready, confirmations, lots, recipe, declared, missingKey]);

  // senza i dati (rete assente) non si propone nulla, e chi aspetta non resta in attesa
  if (!wanted || failed) return { status: "idle", options: NONE, failed };
  return options ? { status: "ready", options, failed } : { status: "loading", options: NONE, failed };
}
