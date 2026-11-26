"use client";

import { useState, type ReactElement } from "react";
import type { MealKind } from "@/core/diary";
import { activeLots } from "@/core/ledger";
import { derivePlan, getWeek, missingFor, weekStartOf } from "@/core/plan";
import { getAllEvents, getPantry } from "@/data";
import { Button } from "@/design";
import { Disclosure } from "../common";
import { useNotice } from "../notice";
import { itemName } from "../plan/describe";
import { coveredText, listedText, missingLineText, missingSummary, portionsLeftOf, stockLines } from "../plan/missingView";
import { addManualEntries } from "../shopping/add";
import ui from "../ui.module.css";
import { unresolvedText } from "./plannedMoment";
import styles from "./PlannedLines.module.css";
import type { TodayPlan } from "./useTodayPlan";

const ADD_FAILED = "Non sono riuscito ad aggiungere alla spesa. Riprova.";

/**
 * Ciò che il piano prevede per un momento di oggi: una riga per voce («Cucina» sulle ricette) e «Che cosa manca»
 * richiuso, con «Aggiungi alla spesa». Il comando del momento resta quello del momento; qui ci sono solo i comandi delle voci.
 */
export function PlannedLines({ plan, meal }: { plan: TodayPlan; meal: MealKind }): ReactElement | null {
  const notice = useNotice();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lines = plan.planned.filter((p) => p.meal === meal);
  const result = plan.missingByMeal[meal];
  const catalog = plan.catalog;
  if (lines.length === 0 || !catalog) return null;

  const hasCheck = result !== undefined && (result.lines.length > 0 || result.covered.length > 0 || result.unresolved.length > 0);
  const covered = result ? coveredText(result) : undefined;

  async function addMissing() {
    if (!plan.expand || !result || busy) return;
    const { expand } = plan;
    setBusy(true);
    setError(null);
    try {
      // il piano e la dispensa si rileggono: ciò che c'era a schermo può essere già cambiato
      const date = lines[0].date;
      const fresh = derivePlan(await getAllEvents());
      const lots = activeLots(await getPantry());
      const entries = (getWeek(fresh, weekStartOf(date))?.entries ?? []).filter((e) => e.date === date && e.meal === meal);
      const now = missingFor(entries, {
        expand,
        stock: stockLines(lots),
        portionsLeft: portionsLeftOf(plan.preps, lots),
        nameOf: (item) => itemName(item, catalog!),
      });
      if (now.lines.length === 0) {
        notice.show({ message: "Non manca più niente: hai già tutto." });
        return;
      }
      const written = await addManualEntries(now.lines.map((l) => ({ product: l.name, quantity: { value: l.missing, unit: l.unit } })));
      if (written.added === 0) {
        setError(ADD_FAILED);
        return;
      }
      notice.show({ message: listedText(written.added), onUndo: written.undo });
    } catch {
      setError(ADD_FAILED);
    } finally {
      setBusy(false);
    }
  }

  const titleOf = (item: (typeof lines)[number]["item"]): string | undefined =>
    item.kind === "food" ? item.name : item.kind === "recipe" ? catalog!.recipes.find((r) => r.recipeId === item.recipeId)?.title : catalog!.preps.find((p) => p.prepId === item.prepId)?.title;

  return (
    <div className={styles.lines}>
      <ul className={styles.rows}>
        {lines.map((p, i) => (
          <li key={`${i}-${p.text}`} className={styles.row}>
            <span className={styles.text}>
              {p.text}
              {p.note ? <span className={styles.note}>{p.note}</span> : null}
            </span>
            {p.href ? (
              <Button variant="text" href={p.href}>
                Cucina
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {hasCheck && result ? (
        <Disclosure title="Che cosa manca" summary={missingSummary(result)}>
          {result.lines.length > 0 ? (
            <ul className={styles.missing}>
              {result.lines.map((l) => (
                <li key={l.key}>{missingLineText(l)}</li>
              ))}
            </ul>
          ) : null}
          {covered ? <p className={ui.hint}>{covered}</p> : null}
          {result.unresolved.map((e, i) => (
            <p key={i} className={ui.hint}>
              {unresolvedText(titleOf(e.item))}
            </p>
          ))}
          {result.lines.length > 0 ? (
            <div>
              <Button variant="outline" disabled={busy} onClick={() => void addMissing()}>
                Aggiungi alla spesa
              </Button>
            </div>
          ) : null}
          {error ? (
            <p className={ui.error} role="alert">
              {error}
            </p>
          ) : null}
        </Disclosure>
      ) : null}
    </div>
  );
}
