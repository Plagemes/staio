"use client";

import { useMemo, useState } from "react";
import type { DayIntake } from "@/core/nutrition";
import { Button, Label, SectionHeader } from "@/design";
import { formatCalendarDate } from "../format";
import ui from "../ui.module.css";
import type { FoodOption, FoodSearch } from "./candidates";
import { FoodPicker } from "./FoodCandidates";
import type { PrepPortionInfo } from "./prepPortion";
import { notComputableCount, unresolvedGroups, type UnresolvedGroup } from "./prepare";
import styles from "./nutrition.module.css";
import { type FoodOverrides } from "./resolver";
import { useFoodCorrection } from "./useCorrection";
import { saveFoodOverrides } from "./useNutrition";

/** Il motivo dato dal motore, in parole, per le voci che hanno un alimento ma non la voce cotta. */
export const MISSING_COOKED_TEXT =
  "Di questo alimento la tabella ha solo la voce secca: pesalo a crudo oppure scegli un altro alimento.";

/**
 * Voci che il motore non ha saputo collegare a nessun dato, con il motivo. Per le voci libere di un pasto la scelta
 * corregge il pasto (con «Annulla»); per la dispensa resta la scelta ricordata per nome.
 */
export function UnresolvedList({
  days,
  search,
  overrides,
  prepInfo,
  headless = false,
  groups: givenGroups,
  skipped: givenSkipped,
}: {
  days: readonly DayIntake[];
  search: FoodSearch;
  overrides: FoodOverrides;
  prepInfo?: ReadonlyMap<string, PrepPortionInfo>;
  /** Senza il titolo di sezione: dentro una riga richiusa che ha già il titolo. */
  headless?: boolean;
  /** Già calcolati da chi la contiene: il registro intero non si scorre due volte. */
  groups?: readonly UnresolvedGroup[];
  skipped?: number;
}) {
  const groups = useMemo(() => givenGroups ?? unresolvedGroups(days), [givenGroups, days]);
  const skipped = useMemo(() => givenSkipped ?? notComputableCount(days), [givenSkipped, days]);
  const apply = useFoodCorrection(overrides);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remembered = Object.entries(overrides).flatMap(([key, id]) => {
    const food = search.byId(id);
    return food ? [{ key, food }] : [];
  });

  async function pick(group: UnresolvedGroup, option: FoodOption) {
    setError(null);
    const failed = await apply(group, group.label, option);
    if (failed) setError(failed);
    else setOpenKey(null);
  }

  async function forget(key: string) {
    setError(null);
    const next = { ...overrides };
    delete next[key];
    try {
      await saveFoodOverrides(next);
    } catch {
      setError("Non sono riuscito a toglierla. Riprova.");
    }
  }

  if (groups.length === 0 && remembered.length === 0 && skipped === 0) return null;

  return (
    <section className={ui.section} aria-label={headless ? "Voci non riconosciute" : undefined}>
      {headless ? null : <SectionHeader label="Voci non riconosciute" />}
      {groups.length === 0 ? (
        <p className={styles.quiet}>Tutte le voci hanno trovato un dato.</p>
      ) : (
        <>
          <p className={styles.quiet}>
            Queste voci non hanno un dato utilizzabile: restano fuori dai totali, non valgono zero. Sotto c&apos;è il motivo e che cosa puoi fare.
          </p>
          {groups.map((g) => {
            const uncooked = g.reason === "missing_cooked_entry" ? search.uncookedFor(g.label) : undefined;
            return (
              <div key={g.key} className={styles.unresolved}>
                <div className={styles.contributor}>
                  <span>
                    {g.label}
                    <span className={styles.matched}>
                      {" "}
                      · {g.count} {g.count === 1 ? "volta" : "volte"}, ultima il {formatCalendarDate(g.lastDate)}
                    </span>
                  </span>
                  {g.reason === "no_composition" ? (
                    <Button variant="outline" onClick={() => setOpenKey(openKey === g.key ? null : g.key)} aria-expanded={openKey === g.key}>
                      Scegli
                    </Button>
                  ) : null}
                </div>
                {[...(prepInfo?.values() ?? [])].some((i) => i.empty && i.title.toLowerCase() === g.label.toLowerCase()) ? (
                  <p className={ui.hint}>
                    È una preparazione: le sue porzioni si calcolano dagli ingredienti, ma nessuno ha un dato. Scegli a mano un alimento simile.
                  </p>
                ) : null}
                {g.reason === "missing_cooked_entry" ? (
                  <div className={styles.panel}>
                    <p className={ui.paragraph}>{MISSING_COOKED_TEXT}</p>
                    {g.message ? <p className={ui.hint}>{g.message}</p> : null}
                    <div className={ui.row}>
                      {uncooked ? <Button onClick={() => void pick(g, uncooked)}>Pesata a crudo: {uncooked.name}</Button> : null}
                      <Button variant="outline" onClick={() => setOpenKey(openKey === g.key ? null : g.key)} aria-expanded={openKey === g.key}>
                        Scegli un altro alimento
                      </Button>
                    </div>
                  </div>
                ) : null}
                {openKey === g.key ? <FoodPicker label={g.label} search={search} onPick={(o) => void pick(g, o)} onClose={() => setOpenKey(null)} /> : null}
              </div>
            );
          })}
        </>
      )}
      {skipped > 0 ? (
        <p className={styles.quiet}>
          {skipped === 1 ? "Una voce ha" : `${skipped} voci hanno`} un alimento riconosciuto ma una quantità che non so convertire (per esempio pezzi senza un peso noto): per ora resta fuori.
        </p>
      ) : null}
      {remembered.length > 0 ? (
        <div className={styles.panel}>
          <Label>Scelte ricordate per la dispensa</Label>
          <ul className={styles.contributors}>
            {remembered.map(({ key, food }) => (
              <li key={key} className={styles.contributor}>
                <span>
                  {key} → {food.name}
                </span>
                <Button variant="text" onClick={() => void forget(key)}>
                  Dimentica
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
