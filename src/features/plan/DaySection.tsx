"use client";

import type { MealKind } from "@/core/diary";
import type { PlannedEntry, ProposedMeal } from "@/core/plan";
import { Button, Label } from "@/design";
import { MoreActions, type ActionItem } from "../common";
import { MEAL_KIND_LABELS, MEAL_KIND_ORDER } from "../meals";
import { dayHeading } from "./dates";
import { itemLabel } from "./describe";
import type { EntryRef } from "./entryKey";
import { cookHref, itemCommand } from "./itemCommand";
import { UNCERTAIN_WARNING, reasonLine } from "./proposal";
import type { PlanData } from "./usePlanData";
import type { ProposalView } from "./useProposal";
import styles from "./plan.module.css";

export interface DayItem {
  entry: PlannedEntry;
  ref: EntryRef;
}

interface Props {
  date: string;
  data: PlanData;
  items: DayItem[];
  proposed: ProposedMeal[];
  proposal: ProposalView;
  /** «Pranzo · 13:00»: i pasti nell'ordine della struttura, poi gli altri. */
  mealOrder: readonly MealKind[];
  mealTime: ReadonlyMap<MealKind, string | undefined>;
  /** Le stime nutrizionali del giorno, già scritte («2 obiettivi su 3 rispettati»), se ci sono. */
  summary: string;
  /** Il tipo di giornata, a parole: «allenamento (predefinita)». */
  dayTypeText: string | undefined;
  onOpen: (item: DayItem) => void;
  onEat: (entry: PlannedEntry) => void;
  onAdd: () => void;
  onCopyDay: () => void;
  onDayType: () => void;
}

/** Un giorno della Settimana: i pasti, per ogni voce un comando in vista e il resto al tocco; in fondo «Aggiungi» e «Altro». */
export function DaySection({ date, data, items, proposed, proposal, mealOrder, mealTime, summary, dayTypeText, onOpen, onEat, onAdd, onCopyDay, onDayType }: Props) {
  const more: ActionItem[] = [
    ...(items.length > 0 ? [{ id: "copy", label: "Copia il giorno", onSelect: onCopyDay }] : []),
    { id: "type", label: "Tipo di giornata", ...(dayTypeText ? { hint: dayTypeText } : {}), onSelect: onDayType },
  ];
  const meals = mealOrder.concat(MEAL_KIND_ORDER.filter((k) => !mealOrder.includes(k)));

  return (
    <li className={styles.day} id={`giorno-${date}`}>
      <div className={styles.dayHead}>
        <h2 className={styles.dayTitle}>{dayHeading(date, data.today)}</h2>
      </div>
      {summary ? <p className={styles.dayNote}>{summary}. Sono stime sui dati che ci sono.</p> : null}

      {items.length === 0 && proposed.length === 0 ? <p className={styles.dayNote}>Niente di pianificato.</p> : null}
      {meals.map((meal) => {
        const here = items.filter((x) => x.entry.meal === meal);
        const suggested = proposed.filter((m) => m.slot.meal === meal);
        if (here.length === 0 && suggested.length === 0) return null;
        return (
          <div key={meal} className={styles.mealBlock}>
            <Label>
              {MEAL_KIND_LABELS[meal]}
              {mealTime.get(meal) ? ` · ${mealTime.get(meal)}` : ""}
            </Label>
            <ul className={styles.entries}>
              {here.map((x) => {
                const item = x.entry.item;
                const recipeExists = item.kind === "recipe" && data.recipes.some((r) => r.recipeId === item.recipeId);
                const command = itemCommand(item, x.entry.date, data.today, recipeExists);
                return (
                  <li key={`${x.ref.key}-${x.ref.nth}`} className={styles.entry}>
                    <button type="button" className={styles.entryMain} aria-haspopup="dialog" onClick={() => onOpen(x)}>
                      <span className={styles.entryName}>{itemLabel(item, data.catalog)}</span>
                      {x.entry.note ? <span className={styles.entryNote}>{x.entry.note}</span> : null}
                    </button>
                    {command === "cook" && item.kind === "recipe" ? (
                      <Button variant="text" href={cookHref(item.recipeId, item.servings)}>
                        Cucina
                      </Button>
                    ) : null}
                    {command === "eat" ? (
                      <Button variant="text" onClick={() => onEat(x.entry)}>
                        Registra
                      </Button>
                    ) : null}
                  </li>
                );
              })}
              {suggested.map((m) => (
                <li key={`proposta-${m.slot.meal}`} className={styles.proposed}>
                  <span className={styles.proposedTag}>Proposta</span>
                  <span className={styles.entryName}>{itemLabel({ kind: "recipe", recipeId: m.recipeId, servings: m.servings }, data.catalog)}</span>
                  <span className={styles.entryNote}>{reasonLine(m, data.today)}</span>
                  {m.warning ? <span className={styles.entryNote}>{UNCERTAIN_WARNING}</span> : null}
                  <div className={styles.actions}>
                    <button type="button" className={styles.action} onClick={() => proposal.swap(m.slot)}>
                      Un&apos;altra
                    </button>
                    <button type="button" className={styles.actionDanger} onClick={() => proposal.drop(m.slot)}>
                      Togli
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      <div className={styles.actions}>
        <Button variant="text" onClick={onAdd}>
          Aggiungi
        </Button>
        <MoreActions items={more} title={dayHeading(date, data.today)} />
      </div>
    </li>
  );
}
