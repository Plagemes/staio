"use client";

import { useMemo } from "react";
import type { Product } from "@/core/catalog";
import { DEFAULT_STATE_PREFERENCE, compositionFromProduct, type NutrientAmounts, type NutrientKey } from "@/core/nutrition";
import { Label, Value } from "@/design";
import ui from "../ui.module.css";
import { FOOD_SOURCE_NAME, NUTRIENT_COLOR, NUTRIENT_INFO, formatNutrient } from "./labels";
import styles from "./nutrition.module.css";
import { buildResolver } from "./resolver";
import { labelSourceText } from "./sourceText";
import { useFoodOverrides, useFoods, useProducts } from "./useNutrition";

const SHOWN: readonly NutrientKey[] = ["energyKcal", "proteinG", "carbsG", "sugarsG", "fatG", "saturatedFatG", "fiberG", "saltG"];

interface TableProps {
  per100: NutrientAmounts;
  basis: "g" | "ml";
  /** Da dove vengono i valori, già scritto per esteso. */
  source: string;
  estimated: boolean;
}

/** Nutrienti per 100 g o 100 ml con la fonte accanto: una tabella generica è una stima, l'etichetta no. */
export function Per100Table({ per100, basis, source, estimated }: TableProps) {
  const present = SHOWN.filter((k) => typeof per100[k] === "number");
  if (present.length === 0) return <p className={ui.hint}>Nessun valore nutrizionale disponibile.</p>;
  return (
    <div>
      <Label>Per 100 {basis}</Label>
      <dl className={styles.per100}>
        {present.map((k) => (
          <div key={k} data-nutrient={NUTRIENT_COLOR[k]}>
            <dt>{NUTRIENT_INFO[k].label}</dt>
            <dd>
              <Value certainty={estimated ? "estimated" : "label"}>{formatNutrient(k, per100[k] as number)}</Value>
            </dd>
          </div>
        ))}
      </dl>
      <p className={ui.hint}>{source}</p>
    </div>
  );
}

/** Per la scheda di un alimento in dispensa: trova i valori come li troverebbe il calcolo del giorno. */
export function LotNutrients({ lotId, productRef, barcode }: { lotId: string; productRef: string; barcode?: string }) {
  const foods = useFoods();
  const products = useProducts();
  const overrides = useFoodOverrides();

  const found = useMemo(() => {
    if (!foods || !products) return undefined;
    const resolve = buildResolver({ foods, products, barcodes: new Map(barcode ? [[lotId, barcode]] : []), overrides });
    const result = resolve({ kind: "pantry", productRef, lotId, preferStates: DEFAULT_STATE_PREFERENCE.pantry });
    const composition = result && "failure" in result ? undefined : result;
    const failure = result && "failure" in result ? result : undefined;
    const food = composition?.origin === "table" ? foods.find((f) => f.id === composition.ref) : undefined;
    return { composition, food, failure };
  }, [foods, products, overrides, lotId, productRef, barcode]);

  if (!found) return <p className={ui.hint}>Cerco i valori nutrizionali…</p>;
  const { composition, food, failure } = found;
  if (failure) {
    return <p className={ui.hint}>{failure.message ?? "Per questo alimento la tabella non ha una voce adatta."}</p>;
  }
  if (!composition) {
    return <p className={ui.hint}>Non ho trovato valori nutrizionali per questo nome. Dopo averlo mangiato, potrai collegarlo a mano in Nutrizione.</p>;
  }
  return (
    <Per100Table
      per100={composition.per100}
      basis={composition.basis}
      estimated={composition.origin !== "label"}
      source={
        composition.origin === "label"
          ? labelSourceText(barcode, barcode ? products?.get(barcode) : undefined)
          : `Stima da una tabella generica: «${composition.name}», ${FOOD_SOURCE_NAME}${food ? ` (n. ${food.source.id})` : ""}. Può differire dal prodotto reale.`
      }
    />
  );
}

/** Per la pagina di un prodotto letto dal codice a barre: i valori d'etichetta di Open Food Facts. */
export function ProductNutrients({ product }: { product: Product }) {
  const composition = compositionFromProduct(product);
  if (!composition) return <p className={ui.hint}>Questo prodotto non riporta valori nutrizionali.</p>;
  return (
    <Per100Table
      per100={composition.per100}
      basis={composition.basis}
      estimated={false}
      source="Da etichetta, secondo Open Food Facts: i dati li inseriscono i contributori e possono contenere errori."
    />
  );
}
