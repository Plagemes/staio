"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useId, useMemo, useState } from "react";
import { ALLERGEN_CHECK_NOTICE } from "@/core/allergens";
import { activeLots } from "@/core/ledger";
import type { Recipe } from "@/core/recipes";
import { getRecipes, usePantry, useRecipes } from "@/data";
import { Button, Label } from "@/design";
import { DIET_HREF, declaredLists, declaredSummary, useDietDeclarations } from "../allergens";
import { Disclosure, MoreActions } from "../common";
import { useProducts } from "../nutrition/useNutrition";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import { makeLinkOf, pantryFoods } from "./allergenLinks";
import { formatMinutes, formatServings } from "./common";
import {
  SORT_LABELS,
  allEquipment,
  allTags,
  applyFilters,
  buildRows,
  confirmedRowText,
  countsText,
  expiringText,
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
import { TIME_OPTIONS, parseRecipesQuery, recipesQueryString, sortFilterSummary, type RecipesQuery } from "./recipesQuery";
import { reasonLines } from "./safety";
import { IncompleteDeclarations } from "./SafetyPanel";
import { historyText, SORT_FAVORITES_HINT } from "./dishRating";
import { useConfirmations } from "./useConfirmations";
import { useDishHistory } from "./useDishHistory";
import styles from "./recipes.module.css";

const SORTS: SortKey[] = ["title", "pantry", "expiring", "favorites"];
/** Quanto si aspetta, dopo l'ultima battuta, prima di scrivere la ricerca nell'indirizzo. */
const SEARCH_DELAY_MS = 300;

const MORE_LINKS = [
  { id: "ideas", label: "Cosa cucinare", href: "/app/ricette/idee" },
  { id: "pairings", label: "Con cosa sta bene", href: "/app/ricette/abbinamenti" },
  { id: "preps", label: "Preparazioni", href: "/app/preparazioni" },
];

export function Recipes() {
  return (
    <Suspense
      fallback={
        <div className={ui.screen}>
          <h1 className={ui.title}>Ricettario</h1>
          <LoadingLine />
        </div>
      }
    >
      <RecipesScreen />
    </Suspense>
  );
}

function RecipesScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const recipes = useRecipes();
  const pantry = usePantry();
  const diet = useDietDeclarations();
  const products = useProducts();
  const now = useNow();
  const { prefs, ready, save } = useRecipePrefs();
  const { byKey: confirmations } = useConfirmations();
  const dishes = useDishHistory();
  const ids = useId();

  // Ricerca, ordine, etichette e tempo sono nell'indirizzo, letti a ogni disegno: tornando dalla scheda si ritrovano.
  const searchText = search.toString();
  const state = useMemo(() => parseRecipesQuery(searchText), [searchText]);
  // un'etichetta nell'indirizzo che nessuna ricetta ha più non si potrebbe togliere: non conta
  const knownTags = useMemo(() => allTags(recipes.data?.recipes ?? []), [recipes.data]);
  const tags = useMemo(() => state.tags.filter((t) => knownTags.includes(t)), [state.tags, knownTags]);

  // Il testo che si scrive è dello stato locale e l'indirizzo lo segue dopo una pausa: una battuta mentre parte la
  // scrittura non si perde. Se l'indirizzo cambia da fuori (tasto indietro) vale lui.
  const [text, setText] = useState(state.q);
  const [written, setWritten] = useState(state.q);
  const [seenQ, setSeenQ] = useState(state.q);
  if (state.q !== seenQ) {
    setSeenQ(state.q);
    if (state.q !== written) {
      setText(state.q);
      setWritten(state.q);
    }
  }
  /** Cambia un filtro tenendo anche il testo che si sta scrivendo. */
  const go = (change: (current: RecipesQuery) => RecipesQuery) => {
    setWritten(text);
    router.replace(`${pathname}${recipesQueryString(change({ ...state, q: text, tags }))}`, { scroll: false });
  };
  useEffect(() => {
    if (text === state.q) return;
    const timer = window.setTimeout(() => {
      setWritten(text);
      router.replace(`${pathname}${recipesQueryString({ ...state, q: text })}`, { scroll: false });
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text, state, router, pathname]);

  const view = useMemo(
    () => (pantry.data && now ? pantryView(activeLots(pantry.data), now) : undefined),
    [pantry.data, now],
  );
  const rows = useMemo(
    () => (recipes.data && view ? buildRows(recipes.data.recipes, view, dishes.byRecipe) : []),
    [recipes.data, view, dishes.byRecipe],
  );

  // allergeni ed esclusioni dalla lettura unica (eventi e posti di prima, in unione)
  const lists = useMemo(() => (diet.state ? declaredLists(diet.state) : undefined), [diet.state]);
  const allergens = useMemo(() => lists?.allergens ?? [], [lists]);
  const excludedFoods = useMemo(() => lists?.excludedFoods ?? [], [lists]);
  const linkOf = useMemo(
    () => makeLinkOf(pantryFoods(pantry.data ? activeLots(pantry.data) : [], products)),
    [pantry.data, products],
  );

  const { maxMinutes, sort } = state;

  const filters: ListFilters = {
    query: state.q,
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
    [rows, state.q, tags, maxMinutes, prefs.limitToEquipment, prefs.ownedEquipment, allergens, excludedFoods, linkOf, confirmations],
  );
  const shown = useMemo(() => sortRows(filtered.rows, sort), [filtered.rows, sort]);

  if (recipes.error || pantry.error || diet.error) return <StorageError />;
  if (!recipes.data || !pantry.data || !diet.state || !products || !view || !ready || !confirmations) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Ricettario</h1>
        <LoadingLine />
      </div>
    );
  }

  const all = recipes.data.recipes;
  const declared = allergens.length > 0 || excludedFoods.length > 0;
  const incomplete = !diet.state.complete;
  const summary = declaredSummary(diet.state);
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
        <MoreActions items={MORE_LINKS} />
      </div>

      {all.length === 0 ? (
        <div className={ui.empty}>
          <h2 className={ui.emptyTitle}>Il ricettario è vuoto</h2>
          <p className={ui.emptyText}>
            Qui compariranno le tue ricette, con quanti ingredienti hai già in casa e quali mancano. Scrivine una, oppure importala da un indirizzo web o da un testo.
          </p>
        </div>
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
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Titolo, ingrediente o etichetta"
              autoComplete="off"
            />
          </div>

          <Disclosure title="Ordina e filtra" summary={sortFilterSummary({ ...state, tags })}>
            <fieldset className={ui.field}>
              <legend className={ui.fieldLabel}>Ordina</legend>
              <div className={ui.choices}>
                {SORTS.map((s) => (
                  <label key={s} className={ui.choice}>
                    <input type="radio" name={`${ids}-sort`} value={s} checked={sort === s} onChange={() => go((cur) => ({ ...cur, sort: s }))} />
                    <span>{SORT_LABELS[s]}</span>
                  </label>
                ))}
              </div>
              {sort === "favorites" ? <p className={ui.hint}>{SORT_FAVORITES_HINT}</p> : null}
              {sort === "expiring" && view.expiring.length === 0 ? (
                <p className={ui.hint}>Niente in dispensa sta per scadere: l&apos;ordine resta per nome.</p>
              ) : null}
            </fieldset>
            <Filters
              recipes={all}
              tags={tags}
              onTags={(next) => go((cur) => ({ ...cur, tags: next }))}
              maxMinutes={maxMinutes}
              onMaxMinutes={(m) => go((cur) => ({ q: cur.q, sort: cur.sort, tags: cur.tags, ...(m !== undefined ? { maxMinutes: m } : {}) }))}
              prefs={prefs}
              onPrefs={save}
              declaredText={summary}
              showNotice={!declared}
            />
          </Disclosure>

          {shown.length === 0 ? (
            <div className={ui.empty}>
              <h2 className={ui.emptyTitle}>Nessuna ricetta corrisponde</h2>
              <p className={ui.emptyText}>
                {filtered.hidden > 0 ? `${hiddenSummary}.` : "Prova con un'altra parola."}
              </p>
            </div>
          ) : (
            <>
              {incomplete ? <IncompleteDeclarations /> : null}
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
                        {historyText(row.history) ? <span className={styles.note}>{historyText(row.history)}</span> : null}
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
  /** Allergeni ed esclusioni dichiarati, in una riga: qui si leggono, si cambiano in Alimentazione. */
  declaredText: string;
  /** Il testo fisso compare una volta per schermata: qui solo se altrove non c'è. */
  showNotice: boolean;
}

function Filters({ recipes, tags, onTags, maxMinutes, onMaxMinutes, prefs, onPrefs, declaredText, showNotice }: FiltersProps) {
  const ids = useId();
  const tagNames = useMemo(() => allTags(recipes), [recipes]);
  const equipment = useMemo(() => allEquipment(recipes), [recipes]);

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

      <div className={ui.field}>
        <p className={ui.paragraph}>
          Allergeni ed esclusioni: {declaredText === "" ? "niente dichiarato" : declaredText}{" "}
          <Link href={DIET_HREF} className={ui.textLink}>
            {declaredText === "" ? "Aggiungi" : "Cambia"}
          </Link>
        </p>
        <p className={ui.hint}>
          Le ricette con ingredienti generici (crema, salsa, ripieno) di cui non si può dire se contengono un allergene restano
          nascoste e le trovi a parte, come «non verificabili».
        </p>
        {showNotice ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}
      </div>
    </div>
  );
}

function Archived({ recipes }: { recipes: readonly Recipe[] }) {
  const { recordWith, busy } = useRecord();
  /** Rilegge l'archivio: rimette la versione ritirata più recente, non quella che era a schermo. */
  async function putBack(recipeId: string) {
    const fresh = (await getRecipes()).archived.find((x) => x.recipeId === recipeId);
    if (!fresh) return;
    await recordWith((deviceId) => {
      const result = rateRecipe(fresh, fresh.rating, { now: new Date().toISOString(), deviceId });
      if (!result.ok) throw new Error(result.error);
      return { events: [result.event], message: `«${fresh.title}» è tornata nel ricettario.` };
    });
  }
  return (
    <Disclosure title={recipes.length === 1 ? "1 ricetta ritirata" : `${recipes.length} ricette ritirate`} summary="Si rimettono nel ricettario">
      <ul className={styles.list}>
        {recipes.map((r) => (
          <li key={r.recipeId} className={styles.card}>
            <span className={styles.cardTitle}>{r.title}</span>
            <div>
              <Button
                variant="text"
                disabled={busy}
                onClick={() => void putBack(r.recipeId)}
              >
                Rimetti nel ricettario
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Disclosure>
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
    <Disclosure
      title={`Ricette nascoste per allergeni ed esclusioni (${contains.length + uncertain.length})`}
      summary={`${contains.length} con un allergene o un alimento escluso, ${uncertain.length} non verificabili`}
    >
      <div className={styles.filterBody}>
        {group(
          `Non verificabili (${uncertain.length})`,
          uncertain,
          "uncertain",
          "Non la presento come compatibile: controlla l'etichetta o chiedi com'è fatto l'ingrediente prima di cucinarla.",
        )}
        {group(`Con un allergene o un alimento escluso (${contains.length})`, contains, "contains")}
      </div>
    </Disclosure>
  );
}
