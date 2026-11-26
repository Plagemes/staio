"use client";

import { useMemo, useState } from "react";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import type { PlannedEntry, Slot } from "@/core/plan";
import { ActionList, type ActionItem } from "../common";
import ui from "../ui.module.css";
import { itemLabel, itemName } from "./describe";
import { EatSheet } from "./EatSheet";
import type { EntryRef } from "./entryKey";
import { MoveSheet } from "./MoveSheet";
import { slotText, slotsToMoveTo } from "./moveMeal";
import { SteppedSheet } from "./Sheet";
import type { PlanData } from "./usePlanData";
import { amountBuilder, moveBuilder, removeBuilder, useWeekEditor } from "./useWeekEditor";
import { AmountSheet } from "./WeekSheets";

type Step = "root" | "eat" | "move" | "amount";

interface Props {
  data: PlanData;
  entry: PlannedEntry;
  /** Come ritrovare la voce quando la settimana viene riletta. */
  entryRef: EntryRef;
  weekStart: string;
  /** Il lunedì della settimana dopo: gli spostamenti arrivano fin lì. */
  nextWeekStart: string;
  /** Le voci della settimana, per i posti liberi dove spostare. */
  entries: readonly PlannedEntry[];
  /** Registrare come mangiato è già il comando in vista nella riga: qui non si ripete. */
  eatShown: boolean;
  onClose: () => void;
}

const SUBTITLE: Record<Exclude<Step, "root">, string> = {
  eat: "Registra come mangiato",
  move: "Sposta",
  amount: "Correggi le porzioni",
};

/**
 * Il foglio di una voce del piano. Un foglio solo: i passi (registra, sposta, cambia) ne cambiano il contenuto, con
 * «Indietro». Ogni scrittura rilegge la settimana e chiude il foglio prima dell'avviso.
 */
export function ItemSheet({ data, entry, entryRef, weekStart, nextWeekStart, entries, eatShown, onClose }: Props) {
  const edit = useWeekEditor();
  const [step, setStep] = useState<Step>("root");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const item = entry.item;
  const name = itemName(item, data.catalog);
  const recipeShown = item.kind === "recipe" && data.recipes.some((r) => r.recipeId === item.recipeId);
  const from: Slot = useMemo(() => ({ date: entry.date, meal: entry.meal }), [entry.date, entry.meal]);

  const items: ActionItem[] = [
    // un giorno che non è ancora arrivato non si registra come mangiato
    ...(!eatShown && entry.date <= data.today ? [{ id: "eat", label: "Registra come mangiato", onSelect: () => setStep("eat") }] : []),
    { id: "move", label: "Sposta", onSelect: () => setStep("move") },
    { id: "amount", label: item.kind === "food" ? "Correggi la quantità" : "Correggi le porzioni", onSelect: () => setStep("amount") },
    ...(recipeShown && item.kind === "recipe" ? [{ id: "recipe", label: "Apri la ricetta", href: `/app/ricette/vedi?id=${encodeURIComponent(item.recipeId)}` }] : []),
    {
      id: "remove",
      label: "Togli dal piano",
      danger: true,
      onSelect: () => {
        void (async () => {
          setBusy(true);
          setError(null);
          const failure = await edit(removeBuilder(weekStart, entryRef, data.catalog), { beforeNotice: onClose });
          setBusy(false);
          if (failure) setError(failure);
        })();
      },
    },
  ];

  const back = step === "root" ? undefined : () => setStep("root");

  return (
    <SteppedSheet title={step === "root" ? name : SUBTITLE[step]} onClose={onClose} onBack={back} busy={busy} withFooter={step !== "root"}>
      {step === "root" ? (
        <>
          <p className={ui.lead}>{slotText(from)}</p>
          <ActionList items={items} />
          {error ? (
            <p className={ui.error} role="alert">
              {error}
            </p>
          ) : null}
        </>
      ) : null}

      {step === "eat" ? <EatSheet embedded data={data} entry={entry} onClose={onClose} /> : null}

      {step === "move" && data.diary && data.now ? (
        <MoveSheet
          embedded
          what={entries
            .filter((e) => e.date === from.date && e.meal === from.meal)
            .map((e) => itemLabel(e.item, data.catalog))
            .join(", ")}
          from={from}
          today={data.today}
          options={slotsToMoveTo({
            weekEntries: entries,
            diary: data.diary,
            now: data.now,
            timeZone: data.diary.timeZone ?? DEFAULT_TIME_ZONE,
            today: data.today,
            weekStart,
            kinds: data.plan?.structure?.meals.map((m) => m.kind),
            from,
            nextWeek: { weekStart: nextWeekStart, entries: weekEntriesOf(data, nextWeekStart) },
          })}
          onClose={onClose}
          onMove={(to) => edit(moveBuilder(weekStart, nextWeekStart, from, to), { beforeNotice: onClose })}
        />
      ) : null}

      {step === "amount" ? (
        <AmountSheet
          embedded
          entry={entry}
          data={data}
          onClose={onClose}
          onSave={(next) => edit(amountBuilder(weekStart, entryRef, next, data.catalog), { beforeNotice: onClose })}
        />
      ) : null}
    </SteppedSheet>
  );
}

function weekEntriesOf(data: PlanData, weekStart: string): readonly PlannedEntry[] {
  return data.plan?.weeks.find((w) => w.weekStart === weekStart)?.entries ?? [];
}
