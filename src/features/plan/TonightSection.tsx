"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { addDays } from "@/core/diary";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { activeLots } from "@/core/ledger";
import { derivePlan, getWeek, missingFor, weekStartOf, type PlannedEntry } from "@/core/plan";
import { getAllEvents, getPantry } from "@/data";
import { Button, Label, SectionHeader } from "@/design";
import { Disclosure } from "../common";
import { DIET_HREF, declaredLists, readDietDeclarations, useDietDeclarations } from "../allergens";
import { momentReaders } from "./moveMeal";
import { useNotice } from "../notice";
import { NO_FILTERS, applyFilters, buildRows, confirmedRowText, pantryView, sortRows, type RecipeRow } from "../recipes/list";
import { makeLinkOf, pantryFoods } from "../recipes/allergenLinks";
import { IncompleteDeclarations } from "../recipes/SafetyPanel";
import { useConfirmations } from "../recipes/useConfirmations";
import { useDishHistory } from "../recipes/useDishHistory";
import { useProducts } from "../nutrition/useNutrition";
import { addManualEntries } from "../shopping/add";
import ui from "../ui.module.css";
import { buildWeek, entryOf, withEntry } from "./edit";
import { itemLabel, itemName } from "./describe";
import { cookHref } from "./itemCommand";
import { localMinutes } from "./localMinutes";
import { UNRESOLVED_TEXT, coveredText, listedText, missingLineText, missingSummary, portionsLeftOf, stockLines } from "./missingView";
import { tonightMoments, wantsIdeas, type TonightMoment } from "./tonight";
import type { PlanData } from "./usePlanData";
import { useWeekEditor } from "./useWeekEditor";
import styles from "./plan.module.css";

const MAX_IDEAS = 3;
const MAX_OUTLINE_COMMANDS = 2;

interface Props {
  data: PlanData;
  /** «Cucina» sulla prima ricetta è il pulsante pieno della schermata (altrimenti lo è «Proponi la settimana»). */
  primaryCook: boolean;
}

const weekHref = (date: string) => `/app/piano/settimana?giorno=${date}`;

/** «Stasera e domani»: i momenti da adesso a domani con voci pianificate, ognuno con «Cucina» e «Che cosa manca». */
export function TonightSection({ data, primaryCook }: Props) {
  const notice = useNotice();
  const edit = useWeekEditor();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const plan = data.plan;
  const timeZone = data.diary?.timeZone;
  const nowMinutes = localMinutes(data.now, timeZone);
  // oggi e domani possono stare in due settimane diverse (la domenica)
  const relevantEntries = useMemo<PlannedEntry[]>(() => {
    if (!plan) return [];
    const starts = new Set([weekStartOf(data.today), weekStartOf(addDays(data.today, 1))]);
    return [...starts].flatMap((s) => getWeek(plan, s)?.entries ?? []);
  }, [plan, data.today]);

  const done = useMemo(() => {
    if (!data.diary || !data.now) return undefined;
    const readers = momentReaders({ diary: data.diary, now: data.now, timeZone: data.diary.timeZone ?? DEFAULT_TIME_ZONE, today: data.today });
    return (date: string, meal: PlannedEntry["meal"]) => readers.status(date, meal) !== "none";
  }, [data.diary, data.now, data.today]);

  const moments = useMemo(() => tonightMoments({ today: data.today, nowMinutes, entries: relevantEntries, ...(done ? { done } : {}) }), [data.today, nowMinutes, relevantEntries, done]);
  const needIdeas = wantsIdeas({ today: data.today, nowMinutes, entries: relevantEntries, moments, ...(done ? { done } : {}) });

  const stock = useMemo(() => stockLines(data.lots), [data.lots]);
  const portionsLeft = useMemo(() => portionsLeftOf(data.preps, data.lots), [data.preps, data.lots]);
  const nameOf = useMemo(() => (item: PlannedEntry["item"]) => itemName(item, data.catalog), [data.catalog]);

  const results = useMemo(
    () => moments.map((m) => missingFor(m.entries, { expand: data.expand, stock, portionsLeft, nameOf })),
    [moments, data.expand, stock, portionsLeft, nameOf],
  );

  // i comandi «Cucina»: il primo è il pulsante pieno della schermata (se lo è) e la sua riga non lo ripete; poi al massimo due a contorno
  const cooks = useMemo(() => {
    const exists = (id: string) => data.recipes.some((r) => r.recipeId === id);
    const variants = new Map<PlannedEntry, "primary" | "outline" | "text">();
    let outlines = 0;
    let first = true;
    for (const m of moments) {
      for (const e of m.entries) {
        if (e.item.kind !== "recipe" || !exists(e.item.recipeId)) continue;
        if (first && primaryCook) variants.set(e, "primary");
        else variants.set(e, outlines++ < MAX_OUTLINE_COMMANDS ? "outline" : "text");
        first = false;
      }
    }
    return variants;
  }, [moments, data.recipes, primaryCook]);

  async function addMissing(moment: TonightMoment) {
    const id = `${moment.date}|${moment.meal}`;
    setBusy(id);
    setError(null);
    try {
      // il piano e la dispensa si rileggono: ciò che c'era a schermo può essere già cambiato
      const fresh = derivePlan(await getAllEvents());
      const lots = activeLots(await getPantry());
      const entries = (getWeek(fresh, weekStartOf(moment.date))?.entries ?? []).filter((e) => e.date === moment.date && e.meal === moment.meal);
      const result = missingFor(entries, { expand: data.expand, stock: stockLines(lots), portionsLeft: portionsLeftOf(data.preps, lots), nameOf });
      if (result.lines.length === 0) {
        notice.show({ message: "Non manca più niente: hai già tutto." });
        return;
      }
      const written = await addManualEntries(result.lines.map((l) => ({ product: l.name, quantity: { value: l.missing, unit: l.unit } })));
      if (written.added === 0) {
        setError("Non sono riuscito ad aggiungere alla spesa. Riprova.");
        return;
      }
      notice.show({ message: listedText(written.added), onUndo: written.undo });
    } catch {
      setError("Non sono riuscito ad aggiungere alla spesa. Riprova.");
    } finally {
      setBusy(null);
    }
  }

  const diet = useDietDeclarations();
  const products = useProducts();
  const { byKey: confirmations } = useConfirmations();
  const dishes = useDishHistory();
  const lists = useMemo(() => (diet.state ? declaredLists(diet.state) : undefined), [diet.state]);
  const linkOf = useMemo(() => makeLinkOf(pantryFoods(data.lots, products)), [data.lots, products]);
  const view = useMemo(() => (data.now ? pantryView(data.lots, data.now) : undefined), [data.lots, data.now]);

  // stesso controllo del ricettario: una ricetta con un allergene o un alimento escluso non compare mai tra le proposte
  const ideas = useMemo(() => {
    if (!needIdeas || !view || !lists || !confirmations) return undefined;
    const rows = buildRows(data.recipes, view, dishes.byRecipe);
    const filtered = applyFilters(rows, { ...NO_FILTERS, allergens: lists.allergens, excludedFoods: lists.excludedFoods, linkOf, confirmations });
    return { rows: sortRows(filtered.rows, "expiring").slice(0, MAX_IDEAS), confirmedBy: filtered.confirmedBy };
  }, [needIdeas, view, lists, confirmations, data.recipes, dishes.byRecipe, linkOf]);

  async function putTonight(row: RecipeRow) {
    setBusy(row.recipe.recipeId);
    setError(null);
    let failure: string | null;
    try {
      // le dichiarazioni si rileggono: la ricetta deve passare il controllo adesso, non solo quando è comparsa
      const freshLists = declaredLists(await readDietDeclarations());
      const checked = confirmations ? applyFilters([row], { ...NO_FILTERS, allergens: freshLists.allergens, excludedFoods: freshLists.excludedFoods, linkOf, confirmations }) : undefined;
      if (!checked || checked.rows.length === 0) {
        setError("Questa ricetta non passa più il controllo di allergeni ed esclusioni: aprila per vedere perché.");
        setBusy(null);
        return;
      }
      const week = weekStartOf(data.today);
      const entry = entryOf(data.today, "dinner", { kind: "recipe", recipeId: row.recipe.recipeId, servings: row.recipe.servings });
      failure = await edit((read, ctx) => buildWeek(week, withEntry(read(week), entry), ctx, `Aggiunto al piano: ${row.recipe.title}, stasera.`));
    } catch {
      failure = "Non sono riuscito a salvare sul telefono. Riprova.";
    }
    setBusy(null);
    if (failure) setError(failure);
  }

  return (
    <section className={ui.section} aria-label="Stasera e domani">
      <SectionHeader label="Stasera e domani" />
      <div className={styles.tonight}>
        {diet.state && !diet.state.complete && needIdeas ? <IncompleteDeclarations /> : null}
        {moments.map((m, i) => {
          const result = results[i];
          const id = `${m.date}|${m.meal}`;
          return (
            <div key={id} className={styles.moment}>
              <Label>{m.label}</Label>
              <ul className={styles.momentRows}>
                {m.entries.map((e, j) => {
                  const item = e.item;
                  const cook = cooks.get(e);
                  return (
                    <li key={`${j}-${itemLabel(item, data.catalog)}`} className={styles.momentRow}>
                      <Link href={weekHref(m.date)} className={styles.momentName}>
                        {itemLabel(item, data.catalog)}
                      </Link>
                      {item.kind === "recipe" && (cook === "outline" || cook === "text") ? (
                        <Button variant={cook} href={cookHref(item.recipeId, item.servings)}>
                          Cucina
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {m.entries.map((e, j) =>
                e.item.kind === "recipe" && cooks.get(e) === "primary" ? (
                  <div key={`cook-${j}`}>
                    <Button href={cookHref(e.item.recipeId, e.item.servings)}>Cucina</Button>
                  </div>
                ) : null,
              )}
              <Disclosure title="Che cosa manca" summary={missingSummary(result)}>
                {result.lines.length > 0 ? (
                  <ul className={styles.rows}>
                    {result.lines.map((l) => (
                      <li key={l.key} className={styles.row}>
                        {missingLineText(l)}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {coveredText(result) ? <p className={ui.hint}>{coveredText(result)}</p> : null}
                {result.unresolved.length > 0 ? <p className={ui.hint}>{UNRESOLVED_TEXT}</p> : null}
                {result.lines.length > 0 ? (
                  <div>
                    <Button variant="outline" disabled={busy === id} onClick={() => void addMissing(m)}>
                      Aggiungi alla spesa
                    </Button>
                  </div>
                ) : null}
              </Disclosure>
            </div>
          );
        })}

        {moments.length === 0 && !needIdeas ? <p className={ui.paragraph}>Niente di pianificato per i prossimi pasti.</p> : null}

        {needIdeas ? (
          <div className={styles.moment}>
            <p className={ui.paragraph}>Niente nel piano per stasera.</p>
            {ideas && ideas.rows.length > 0 ? (
              <ul className={styles.momentRows}>
                {ideas.rows.map((row) => (
                  <li key={row.recipe.recipeId} className={styles.momentRow}>
                    <span className={styles.momentName}>
                      {row.recipe.title}
                      {confirmedRowText(ideas.confirmedBy.get(row.recipe.recipeId) ?? []) ? <span className={styles.entryNote}>{confirmedRowText(ideas.confirmedBy.get(row.recipe.recipeId) ?? [])}</span> : null}
                    </span>
                    <Button variant="text" disabled={busy === row.recipe.recipeId} onClick={() => void putTonight(row)}>
                      Metti stasera
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
            <Link href="/app/ricette/idee" className={ui.textLink}>
              Cosa cucinare
            </Link>
          </div>
        ) : null}

        {error ? (
          <p className={ui.error} role="alert">
            {error}{" "}
            {error.includes("allergeni") ? (
              <Link href={DIET_HREF} className={ui.textLink}>
                Apri Alimentazione
              </Link>
            ) : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}
