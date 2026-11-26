"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { COST_BASIS, costPerNutrient, type CostNutrient, type NutrientCostResult } from "@/core/prices";
import type { FoodComposition } from "@/core/nutrition";
import { Button, Label, SectionHeader, Tabs, Value } from "@/design";
import { derivedOf, useEventLog } from "@/data";
import { formatPrice } from "../format";
import ui from "../ui.module.css";
import styles from "./nutrition.module.css";
import { barcodesOfLots, buildResolver, type FoodOverrides } from "./resolver";
import { useProducts } from "./useNutrition";

const TABS = [
  { id: "protein", label: "Proteine" },
  { id: "energy", label: "Energia" },
  { id: "fiber", label: "Fibre" },
];
const TITLES: Record<CostNutrient, string> = {
  protein: "euro ogni 100 g di proteine",
  energy: "euro ogni 1000 kcal",
  fiber: "euro ogni 10 g di fibre",
};
const SHOWN = 5;

/**
 * Costo per nutriente degli alimenti comprati con un prezzo: un confronto, non un consiglio. Richiudibile, in fondo.
 * Con `headless` è solo il contenuto, già aperto: chi lo usa lo mette in una riga richiusa e lo rende solo da aperta.
 */
export function CostPerNutrientSection({
  foods,
  overrides,
  today,
  headless = false,
}: {
  foods: readonly FoodComposition[] | undefined;
  overrides: FoodOverrides;
  today: string;
  headless?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (headless) return foods ? <Ranking foods={foods} overrides={overrides} today={today} /> : <p className={styles.quiet}>Calcolo…</p>;
  return (
    <section className={ui.section} aria-label="Costo per nutriente">
      <div className={ui.head}>
        <SectionHeader label="Costo per nutriente" />
        <Button variant="outline" aria-expanded={open} aria-controls="cost-per-nutrient" onClick={() => setOpen(!open)}>
          {open ? "Nascondi" : "Mostra"}
        </Button>
      </div>
      <div id="cost-per-nutrient" hidden={!open}>
        {open && foods ? <Ranking foods={foods} overrides={overrides} today={today} /> : null}
      </div>
    </section>
  );
}

function Ranking({ foods, overrides, today }: { foods: readonly FoodComposition[]; overrides: FoodOverrides; today: string }) {
  const log = useEventLog();
  const products = useProducts();
  const [which, setWhich] = useState<CostNutrient>("protein");

  const result = useMemo<NutrientCostResult | undefined>(() => {
    if (!log.data || !products) return undefined;
    // la dispensa già derivata e condivisa: non si rifà sul registro, e non si modifica
    const pantry = derivedOf(log.data).pantry;
    const resolve = buildResolver({ foods, products, barcodes: barcodesOfLots(pantry.lots), overrides });
    return costPerNutrient(
      pantry.lots,
      (lot) => {
        const r = resolve({ kind: "pantry", productRef: lot.productRef, lotId: lot.lotId, ...(lot.category ? { category: lot.category } : {}) });
        return r && "origin" in r ? r : undefined;
      },
      { today },
    );
  }, [log.data, products, foods, overrides, today]);

  if (!result) return <p className={styles.quiet}>Calcolo…</p>;
  const rows = result.rankings[which];
  const ex = result.excluded;
  const left = ex.noPrice + ex.tooOld + ex.noComposition + ex.notComparable + result.noNutrientData[which];
  return (
    <>
      <p className={ui.hint}>Tra ciò che compri con un prezzo: dal più economico. È un confronto sull&apos;ultimo prezzo pagato e sui valori medi dell&apos;alimento, non un consiglio.</p>
      <Tabs label="Nutriente" items={TABS} value={which} onChange={(v) => setWhich(v as CostNutrient)} />
      {rows.length === 0 ? (
        <p className={styles.quiet}>Ancora nessun alimento con prezzo e valori nutrizionali per questo nutriente.</p>
      ) : (
        <>
          <Label>{TITLES[which]}</Label>
          <ul className={styles.contributors}>
            {rows.slice(0, SHOWN).map((r) => (
              <li key={r.key} className={styles.contributor}>
                <span>
                  {r.name}
                  {r.estimated ? " · stima" : ""}
                </span>
                <span className={styles.contributorShare}>
                  <Value certainty={r.certainty}>{formatPrice(r.cents)}</Value>
                </span>
              </li>
            ))}
          </ul>
          {rows.length > SHOWN ? <p className={ui.hint}>Altri {rows.length - SHOWN} alimenti, più cari.</p> : null}
          <p className={ui.hint}>
            Base: {COST_BASIS[which].amount} {COST_BASIS[which].unit === "kcal" ? "kcal" : "g"} di {which === "protein" ? "proteine" : which === "fiber" ? "fibre" : "energia"}.
          </p>
        </>
      )}
      {left > 0 ? (
        <p className={ui.hint}>
          Fuori dal confronto: {left} {left === 1 ? "prodotto" : "prodotti"}
          {[
            ex.noPrice > 0 ? `${ex.noPrice} senza prezzo` : null,
            ex.tooOld > 0 ? `${ex.tooOld} con prezzo troppo vecchio` : null,
            ex.noComposition > 0 ? `${ex.noComposition} non riconosciuti` : null,
            ex.notComparable > 0 ? `${ex.notComparable} in unità non confrontabili (pezzi senza peso noto)` : null,
            result.noNutrientData[which] > 0 ? `${result.noNutrientData[which]} senza il dato su questo nutriente` : null,
          ]
            .filter((x): x is string => x !== null)
            .map((x, i) => `${i === 0 ? ": " : ", "}${x}`)
            .join("")}
          .
        </p>
      ) : null}
      <Link href="/app/spesa" className={ui.textLink}>
        Torna alla spesa
      </Link>
    </>
  );
}
