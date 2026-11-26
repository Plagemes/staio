"use client";

// I fogli della Settimana che non sono una voce: quantità (anche come passo del foglio della voce), copia di un giorno, tipo di giornata.
import { useId, useState } from "react";
import { weekDates, type PlannedEntry, type PlannedItem } from "@/core/plan";
import { Button } from "@/design";
import { readQuantity } from "../capture";
import ui from "../ui.module.css";
import { dayHeading, dayMonth, type WeekChoice } from "./dates";
import { itemLabel } from "./describe";
import { StepFrame } from "./Sheet";
import { parseAmount } from "./targets";
import type { PlanData } from "./usePlanData";

export function AmountSheet({
  entry,
  data,
  onClose,
  onSave,
  embedded = false,
}: {
  entry: PlannedEntry;
  data: PlanData;
  onClose: () => void;
  onSave: (item: PlannedItem) => Promise<string | null>;
  embedded?: boolean;
}) {
  const id = useId();
  const item = entry.item;
  const [text, setText] = useState(item.kind === "food" ? `${item.quantity.value} ${item.quantity.unit}` : String(item.servings).replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError(null);
    let next: PlannedItem;
    if (item.kind === "food") {
      const q = readQuantity(text);
      if (!q.ok) return setError(q.error);
      next = { ...item, quantity: q.quantity };
    } else {
      const n = parseAmount(text);
      if (n === null || n <= 0) return setError("Scrivi quante porzioni, per esempio 2.");
      next = { ...item, servings: n };
    }
    setBusy(true);
    const failure = await onSave(next);
    setBusy(false);
    if (failure) setError(failure);
  }

  return (
    <StepFrame
      embedded={embedded}
      title={item.kind === "food" ? "Correggi la quantità" : "Correggi le porzioni"}
      onClose={onClose}
      busy={busy}
      footer={
        <Button type="submit" form={`${id}-form`} disabled={busy}>
          Salva
        </Button>
      }
    >
      <form
        id={`${id}-form`}
        className={ui.form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className={ui.lead}>{itemLabel(item, data.catalog)}</p>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={id}>
            {item.kind === "food" ? "Quantità" : "Porzioni"}
          </label>
          <input id={id} className={ui.input} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" inputMode={item.kind === "food" ? "text" : "decimal"} />
        </div>
        {error ? (
          <p className={ui.error} role="alert">
            {error}
          </p>
        ) : null}
      </form>
    </StepFrame>
  );
}

export function CopyDaySheet({
  from,
  today,
  weeks,
  onClose,
  onCopy,
}: {
  from: string;
  today: string;
  weeks: WeekChoice[];
  onClose: () => void;
  onCopy: (to: string) => Promise<string | null>;
}) {
  const ids = useId();
  const [to, setTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const options = weeks.filter((w) => w.id !== "previous").flatMap((w) => weekDates(w.start)).filter((d) => d !== from && d >= today);
  return (
    <StepFrame
      title={`Copia il ${dayMonth(from)}`}
      onClose={onClose}
      busy={busy}
      footer={
        <Button
          disabled={to === null || busy}
          onClick={async () => {
            if (!to) return;
            setBusy(true);
            setError(await onCopy(to));
            setBusy(false);
          }}
        >
          Copia
        </Button>
      }
    >
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Su quale giorno</legend>
        <div className={ui.choices}>
          {options.map((d) => (
            <label key={d} className={ui.choice}>
              <input type="radio" name={`${ids}-to`} checked={to === d} onChange={() => setTo(d)} />
              <span>{dayHeading(d, today).replace(/, (oggi|domani)$/, "")}</span>
            </label>
          ))}
        </div>
        <p className={ui.hint}>I pasti già pianificati nel giorno scelto vengono sostituiti.</p>
      </fieldset>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </StepFrame>
  );
}

export function DayTypeSheet({
  date,
  data,
  onClose,
  onSet,
  onClear,
}: {
  date: string;
  data: PlanData;
  onClose: () => void;
  onSet: (name: string) => Promise<string | null>;
  onClear: () => Promise<string | null>;
}) {
  const ids = useId();
  const plan = data.plan!;
  const known = [...new Set([...plan.targets.map((t) => t.dayType), ...plan.dayTypes.map((d) => d.dayType), ...(plan.structure?.defaultDayType ? [plan.structure.defaultDayType] : [])])].sort();
  const current = plan.dayTypes.find((d) => d.date === date);
  const [choice, setChoice] = useState<string>(current?.dayType ?? plan.structure?.defaultDayType ?? "");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = choice === "__new" ? custom : choice;
  return (
    <StepFrame
      title={`Tipo di giornata, ${dayMonth(date)}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <Button
            disabled={name.trim() === "" || busy}
            onClick={async () => {
              setBusy(true);
              setError(await onSet(name));
              setBusy(false);
            }}
          >
            Salva
          </Button>
          {current ? (
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError(await onClear());
                setBusy(false);
              }}
            >
              Togli il tipo
            </Button>
          ) : null}
        </>
      }
    >
      <p className={ui.lead}>Per esempio «allenamento» o «riposo»: i nomi li scegli tu, e gli obiettivi si scrivono per ogni tipo.</p>
      <fieldset className={ui.field}>
        <legend className={ui.srOnly}>Tipo di giornata</legend>
        <div className={ui.choices}>
          {known.map((k) => (
            <label key={k} className={ui.choice}>
              <input type="radio" name={`${ids}-t`} checked={choice === k} onChange={() => setChoice(k)} />
              <span>{k}</span>
            </label>
          ))}
          <label className={ui.choice}>
            <input type="radio" name={`${ids}-t`} checked={choice === "__new"} onChange={() => setChoice("__new")} />
            <span>Un altro</span>
          </label>
        </div>
        {choice === "__new" ? (
          <input className={ui.input} value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Nome del tipo di giornata" placeholder="allenamento" autoComplete="off" />
        ) : null}
      </fieldset>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </StepFrame>
  );
}
