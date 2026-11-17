"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { activeLots } from "@/core/ledger";
import type { Recipe } from "@/core/recipes";
import { usePantry, useRecipes } from "@/data";
import { Button, Label } from "@/design";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import { formatMinutes, formatServings, splitList } from "./common";
import {
  ALLERGEN_NAMES,
  SORT_LABELS,
  allEquipment,
  allTags,
  applyFilters,
  buildRows,
  countsText,
  expiringText,
  filtersActive,
  missingText,
  pantryView,
  sortRows,
  type ListFilters,
  type SortKey,
} from "./list";
import { rateRecipe } from "./model";
import { useRecipePrefs, type RecipePrefs } from "./prefs";
import styles from "./recipes.module.css";

const SORTS: SortKey[] = ["title", "pantry", "expiring"];
const TIME_OPTIONS = [20, 30, 45, 60];

export function Recipes() {
  const recipes = useRecipes();
  const pantry = usePantry();
  const now = useNow();
  const { prefs, ready, save } = useRecipePrefs();
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

  const filters: ListFilters = {
    query,
    tags,
    ...(maxMinutes !== undefined ? { maxMinutes } : {}),
    ...(prefs.limitToEquipment ? { ownedEquipment: prefs.ownedEquipment } : {}),
    allergens: prefs.allergens,
    excludedFoods: prefs.excludedFoods,
  };
  const filtered = useMemo(
    () => applyFilters(rows, filters),
    // `filters` si ricostruisce a ogni disegno: contano i suoi ingredienti
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, query, tags, maxMinutes, prefs.limitToEquipment, prefs.ownedEquipment, prefs.allergens, prefs.excludedFoods],
  );
  const shown = useMemo(() => sortRows(filtered.rows, sort), [filtered.rows, sort]);

  if (recipes.error || pantry.error) return <StorageError />;
  if (!recipes.data || !pantry.data || !view || !ready) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Ricettario</h1>
        <LoadingLine />
      </div>
    );
  }

  const all = recipes.data.recipes;
  const active = filtersActive(filters);

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
            />
          </details>

          {shown.length === 0 ? (
            <div className={ui.empty}>
              <h2 className={ui.emptyTitle}>Nessuna ricetta corrisponde</h2>
              <p className={ui.emptyText}>
                {filtered.hidden > 0
                  ? `${filtered.hidden === 1 ? "Una ricetta è nascosta" : `${filtered.hidden} ricette sono nascoste`} dai filtri.`
                  : "Prova con un'altra parola."}
              </p>
            </div>
          ) : (
            <>
              <p className={ui.hint} role="status">
                {shown.length === 1 ? "1 ricetta" : `${shown.length} ricette`}
                {filtered.hidden > 0 ? ` · ${filtered.hidden} nascoste dai filtri` : ""}
              </p>
              <ul className={styles.list}>
                {shown.map((row) => {
                  const missing = missingText(row);
                  const expiring = expiringText(row);
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
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

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
}

function Filters({ recipes, tags, onTags, maxMinutes, onMaxMinutes, prefs, onPrefs }: FiltersProps) {
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
        <p className={ui.hint}>
          Il filtro legge solo i nomi degli ingredienti: non vede ingredienti composti né tracce. Con un&apos;allergia, controlla sempre
          le etichette.
        </p>
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
