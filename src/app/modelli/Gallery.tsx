"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { listCategories, listRecipes, searchRecipes } from "@/models3d/catalog";
import ModelViewer from "@/models3d/ModelViewer";
import { ARCHETYPE_LABELS, CATEGORY_LABELS, type Category } from "@/models3d/recipe";
import styles from "./page.module.css";

/** Figure mostrate per volta: una categoria intera sta quasi sempre in una pagina. */
const PAGE = 60;

export default function Gallery() {
  const categories = useMemo(() => listCategories(), []);
  const counts = useMemo(() => {
    const map = new Map<Category, number>();
    for (const r of listRecipes()) map.set(r.category, (map.get(r.category) ?? 0) + 1);
    return map;
  }, []);

  const [category, setCategory] = useState<Category>(categories[0]);
  const [query, setQuery] = useState("");
  const [variant, setVariant] = useState(0);
  const [rotate, setRotate] = useState(false);
  const [paging, setPaging] = useState({ key: "", limit: PAGE });
  const deferred = useDeferredValue(query);
  const searching = deferred.trim() !== "";

  const results = useMemo(
    () => (searching ? searchRecipes(deferred) : searchRecipes("", category)),
    [searching, deferred, category],
  );
  const viewKey = searching ? `q:${deferred}` : `c:${category}`;
  const limit = paging.key === viewKey ? paging.limit : PAGE;
  const shown = results.slice(0, limit);

  // la linguetta attiva resta in vista quando le linguette scorrono in orizzontale
  const activeTab = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    activeTab.current?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [category]);

  const label = CATEGORY_LABELS[category];
  const summary = searching
    ? `${results.length} ${results.length === 1 ? "risultato" : "risultati"} per «${deferred.trim()}» in tutto il catalogo`
    : `${results.length} modelli in ${label}`;

  return (
    <>
      <div className={styles.controls}>
        <label className={styles.search}>
          <span className={styles.searchLabel}>Cerca per nome</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="pera, latte, spaghetti…"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="search"
          />
        </label>
        <nav className={styles.tabs} aria-label="Categorie">
          {categories.map((c) => (
            <button
              key={c}
              type="button"
              ref={c === category ? activeTab : undefined}
              aria-pressed={!searching && c === category}
              onClick={() => {
                setQuery("");
                setCategory(c);
              }}
            >
              {CATEGORY_LABELS[c]} <span className={styles.tabCount}>{counts.get(c)}</span>
            </button>
          ))}
        </nav>
        <div className={styles.knobs}>
          <p className={styles.summary} role="status" aria-live="polite">
            {summary}
          </p>
          <label className={styles.check}>
            <input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} /> Rotazione
          </label>
          <button type="button" className={styles.variant} onClick={() => setVariant((v) => v + 1)}>
            Altra variante{variant > 0 ? ` (${variant})` : ""}
          </button>
        </div>
      </div>

      {results.length === 0 ? (
        <p className={styles.empty}>Nessun modello trovato.</p>
      ) : (
        <ul className={styles.grid}>
          {shown.map((recipe) => (
            <li key={recipe.id} className={styles.card}>
              <ModelViewer recipe={recipe} seed={variant === 0 ? recipe.id : `${recipe.id}:${variant}`} autoRotate={rotate} />
              <p className={styles.name}>{recipe.name}</p>
              <p className={styles.kind}>
                {ARCHETYPE_LABELS[recipe.archetype]}
                {searching ? ` · ${CATEGORY_LABELS[recipe.category]}` : ""}
              </p>
              <code className={styles.id}>{recipe.id}</code>
            </li>
          ))}
        </ul>
      )}

      {results.length > shown.length ? (
        <button type="button" className={styles.more} onClick={() => setPaging({ key: viewKey, limit: limit + PAGE })}>
          Mostra altri ({results.length - shown.length})
        </button>
      ) : null}
    </>
  );
}
