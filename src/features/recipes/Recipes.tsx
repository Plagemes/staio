"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { ALLERGEN_CHECK_NOTICE } from "@/core/allergens";
import { activeLots } from "@/core/ledger";
import type { Recipe } from "@/core/recipes";
import { usePantry, usePlan, useRecipes } from "@/data";
import { Button, Label } from "@/design";
import { useProducts } from "../nutrition/useNutrition";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import { makeLinkOf, pantryFoods } from "./allergenLinks";
import { formatMinutes, formatServings, splitList } from "./common";
import {
  ALLERGEN_NAMES,
  SORT_LABELS,
  allEquipment,
  allTags,
  applyFilters,
  buildRows,
  confirmedRowText,
  countsText,
  expiringText,
  filtersActive,
  hiddenText,
  missingText,
  pantryView,
  sortRows,
  type HiddenRecipe,
  type ListFilters,
  type SortKey,
} from "./list";
import { rateRecipe } from "./model";
import { useRecipePrefs, type RecipePrefs } from "./prefs";
import { reasonLines, unionDeclared } from "./safety";
import { useConfirmations } from "./useConfirmations";
import styles from "./recipes.module.css";

const SORTS: SortKey[] = ["title", "pantry", "expiring"];
const TIME_OPTIONS = [20, 30, 45, 60];

export function Recipes() {
  const recipes = useRecipes();
  const pantry = usePantry();
  const plan = usePlan();
  const products = useProducts();
  const now = useNow();
  const { prefs, ready, save } = useRecipePrefs();
  const { byKey: confirmations } = useConfirmations();
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("title");
  const [tags, setTags] = useState<string[]>([]);
  const [maxMinutes, setMaxMinutes] = useState<number | undefined>(undefined);
  const ids = useId();

  const view = useMemo(
    () => (pantry.data && now ? pantryView(activeLots(pantry.data), now) : undefined),
    [pantry.data, now],
  );
  const rows = useMemo(() => (recipes.data && view ? buildRows(recipes.data.recipes, view) : []), [recipes.data, view]);

  // gli allergeni e le esclusioni dichiarati nel ricettario e nel piano contano insieme
  const planAllergens = plan.data?.structure?.allergens;
  const planExcluded = plan.data?.structure?.excludedFoods;
  const allergens = useMemo(() => unionDeclared(prefs.allergens, planAllergens ?? []), [prefs.allergens, planAllergens]);
  const excludedFoods = useMemo(() => unionDeclared(prefs.excludedFoods, planExcluded ?? []), [prefs.excludedFoods, planExcluded]);
  const linkOf = useMemo(
    () => makeLinkOf(pantryFoods(pantry.data ? activeLots(pantry.data) : [], products)),
    [pantry.data, products],
  );

  const filters: ListFilters = {
    query,
    tags,
    ...(maxMinutes !== undefined ? { maxMinutes } : {}),
    ...(prefs.limitToEquipment ? { ownedEquipment: prefs.ownedEquipment } : {}),
    allergens,
    excludedFoods,
    linkOf,
    ...(confirmations ? { confirmations } : {}),
  };
  const filtered = useMemo(
    () => applyFilters(rows, filters),
    // `filters` si ricostruisce a ogni disegno: contano i suoi ingredienti
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, query, tags, maxMinutes, prefs.limitToEquipment, prefs.ownedEquipment, allergens, excludedFoods, linkOf, confirmations],
  );
  const shown = useMemo(() => sortRows(filtered.rows, sort), [filtered.rows, sort]);

  if (recipes.error || pantry.error || plan.error) return <StorageError />;
  if (!recipes.data || !pantry.data || !plan.data || !products || !view || !ready || !confirmations) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Ricettario</h1>
        <LoadingLine />
      </div>
    );
  }

  const all = recipes.data.recipes;
  const active = filtersActive(filters);
  const declared = allergens.length > 0 || excludedFoods.length > 0;
  const hiddenSummary = hiddenText(filtered);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Ricettario</h1>
        <Label>{all.length === 1 ? "1 ricetta" : `${all.length} ricette`}</Label>
      </div>

      <div className={styles.actions}>
        <Button href="/app/ricette/nuova">Scrivi una ricetta</Button>
        <Button href="/app/ricette/importa" variant="outline">
          Importa
        </Button>
        <Button href="/app/ricette/idee" variant="outline">
          Idee con ciò che hai
        </Button>
        <Button href="/app/ricette/abbinamenti" variant="outline">
          Abbinamenti di gusto
        </Button>
      </div>

      {all.length === 0 ? (
        <EmptyState
          title="Il ricettario è vuoto"
          text="Qui compariranno le tue ricette, con quanti ingredienti hai già in casa e quali mancano. Scrivine una, oppure importala da un indirizzo web o da un testo."
          actionLabel="Scrivi la prima ricetta"
          actionHref="/app/ricette/nuova"
          secondaryLabel="Importa da un indirizzo o da un testo"
          secondaryHref="/app/ricette/importa"
        />
      ) : (
        <>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-q`}>
              Cerca
            </label>
            <input
              id={`${ids}-q`}
              className={ui.input}
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Titolo, ingrediente o etichetta"
              autoComplete="off"
            />
          </div>

          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel}>Ordina</legend>
            <div className={ui.choices}>
              {SORTS.map((s) => (
                <label key={s} className={ui.choice}>
                  <input type="radio" name={`${ids}-sort`} value={s} checked={sort === s} onChange={() => setSort(s)} />
                  <span>{SORT_LABELS[s]}</span>
                </label>
              ))}
            </div>
            {sort === "expiring" && view.expiring.length === 0 ? (
              <p className={ui.hint}>Niente in dispensa sta per scadere: l&apos;ordine resta per nome.</p>
            ) : null}
          </fieldset>

          <details className={styles.filters}>
            <summary>{active ? "Filtri (attivi)" : "Filtri"}</summary>
            <Filters
              recipes={all}
              tags={tags}
              onTags={setTags}
              maxMinutes={maxMinutes}
              onMaxMinutes={setMaxMinutes}
              prefs={prefs}
              onPrefs={save}
              fromPlan={{
                allergens: allergens.filter((a) => !prefs.allergens.includes(a)),
                excludedFoods: excludedFoods.filter((a) => !prefs.excludedFoods.includes(a)),
              }}
              showNotice={!declared}
            />
          </details>

          {shown.length === 0 ? (
            <div className={ui.empty}>
              <h2 className={ui.emptyTitle}>Nessuna ricetta corrisponde</h2>
              <p className={ui.emptyText}>
                {filtered.hidden > 0 ? `${hiddenSummary}.` : "Prova con un'altra parola."}
              </p>
            </div>
          ) : (
            <>
              <p className={ui.hint} role="status">
                {shown.length === 1 ? "1 ricetta" : `${shown.length} ricette`}
                {filtered.hidden > 0 ? ` · ${hiddenSummary}` : ""}
              </p>
              {declared ? (
                <p className={ui.hint}>
                  Quelle mostrate non hanno dato nessuna corrispondenza nei nomi: non vuol dire che siano sicure.
                </p>
              ) : null}
              <ul className={styles.list}>
                {shown.map((row) => {
                  const missing = missingText(row);
                  const expiring = expiringText(row);
                  const confirmedNote = confirmedRowText(filtered.confirmedBy.get(row.recipe.recipeId) ?? []);
                  return (
                    <li key={row.recipe.recipeId}>
                      <Link className={styles.card} href={`/app/ricette/vedi?id=${encodeURIComponent(row.recipe.recipeId)}`}>
                        <span className={styles.cardTitle}>{row.recipe.title}</span>
                        <span className={styles.meta}>
                          <span>{formatServings(row.recipe.servings)}</span>
                          {row.minutes !== undefined ? <span>{formatMinutes(row.minutes)}</span> : null}
                          {row.recipe.rating !== undefined ? <span>{"★".repeat(row.recipe.rating)}</span> : null}
                        </span>
                        <span className={styles.noteStrong}>{countsText(row)}</span>
                        {missing ? <span className={styles.note}>{missing}</span> : null}
                        {expiring ? <span className={styles.noteAccent}>{expiring}</span> : null}
                        {confirmedNote ? <span className={styles.noteStrong}>{confirmedNote}</span> : null}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      {declared && filtered.hiddenContains.length + filtered.hiddenUncertain.length > 0 ? (
        <HiddenBySafety
          contains={filtered.hiddenContains}
          uncertain={filtered.hiddenUncertain}
          criteria={{ allergens, excludedFoods, linkOf, confirmations }}
        />
      ) : null}
      {declared ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}

      {recipes.data.archived.length > 0 ? <Archived recipes={recipes.data.archived} /> : null}

      <Link href="/app/preparazioni" className={ui.textLink}>
        Vai alle preparazioni
      </Link>
    </div>
  );
}

interface FiltersProps {
  recipes: readonly Recipe[];
  tags: string[];
  onTags: (t: string[]) => void;
  maxMinutes: number | undefined;
  onMaxMinutes: (m: number | undefined) => void;
  prefs: RecipePrefs;
  onPrefs: (p: RecipePrefs) => Promise<void>;
  /** Ciò che il piano dichiara in più del ricettario: conta lo stesso. */
  fromPlan: { allergens: string[]; excludedFoods: string[] };
  /** Il testo fisso compare una volta per schermata: qui solo se altrove non c'è. */
  showNotice: boolean;
}

function Filters({ recipes, tags, onTags, maxMinutes, onMaxMinutes, prefs, onPrefs, fromPlan, showNotice }: FiltersProps) {
  const ids = useId();
  const tagNames = useMemo(() => allTags(recipes), [recipes]);
  const equipment = useMemo(() => allEquipment(recipes), [recipes]);
  const [foodsText, setFoodsText] = useState(prefs.excludedFoods.join(", "));

  const toggle = (list: string[], value: string) => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

  return (
    <div className={styles.filterBody}>
      {tagNames.length > 0 ? (
        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Etichette</legend>
          <div className={styles.chips}>
            {tagNames.map((t) => (
              <label key={t} className={styles.chip}>
                <input type="checkbox" checked={tags.includes(t)} onChange={() => onTags(toggle(tags, t))} />
                <span>{t}</span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-time`}>
          Tempo a disposizione
        </label>
        <select
          id={`${ids}-time`}
          className={`${ui.input}`}
          value={maxMinutes ?? ""}
          onChange={(e) => onMaxMinutes(e.target.value === "" ? undefined : Number(e.target.value))}
        >
          <option value="">Qualsiasi</option>
          {TIME_OPTIONS.map((m) => (
            <option key={m} value={m}>
              Fino a {m} minuti
            </option>
          ))}
        </select>
        {maxMinutes !== undefined ? <p className={ui.hint}>Le ricette senza un tempo indicato restano nell&apos;elenco.</p> : null}
      </div>

      {equipment.length > 0 ? (
        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Attrezzatura</legend>
          <label className={ui.switch}>
            <input
              type="checkbox"
              role="switch"
              checked={prefs.limitToEquipment}
              onChange={(e) => void onPrefs({ ...prefs, limitToEquipment: e.target.checked })}
            />
            <span className={ui.switchText}>Solo ricette che posso fare con quella che ho</span>
          </label>
          {prefs.limitToEquipment ? (
            <div className={styles.chips}>
              {equipment.map((e) => (
                <label key={e} className={styles.chip}>
                  <input
                    type="checkbox"
                    checked={prefs.ownedEquipment.includes(e)}
                    onChange={() => void onPrefs({ ...prefs, ownedEquipment: toggle(prefs.ownedEquipment, e) })}
                  />
                  <span>{e}</span>
                </label>
              ))}
            </div>
          ) : null}
        </fieldset>
      ) : null}

      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Senza</legend>
        <div className={styles.chips}>
          {ALLERGEN_NAMES.map((a) => (
            <label key={a} className={styles.chip}>
              <input
                type="checkbox"
                checked={prefs.allergens.includes(a)}
                onChange={() => void onPrefs({ ...prefs, allergens: toggle(prefs.allergens, a) })}
              />
              <span>{a}</span>
            </label>
          ))}
        </div>
        <label className={ui.fieldLabel} htmlFor={`${ids}-foods`}>
          Altri alimenti da escludere <span className={ui.optional}>(separati da virgola)</span>
        </label>
        <input
          id={`${ids}-foods`}
          className={ui.input}
          type="text"
          value={foodsText}
          onChange={(e) => setFoodsText(e.target.value)}
          onBlur={() => void onPrefs({ ...prefs, excludedFoods: splitList(foodsText) })}
          placeholder="coriandolo, olive"
          autoComplete="off"
        />
        {fromPlan.allergens.length + fromPlan.excludedFoods.length > 0 ? (
          <p className={ui.hint}>
            Dal piano conto anche: {[...fromPlan.allergens, ...fromPlan.excludedFoods].join(", ")}.
          </p>
        ) : null}
        <p className={ui.hint}>
          Le ricette con ingredienti generici (crema, salsa, ripieno) di cui non si può dire se contengono un allergene restano
          nascoste e le trovi a parte, come «non verificabili».
        </p>
        {showNotice ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}
      </fieldset>
    </div>
  );
}

function Archived({ recipes }: { recipes: readonly Recipe[] }) {
  const { recordWith, busy } = useRecord();
  return (
    <details className={styles.filters}>
      <summary>{recipes.length === 1 ? "1 ricetta ritirata" : `${recipes.length} ricette ritirate`}</summary>
      <ul className={styles.list}>
        {recipes.map((r) => (
          <li key={r.recipeId} className={styles.card}>
            <span className={styles.cardTitle}>{r.title}</span>
            <div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void recordWith((deviceId) => {
                    const result = rateRecipe(r, r.rating, { now: new Date().toISOString(), deviceId });
                    if (!result.ok) throw new Error(result.error);
                    return { events: [result.event], message: `«${r.title}» è tornata nel ricettario.` };
                  })
                }
              >
                Rimetti nel ricettario
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </details>
  );
}

function HiddenBySafety({
  contains,
  uncertain,
  criteria,
}: {
  contains: readonly HiddenRecipe[];
  uncertain: readonly HiddenRecipe[];
  criteria: { allergens: string[]; excludedFoods: string[]; linkOf: ListFilters["linkOf"]; confirmations: ListFilters["confirmations"] };
}) {
  const safetyCriteria = { allergens: criteria.allergens, excludedFoods: criteria.excludedFoods, ...(criteria.linkOf ? { linkOf: criteria.linkOf } : {}), ...(criteria.confirmations ? { confirmations: criteria.confirmations } : {}) };
  const group = (title: string, items: readonly HiddenRecipe[], pick: "contains" | "uncertain", tail?: string) =>
    items.length === 0 ? null : (
      <div className={ui.field}>
        <h3 className={ui.fieldLabel}>{title}</h3>
        <ul className={styles.list}>
          {items.map(({ row, reasons }) => {
            const lines = reasonLines(reasons, row.recipe, safetyCriteria)[pick];
            return (
              <li key={row.recipe.recipeId} className={styles.card}>
                <Link className={styles.cardTitle} href={`/app/ricette/vedi?id=${encodeURIComponent(row.recipe.recipeId)}`}>
                  {row.recipe.title}
                </Link>
                {lines.map((l, i) => (
                  <span key={i} className={pick === "contains" ? styles.noteStrong : styles.note}>
                    {l}
                  </span>
                ))}
                {tail ? <span className={styles.note}>{tail}</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
    );
  return (
    <details className={styles.filters}>
      <summary>Ricette nascoste per allergeni ed esclusioni ({contains.length + uncertain.length})</summary>
      <div className={styles.filterBody}>
        {group(
          `Non verificabili (${uncertain.length})`,
          uncertain,
          "uncertain",
          "Non la presento come compatibile: controlla l'etichetta o chiedi com'è fatto l'ingrediente prima di cucinarla.",
        )}
        {group(`Con un allergene o un alimento escluso (${contains.length})`, contains, "contains")}
      </div>
    </details>
  );
}
