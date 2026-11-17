"use client";

import { useId, useMemo, useState } from "react";
import type { MealKind } from "@/core/diary";
import type { PlannedItem } from "@/core/plan";
import { Button, Tabs } from "@/design";
import { readQuantity } from "../capture";
import { MEAL_KIND_LABELS } from "../meals";
import { createFoodSearch, resolveFreeItems } from "../nutrition/candidates";
import { FoodChoice } from "../nutrition/FoodChoice";
import { loadFoods, useFoods } from "../nutrition/useNutrition";
import ui from "../ui.module.css";
import { KIND_LABELS, servingsText } from "./describe";
import type { PlanData } from "./usePlanData";
import { parseAmount } from "./targets";
import styles from "./plan.module.css";

type Kind = PlannedItem["kind"];

interface PickRow {
  id: string;
  title: string;
  detail: string;
  servings: number;
}

const TABS = (Object.keys(KIND_LABELS) as Kind[]).map((id) => ({ id, label: KIND_LABELS[id] }));

interface AddEntryProps {
  data: PlanData;
  date: string;
  /** Pasti tra cui scegliere, nell'ordine della struttura del piano. */
  meals: readonly MealKind[];
  defaultMeal: MealKind;
  onAdd: (meal: MealKind, item: PlannedItem) => Promise<string | null>;
}

/** Aggiunta di una voce a un pasto: un alimento (con la stessa scelta esplicita della registrazione), una ricetta o una preparazione. */
export function AddEntry({ data, meals, defaultMeal, onAdd }: AddEntryProps) {
  const ids = useId();
  const foods = useFoods();
  const search = useMemo(() => (foods ? createFoodSearch(foods) : undefined), [foods]);
  const [kind, setKind] = useState<Kind>("food");
  const [meal, setMeal] = useState<MealKind>(defaultMeal);
  const [name, setName] = useState("");
  const [quantityText, setQuantityText] = useState("");
  const [foodId, setFoodId] = useState<string | undefined>();
  const [none, setNone] = useState(false);
  const [filter, setFilter] = useState("");
  const [refId, setRefId] = useState<string | null>(null);
  const [servingsTextValue, setServingsText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const list: PickRow[] =
    kind === "recipe"
      ? data.recipes.map((r) => ({ id: r.recipeId, title: r.title, detail: `Per ${servingsText(r.servings)}`, servings: r.servings }))
      : data.preps
          .filter((p) => p.status === "active")
          .map((p) => ({ id: p.prepId, title: p.title, detail: `${servingsText(p.remaining)} pronte su ${p.portions}`, servings: 1 }));
  const q = filter.trim().toLowerCase();
  const shown = list.filter((x) => q === "" || x.title.toLowerCase().includes(q));
  const chosen = list.find((x) => x.id === refId);

  function pick(id: string, defaultServings: number) {
    setRefId(id);
    setServingsText(String(defaultServings).replace(".", ","));
    setError(null);
  }

  async function submit() {
    setError(null);
    let item: PlannedItem;
    if (kind === "food") {
      if (name.trim() === "") return setError("Scrivi come si chiama l'alimento.");
      const q = readQuantity(quantityText);
      if (!q.ok) return setError(q.error);
      const resolved = resolveFreeItems([{ name, quantityText, foodId, none }], search ?? createFoodSearch(await loadFoods()));
      if (resolved.errors[0]) return setError(resolved.errors[0]);
      item = { kind: "food", name: name.trim().replace(/\s+/g, " "), ...(foodId ? { foodId } : {}), quantity: q.quantity };
    } else {
      if (!refId) return setError(kind === "recipe" ? "Scegli una ricetta." : "Scegli una preparazione.");
      const servings = parseAmount(servingsTextValue);
      if (servings === null || servings <= 0) return setError("Scrivi quante porzioni, per esempio 2.");
      item = kind === "recipe" ? { kind: "recipe", recipeId: refId, servings } : { kind: "prep", prepId: refId, servings };
    }
    setBusy(true);
    const result = await onAdd(meal, item);
    setBusy(false);
    if (result) setError(result);
  }

  return (
    <form
      className={ui.form}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Per quale pasto</legend>
        <div className={ui.choices}>
          {meals.map((m) => (
            <label key={m} className={ui.choice}>
              <input type="radio" name={`${ids}-meal`} value={m} checked={meal === m} onChange={() => setMeal(m)} />
              <span>{MEAL_KIND_LABELS[m]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Tabs
        label="Che cosa aggiungi"
        items={TABS}
        value={kind}
        onChange={(id) => {
          setKind(id as Kind);
          setError(null);
        }}
      />

      {kind === "food" ? (
        <div className={ui.form}>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-name`}>
              Alimento
            </label>
            <input
              id={`${ids}-name`}
              className={ui.input}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFoodId(undefined);
                setNone(false);
              }}
              autoComplete="off"
              placeholder="Pasta"
            />
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-qty`}>
              Quantità
            </label>
            <input id={`${ids}-qty`} className={ui.input} value={quantityText} onChange={(e) => setQuantityText(e.target.value)} autoComplete="off" placeholder="80 g" />
          </div>
          {search ? (
            <FoodChoice
              name={name}
              search={search}
              foodId={foodId}
              none={none}
              onPick={(id) => {
                setFoodId(id);
                setNone(false);
              }}
              onNone={() => {
                setFoodId(undefined);
                setNone(true);
              }}
              onClear={() => {
                setFoodId(undefined);
                setNone(false);
              }}
            />
          ) : null}
          <p className={ui.hint}>Il piano è un&apos;intenzione: non scala la dispensa.</p>
        </div>
      ) : (
        <div className={ui.form}>
          {list.length === 0 ? (
            <div className={ui.empty}>
              <h3 className={ui.emptyTitle}>{kind === "recipe" ? "Nessuna ricetta" : "Nessuna preparazione"}</h3>
              <p className={ui.emptyText}>
                {kind === "recipe"
                  ? "Le ricette che salvi compariranno qui, da aggiungere a un pasto con le porzioni."
                  : "Le preparazioni che cucini compariranno qui, con le porzioni ancora pronte."}
              </p>
              <Button href={kind === "recipe" ? "/app/ricette" : "/app/preparazioni"} variant="outline">
                {kind === "recipe" ? "Vai alle ricette" : "Vai alle preparazioni"}
              </Button>
            </div>
          ) : (
            <>
              {list.length > 6 ? (
                <input className={ui.input} type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Cerca per nome" aria-label="Cerca per nome" autoComplete="off" />
              ) : null}
              <ul className={styles.pickList} role="radiogroup" aria-label={kind === "recipe" ? "Ricette" : "Preparazioni"}>
                {shown.map((x) => (
                  <li key={x.id}>
                    <label className={styles.pick}>
                      <input type="radio" name={`${ids}-ref`} checked={refId === x.id} onChange={() => pick(x.id, x.servings)} />
                      <span className={styles.pickText}>
                        {x.title}
                        <span className={styles.pickDetail}>{x.detail}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {shown.length === 0 ? <p className={ui.hint}>Niente con questo nome.</p> : null}
              {chosen ? (
                <div className={ui.field}>
                  <label className={ui.fieldLabel} htmlFor={`${ids}-serv`}>
                    Porzioni
                  </label>
                  <input id={`${ids}-serv`} className={ui.input} inputMode="decimal" value={servingsTextValue} onChange={(e) => setServingsText(e.target.value)} autoComplete="off" />
                  {kind === "prep" ? (
                    <p className={ui.hint}>Le porzioni già pronte non chiedono ingredienti nella lista della spesa; per le altre sì.</p>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={busy}>
        {busy ? "Aggiungo…" : `Aggiungi a ${MEAL_KIND_LABELS[meal].toLowerCase()}`}
      </Button>
    </form>
  );
}
