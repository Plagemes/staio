"use client";

// «Proponi una settimana»: la scheda sopra i giorni con ciò che propongo, perché, le scelte che si possono cambiare e i
// due tasti. Le voci proposte stanno nei giorni, nella stessa griglia, distinte da quelle confermate (vedi Week).
import Link from "next/link";
import { useId } from "react";
import type { MealKind } from "@/core/diary";
import { Button, Label } from "@/design";
import { MEAL_KIND_LABELS } from "../meals";
import ui from "../ui.module.css";
import { dayMonth } from "./dates";
import {
  CRITERIA_TEXT,
  CRITERIA_TEXT_SPEND,
  MAX_REPEAT_CHOICES,
  SERVINGS_CHOICES,
  headlineText,
  momentChoices,
  remainingDays,
  shortDay,
  summaryNotes,
  type ProposalSettings,
} from "./proposal";
import type { ProposalView } from "./useProposal";
import styles from "./plan.module.css";

interface Props {
  view: ProposalView;
  weekDates: readonly string[];
  today: string;
  structureMeals: readonly MealKind[] | undefined;
  /** Scrive nel piano (un solo evento, annullabile). */
  onUse: () => void;
  busy: boolean;
}

const toggle = <T,>(list: readonly T[], value: T): T[] => (list.includes(value) ? list.filter((x) => x !== value) : [...list, value]);

export function ProposalCard({ view, weekDates, today, structureMeals, onUse, busy }: Props) {
  const ids = useId();
  const { settings, proposal } = view;
  if (!settings || !proposal) return null;
  const set = (patch: Partial<ProposalSettings>) => view.change({ ...settings, ...patch });
  const days = remainingDays(weekDates, today);
  const { summary } = proposal;
  const notes = summaryNotes(summary, proposal.unfilled.length);
  const noRecipes = view.recipeCount === 0;

  return (
    <section className={styles.proposalCard} aria-label="Proposta per la settimana">
      <Label>Proposta, non ancora nel piano</Label>
      {noRecipes ? (
        <>
          <p className={ui.lead}>Non hai ancora ricette salvate: senza, non ho da dove scegliere.</p>
          <Link href="/app/ricette" className={ui.textLink}>
            Vai al ricettario
          </Link>
        </>
      ) : (
        <>
          <p className={ui.lead}>{headlineText(summary)}</p>
          <p className={ui.hint}>{settings.spendLeast ? CRITERIA_TEXT_SPEND : CRITERIA_TEXT}</p>
          {notes.length > 0 ? (
            <ul className={styles.rows}>
              {notes.map((n) => (
                <li key={n} className={styles.row}>
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
          {view.message ? (
            <p className={ui.hint} role="status">
              {view.message}
            </p>
          ) : null}
        </>
      )}

      <details className={styles.proposalOptions}>
        <summary>Cambia le scelte</summary>
        <div className={styles.proposalBody}>
          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel}>Quali momenti</legend>
            <div className={ui.choices}>
              {momentChoices(structureMeals).map((k) => (
                <label key={k} className={ui.choice}>
                  <input type="checkbox" checked={settings.moments.includes(k)} onChange={() => set({ moments: toggle(settings.moments, k) })} />
                  <span>{MEAL_KIND_LABELS[k]}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel}>Quali giorni</legend>
            <div className={ui.choices}>
              {days.map((d) => (
                <label key={d} className={ui.choice}>
                  <input type="checkbox" checked={settings.days.includes(d)} onChange={() => set({ days: toggle(settings.days, d) })} aria-label={dayMonth(d)} />
                  <span>{shortDay(d)}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel}>Giorni con poco tempo</legend>
            <div className={ui.choices}>
              {days.map((d) => (
                <label key={d} className={ui.choice}>
                  <input type="checkbox" checked={settings.lowTimeDays.includes(d)} onChange={() => set({ lowTimeDays: toggle(settings.lowTimeDays, d) })} aria-label={`Poco tempo, ${dayMonth(d)}`} />
                  <span>{shortDay(d)}</span>
                </label>
              ))}
            </div>
            <p className={ui.hint}>In quei giorni niente ricette che richiedono più di mezz&apos;ora.</p>
          </fieldset>

          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel}>Porzioni a pasto</legend>
            <div className={ui.choices}>
              {SERVINGS_CHOICES.map((n) => (
                <label key={n} className={ui.choice}>
                  <input type="radio" name={`${ids}-serv`} checked={settings.servings === n} onChange={() => set({ servings: n })} />
                  <span>{n}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset className={ui.field}>
            <legend className={ui.fieldLabel}>La stessa ricetta al massimo</legend>
            <div className={ui.choices}>
              {MAX_REPEAT_CHOICES.map((n) => (
                <label key={n} className={ui.choice}>
                  <input type="radio" name={`${ids}-rep`} checked={settings.maxRepeats === n} onChange={() => set({ maxRepeats: n })} />
                  <span>{n === 1 ? "1 volta" : `${n} volte`}</span>
                </label>
              ))}
            </div>
            <p className={ui.hint}>Mai nello stesso giorno né in giorni consecutivi.</p>
          </fieldset>

          {summary.excluded.uncertain > 0 || settings.allowUncertain ? (
            <label className={ui.switch}>
              <input type="checkbox" checked={settings.allowUncertain} onChange={() => set({ allowUncertain: !settings.allowUncertain })} />
              <span className={ui.switchText}>
                Anche le ricette che non posso controllare del tutto
                <span className={ui.hint}>Entrano con un avviso: gli ingredienti vanno letti in etichetta.</span>
              </span>
            </label>
          ) : null}

          {view.hasPrices ? (
            <label className={ui.switch}>
              <input type="checkbox" checked={settings.spendLeast} onChange={() => set({ spendLeast: !settings.spendLeast })} />
              <span className={ui.switchText}>
                Spendi il meno possibile
                <span className={ui.hint}>Il costo stimato passa in cima ai criteri.</span>
              </span>
            </label>
          ) : null}
        </div>
      </details>

      <div className={ui.row}>
        <Button disabled={busy || proposal.meals.length === 0} onClick={onUse}>
          Usa questa settimana
        </Button>
        <Button variant="outline" onClick={view.discard}>
          Scarta la proposta
        </Button>
      </div>
    </section>
  );
}
