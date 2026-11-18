"use client";

import { useId, useMemo, useState } from "react";
import { monthlyBudgetProgress, spendRanges, summarizeSpend, type SpendPeriodId } from "@/core/prices";
import { Button, Label, ProgressLine, SectionHeader, Tabs, Value } from "@/design";
import { formatPrice, parsePriceCents } from "../format";
import ui from "../ui.module.css";
import { budgetText, categoryLabel, spendText } from "./priceText";
import { SETTING_KEYS } from "./settings";
import type { ShoppingData } from "./useShoppingData";
import type { useSettingsUndo } from "./useSettingsUndo";
import styles from "./shopping.module.css";

type Undo = ReturnType<typeof useSettingsUndo>;

const PERIODS = [
  { id: "7", label: "7 giorni" },
  { id: "30", label: "30 giorni" },
  { id: "month", label: "Questo mese" },
];

/** Quanto hai speso dagli acquisti del registro, per categoria, e il tetto mensile facoltativo. */
export function Spending({ data, undo }: { data: ShoppingData; undo: Undo }) {
  const id = useId();
  const pantry = data.plan.pantry;
  const today = data.view?.today;
  const [period, setPeriod] = useState<SpendPeriodId>("month");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const summaries = useMemo(() => (pantry && today ? spendRanges(today).map((r) => summarizeSpend(pantry, r)) : []), [pantry, today]);
  const summary = summaries.find((s) => s.range.id === period);
  const monthly = summaries.find((s) => s.range.id === "month");
  const cap = data.monthlyBudgetCents;
  if (!summary || !monthly) return null;
  const progress = cap !== null ? monthlyBudgetProgress(monthly, cap) : null;

  async function saveCap() {
    const r = parsePriceCents(text);
    if (!r.ok) return setError("Scrivi il tetto in euro, per esempio 300 o 280,50.");
    setError(null);
    setEditing(false);
    await undo.apply(`Tetto mensile: ${formatPrice(r.cents)}.`, { [SETTING_KEYS.monthlyBudget]: r.cents }, { [SETTING_KEYS.monthlyBudget]: cap });
  }

  return (
    <section className={ui.section} aria-label="Spesa del periodo">
      <div className={ui.head}>
        <SectionHeader label="Spesa del periodo" />
        <Label>Dal registro</Label>
      </div>
      <Tabs label="Periodo della spesa" items={PERIODS} value={period} onChange={(v) => setPeriod(v as SpendPeriodId)} />
      <p className={styles.costLine}>{spendText(summary)}</p>
      {summary.byCategory.length > 0 ? (
        <ul className={styles.table}>
          {summary.byCategory.map((c) => (
            <li key={c.category ?? "-"} className={styles.rowLine}>
              <span>{categoryLabel(c.category)}</span>
              <strong>
                {c.pricedCount === 0 ? (
                  "senza prezzo"
                ) : (
                  <Value certainty={summary.certainty ?? "estimated"}>{`${c.unpricedCount > 0 ? "almeno " : ""}${formatPrice(c.cents)}`}</Value>
                )}
              </strong>
              {c.unpricedCount > 0 ? (
                <span className={styles.rowSub}>
                  {c.unpricedCount} {c.unpricedCount === 1 ? "voce" : "voci"} senza prezzo, non contate.
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <p className={ui.hint}>Contano gli acquisti registrati con un prezzo; quelli annullati o corretti nel registro valgono come corretti.</p>

      {progress ? (
        <div className={styles.card}>
          <Label>Tetto mensile</Label>
          <p className={styles.costLine}>{budgetText(progress)}</p>
          <ProgressLine value={Math.min(progress.share, 1) * 100} max={100} label={`Speso ${formatPrice(progress.spentCents)} su ${formatPrice(progress.capCents)}`} />
        </div>
      ) : null}

      {editing ? (
        <form
          className={ui.field}
          onSubmit={(e) => {
            e.preventDefault();
            void saveCap();
          }}
        >
          <label className={ui.fieldLabel} htmlFor={id}>
            Tetto mensile in euro
          </label>
          <div className={styles.inline}>
            <input id={id} className={ui.input} inputMode="decimal" value={text} onChange={(e) => setText(e.target.value)} placeholder="300" autoComplete="off" aria-invalid={error ? true : undefined} />
            <Button type="submit" variant="outline">
              Salva
            </Button>
            <Button variant="text" onClick={() => setEditing(false)}>
              Annulla
            </Button>
          </div>
          {error ? <p className={ui.error}>{error}</p> : null}
        </form>
      ) : (
        <div className={ui.row}>
          <Button
            variant="outline"
            onClick={() => {
              setText(cap !== null ? (cap / 100).toFixed(2).replace(".", ",") : "");
              setError(null);
              setEditing(true);
            }}
          >
            {cap !== null ? "Cambia il tetto mensile" : "Imposta un tetto mensile"}
          </Button>
          {cap !== null ? (
            <Button variant="text" onClick={() => undo.apply("Tetto mensile tolto.", { [SETTING_KEYS.monthlyBudget]: null }, { [SETTING_KEYS.monthlyBudget]: cap })}>
              Togli
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
