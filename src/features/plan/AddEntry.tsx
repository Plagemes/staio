"use client";

import { useId, useMemo, useState } from "react";
import type { MealKind } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { buildWeek, entryOf, withoutEntry } from "./edit";
import type { PlannedEntry, PlannedItem } from "@/core/plan";
import { Button, Label, Tabs } from "@/design";
import { readQuantity } from "../capture";
import { MEAL_KIND_LABELS } from "../meals";
import { createFoodSearch, resolveFreeItems } from "../nutrition/candidates";
import { FoodChoice } from "../nutrition/FoodChoice";
import { loadFoods, useFoods } from "../nutrition/useNutrition";
import { useNotice } from "../notice";
import { Disclosure } from "../common/Disclosure";
import ui from "../ui.module.css";
import { dayMonth } from "./dates";
import { KIND_LABELS, itemLabel, servingsText } from "./describe";
import { ENTRY_CHANGED, addBuilder, useWeekEditor } from "./useWeekEditor";
import { entryKey, findLastEntry } from "./entryKey";
import { Sheet } from "./Sheet";
import { startMeal } from "./startMeal";
import { parseAmount } from "./targets";
import type { PlanData } from "./usePlanData";
import { localMinutes } from "./localMinutes";
import styles from "./plan.module.css";

type Kind = PlannedItem["kind"];

interface PickRow {
  id: string;
  title: string;
  detail: string;
  servings: number;
}

const TABS = (Object.keys(KIND_LABELS) as Kind[]).map((id) => ({ id, label: KIND_LABELS[id] }));
const lower = (meal: MealKind) => MEAL_KIND_LABELS[meal].toLowerCase();

interface AddEntryProps {
  data: PlanData;
  /** Pasti tra cui scegliere, nell'ordine della struttura del piano. */
  meals: readonly MealKind[];
  meal: MealKind;
  onMeal: (meal: MealKind) => void;
  formId: string;
  onBusy: (busy: boolean) => void;
  /** Scrive la voce. Restituisce il testo dell'errore, oppure `null` se è andata bene (allora i campi si azzerano). */
  onAdd: (meal: MealKind, item: PlannedItem) => Promise<string | null>;
}

/** I campi di «Aggiungi»: un alimento (con la stessa scelta esplicita della registrazione), una ricetta o una preparazione. */
export function AddEntry({ data, meals, meal, onMeal, formId, onBusy, onAdd }: AddEntryProps) {
  const ids = useId();
  const foods = useFoods();
  const search = useMemo(() => (foods ? createFoodSearch(foods) : undefined), [foods]);
  const [kind, setKind] = useState<Kind>("food");
  const [name, setName] = useState("");
  const [quantityText, setQuantityText] = useState("");
  const [foodId, setFoodId] = useState<string | undefined>();
  const [none, setNone] = useState(false);
  const [filter, setFilter] = useState("");
  const [refId, setRefId] = useState<string | null>(null);
  const [servingsTextValue, setServingsText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const list: PickRow[] =
    kind === "recipe"
      ? data.recipes.map((r) => ({ id: r.recipeId, title: r.title, detail: `Per ${servingsText(r.servings)}`, servings: r.servings }))
      : data.preps
          .filter((p) => p.status === "active")
          .map((p) => ({ id: p.prepId, title: p.title, detail: `${servingsText(p.remaining)} pronte su ${p.portions}`, servings: 1 }));
  const q = filter.trim().toLowerCase();
  const shown = list.filter((x) => q === "" || x.title.toLowerCase().includes(q));
  const chosen = list.find((x) => x.id === refId);

  function pick(id: string, defaultServings: number) {
    setRefId(id);
    setServingsText(String(defaultServings).replace(".", ","));
    setError(null);
  }

  /** Dopo un'aggiunta riuscita: i campi si azzerano; il tipo e il pasto restano, per la voce dopo. */
  function clear() {
    setName("");
    setQuantityText("");
    setFoodId(undefined);
    setNone(false);
    setFilter("");
    setRefId(null);
    setServingsText("");
  }

  async function submit() {
    setError(null);
    let item: PlannedItem;
    if (kind === "food") {
      if (name.trim() === "") return setError("Scrivi come si chiama l'alimento.");
      const parsed = readQuantity(quantityText);
      if (!parsed.ok) return setError(parsed.error);
      const resolved = resolveFreeItems([{ name, quantityText, foodId, none }], search ?? createFoodSearch(await loadFoods()));
      if (resolved.errors[0]) return setError(resolved.errors[0]);
      item = { kind: "food", name: name.trim().replace(/\s+/g, " "), ...(foodId ? { foodId } : {}), quantity: parsed.quantity };
    } else {
      if (!refId) return setError(kind === "recipe" ? "Scegli una ricetta." : "Scegli una preparazione.");
      const servings = parseAmount(servingsTextValue);
      if (servings === null || servings <= 0) return setError("Scrivi quante porzioni, per esempio 2.");
      item = kind === "recipe" ? { kind: "recipe", recipeId: refId, servings } : { kind: "prep", prepId: refId, servings };
    }
    onBusy(true);
    const result = await onAdd(meal, item);
    onBusy(false);
    if (result) setError(result);
    else clear();
  }

  return (
    <form
      id={formId}
      className={ui.form}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      noValidate
    >
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>Per quale pasto</legend>
        <div className={ui.choices}>
          {meals.map((m) => (
            <label key={m} className={ui.choice}>
              <input type="radio" name={`${ids}-meal`} value={m} checked={meal === m} onChange={() => onMeal(m)} />
              <span>{MEAL_KIND_LABELS[m]}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <Tabs
        label="Che cosa aggiungi"
        items={TABS}
        value={kind}
        onChange={(id) => {
          setKind(id as Kind);
          // la scelta di una ricetta non vale per una preparazione, e viceversa
          setRefId(null);
          setServingsText("");
          setFilter("");
          setError(null);
        }}
      />

      {kind === "food" ? (
        <div className={ui.form}>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-name`}>
              Alimento
            </label>
            <input
              id={`${ids}-name`}
              className={ui.input}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setFoodId(undefined);
                setNone(false);
              }}
              autoComplete="off"
              placeholder="Pasta"
            />
          </div>
          <div className={ui.field}>
            <label className={ui.fieldLabel} htmlFor={`${ids}-qty`}>
              Quantità
            </label>
            <input id={`${ids}-qty`} className={ui.input} value={quantityText} onChange={(e) => setQuantityText(e.target.value)} autoComplete="off" placeholder="80 g" />
          </div>
          {search ? (
            <FoodChoice
              name={name}
              search={search}
              foodId={foodId}
              none={none}
              onPick={(id) => {
                setFoodId(id);
                setNone(false);
              }}
              onNone={() => {
                setFoodId(undefined);
                setNone(true);
              }}
              onClear={() => {
                setFoodId(undefined);
                setNone(false);
              }}
            />
          ) : null}
          <p className={ui.hint}>Il piano è un&apos;intenzione: non scala la dispensa.</p>
        </div>
      ) : (
        <div className={ui.form}>
          {list.length === 0 ? (
            <div className={ui.empty}>
              <h3 className={ui.emptyTitle}>{kind === "recipe" ? "Nessuna ricetta" : "Nessuna preparazione"}</h3>
              <p className={ui.emptyText}>
                {kind === "recipe"
                  ? "Le ricette che salvi compariranno qui, da aggiungere a un pasto con le porzioni."
                  : "Le preparazioni che cucini compariranno qui, con le porzioni ancora pronte."}
              </p>
              <Button href={kind === "recipe" ? "/app/ricette" : "/app/preparazioni"} variant="outline">
                {kind === "recipe" ? "Apri le ricette" : "Apri le preparazioni"}
              </Button>
            </div>
          ) : (
            <>
              {list.length > 6 ? (
                <input className={ui.input} type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Cerca per nome" aria-label="Cerca per nome" autoComplete="off" />
              ) : null}
              <ul className={styles.pickList} role="radiogroup" aria-label={kind === "recipe" ? "Ricette" : "Preparazioni"}>
                {shown.map((x) => (
                  <li key={x.id}>
                    <label className={styles.pick}>
                      <input type="radio" name={`${ids}-ref`} checked={refId === x.id} onChange={() => pick(x.id, x.servings)} />
                      <span className={styles.pickText}>
                        {x.title}
                        <span className={styles.pickDetail}>{x.detail}</span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {shown.length === 0 ? <p className={ui.hint}>Niente con questo nome.</p> : null}
              {chosen ? (
                <div className={ui.field}>
                  <label className={ui.fieldLabel} htmlFor={`${ids}-serv`}>
                    Porzioni
                  </label>
                  <input id={`${ids}-serv`} className={ui.input} inputMode="decimal" value={servingsTextValue} onChange={(e) => setServingsText(e.target.value)} autoComplete="off" />
                  {kind === "prep" ? <Disclosure quiet title="Che cosa significa">Le porzioni già pronte non chiedono ingredienti nella lista della spesa; per le altre sì.</Disclosure> : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      )}

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

interface Added {
  key: string;
  label: string;
  meal: MealKind;
}

interface SheetProps {
  data: PlanData;
  date: string;
  weekStart: string;
  /** Le voci della settimana (per scegliere il pasto di partenza). */
  entries: readonly PlannedEntry[];
  /** I pasti da offrire, nell'ordine; tutti e quattro se il piano non ha una struttura. */
  meals: readonly MealKind[];
  /** I pasti della struttura del piano; vuoto se non c'è. */
  structureMeals: readonly MealKind[];
  onClose: () => void;
}

/**
 * Il foglio «Aggiungi»: resta aperto dopo ogni aggiunta, per la voce dopo. Ogni aggiunta è una scrittura (una riga in
 * «Ultime azioni») e non dà avvisi; alla chiusura un solo avviso, con «Annulla» per tutte quelle di questa apertura.
 */
export function AddEntrySheet({ data, date, weekStart, entries, meals, structureMeals, onClose }: SheetProps) {
  const formId = useId();
  const edit = useWeekEditor();
  const notice = useNotice();
  const [meal, setMeal] = useState<MealKind>(() =>
    startMeal({ date, today: data.today, nowMinutes: localMinutes(data.now, data.diary?.timeZone), meals: structureMeals, entries }),
  );
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Added[]>([]);
  const [events, setEvents] = useState<AnyEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function add(m: MealKind, item: PlannedItem): Promise<string | null> {
    const entry = entryOf(date, m, item);
    return edit(addBuilder(weekStart, entry, data.catalog), {
      silent: true,
      onWritten: (written) => {
        setEvents((all) => [...all, ...written]);
        setAdded((all) => [...all, { key: entryKey(entry), label: itemLabel(item, data.catalog), meal: m }]);
      },
    });
  }

  async function take(index: number) {
    const row = added[index];
    setError(null);
    const failure = await edit(
      (read, ctx) => {
        const current = read(weekStart);
        const at = findLastEntry(current, row.key);
        if (at < 0) return { ok: false, error: ENTRY_CHANGED };
        return buildWeek(weekStart, withoutEntry(current, at), ctx, `Tolto dal piano: ${row.label}.`);
      },
      {
        silent: true,
        onWritten: (written) => {
          setEvents((all) => [...all, ...written]);
          setAdded((all) => all.filter((_, i) => i !== index));
        },
      },
    );
    if (failure) setError(failure);
  }

  function close() {
    onClose();
    if (added.length === 0) return;
    notice.show({
      message: added.length === 1 ? `Aggiunto al piano: ${added[0].label}.` : `Aggiunti al piano: ${added.length} voci.`,
      undo: events,
    });
  }

  return (
    <Sheet
      title={`Aggiungi, ${dayMonth(date)}`}
      onClose={close}
      busy={busy}
      footer={
        <Button type="submit" form={formId} disabled={busy}>
          {busy ? "Aggiungo…" : `Aggiungi a ${lower(meal)}`}
        </Button>
      }
    >
      {added.length > 0 ? (
        <div className={ui.field}>
          <Label>Aggiunti:</Label>
          <ul className={styles.addedList}>
            {added.map((a, i) => (
              <li key={`${a.key}-${i}`} className={styles.added}>
                <span className={styles.addedText}>
                  {a.label} a {lower(a.meal)}
                </span>
                <Button variant="text" disabled={busy} onClick={() => void take(i)}>
                  Togli
                </Button>
              </li>
            ))}
          </ul>
          {error ? (
            <p className={ui.error} role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
      <AddEntry data={data} meals={meals} meal={meal} onMeal={setMeal} formId={formId} onBusy={setBusy} onAdd={add} />
    </Sheet>
  );
}
