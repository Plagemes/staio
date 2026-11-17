"use client";

import { useId, useMemo, useState } from "react";
import { Button } from "@/design";
import ui from "../ui.module.css";
import type { FoodOption, FoodSearch } from "./candidates";
import { FOOD_SOURCE_NAME, stateLabel } from "./labels";
import styles from "./nutrition.module.css";

/** Candidati della tabella per un testo, raggruppati: le voci dello stesso alimento in stati diversi stanno affiancate. */
export function FoodCandidates({
  query,
  search,
  selectedId,
  onPick,
}: {
  query: string;
  search: FoodSearch;
  selectedId?: string;
  onPick: (option: FoodOption) => void;
}) {
  const groups = useMemo(() => search.groups(query), [search, query]);
  if (groups.length === 0) return null;
  return (
    <div className={styles.candidates} role="group" aria-label="Alimenti della tabella">
      {groups.map((g) => (
        <div key={g.key} className={g.options.length > 1 ? styles.candidateGroupTwins : styles.candidateGroup}>
          {g.options.map((o) => (
            <button key={o.id} type="button" className={styles.candidate} aria-pressed={selectedId === o.id} onClick={() => onPick(o)}>
              <span className={styles.candidateName}>{o.name}</span>
              <span className={styles.candidateMeta}>
                {stateLabel(o.state) ?? "stato non indicato"} · {o.group}
                {o.food.per100.energyKcal !== undefined ? ` · ${Math.round(o.food.per100.energyKcal)} kcal per 100 ${o.food.basis}` : ""}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Scelta a mano dell'alimento (correzioni): ricerca per nome e candidati con il loro stato. */
export function FoodPicker({
  label,
  search,
  onPick,
  onClose,
}: {
  label: string;
  search: FoodSearch;
  onPick: (option: FoodOption) => void;
  onClose: () => void;
}) {
  const ids = useId();
  const [query, setQuery] = useState(label);
  const empty = useMemo(() => search.groups(query).length === 0, [search, query]);
  return (
    <div className={styles.panel}>
      <label className={ui.fieldLabel} htmlFor={`${ids}-q`}>
        Che alimento della tabella è?
      </label>
      <input id={`${ids}-q`} className={ui.input} type="search" autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cerca per nome" />
      <FoodCandidates query={query} search={search} onPick={onPick} />
      {empty && query.trim().length >= 2 ? <p className={ui.hint}>Nessun alimento con questo nome. Prova una parola sola, per esempio «riso» o «pane».</p> : null}
      <p className={ui.hint}>I valori vengono da {FOOD_SOURCE_NAME}: sono stime generiche.</p>
      <div>
        <Button variant="text" onClick={onClose}>
          Chiudi
        </Button>
      </div>
    </div>
  );
}
