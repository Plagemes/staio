"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { activeLots } from "@/core/ledger";
import { applySubstitutions, compareWithPantry, scaleRecipe, stockFromLots, totalMinutes, type Recipe, type Substitution } from "@/core/recipes";
import { formatQuantity } from "@/core/units";
import { buildPriceBook } from "@/core/shopping";
import { getRecipes, usePantry, useRecipes } from "@/data";
import { Button, Label, Value } from "@/design";
import { Disclosure, MoreActions, type ActionItem } from "../common";
import { dayOf } from "../format";
import { dayMonth } from "../plan/dates";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import { NUTRITION_DISCLAIMER_SHORT } from "../nutrition/labels";
import { useFoodOverrides, useFoods } from "../nutrition/useNutrition";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { formatMinutes, safeSourceUrl } from "./common";
import { DishRatingRow } from "./DishRatingRow";
import { countsText, dishRatingEvent, historyText, type DishVote } from "./dishRating";
import { useDishHistory } from "./useDishHistory";
import { computeFacts, costText, coverageText, makeContextFor, makeLookup, nutrientLines } from "./facts";
import { availabilityLabel, pendingConfirmations, shortfallsWith, type Answers } from "./list";
import { MissingSheet } from "./MissingSheet";
import { PlanSheet } from "./PlanSheet";
import { rateRecipe, retireRecipe } from "./model";
import { SHARE_COPIED, SHARE_FAILED, cookedSummary, haveText, shareRecipe, shareText, statusLine, stepsSummary } from "./recipeText";
import { FlagText, IncompleteDeclarations, SafetyPanel } from "./SafetyPanel";
import { prepHref } from "../prep/substitution";
import { SubstituteOptions } from "./SubstituteOptions";
import {
  SUBSTITUTE_BASIS,
  SUBSTITUTION_PARAM,
  chosenFor,
  missingIndices,
  parseSubstitutions,
  recipeHref,
  unappliedNote,
  validSubstitutions,
  withSubstitution,
} from "./substitutes";
import { useRecipeSafety } from "./useRecipeSafety";
import { useSubstitutes } from "./useSubstitutes";
import styles from "./recipes.module.css";

/** Le porzioni dell'indirizzo, se sono un numero valido. */
function servingsFromParam(raw: string | null): number | undefined {
  const n = Number(raw);
  return raw !== null && Number.isFinite(n) && n > 0 && n <= 1000 ? n : undefined;
}

export function RecipeView() {
  const params = useSearchParams();
  const id = params.get("id");
  const recipes = useRecipes();
  const pantry = usePantry();

  if (recipes.error || pantry.error) return <StorageError />;
  if (!recipes.data || !pantry.data) {
    return (
      <div className={ui.screen}>
        <LoadingLine />
      </div>
    );
  }
  const recipe = id ? recipes.data.recipes.find((r) => r.recipeId === id) : undefined;
  if (!recipe) {
    const retired = id ? recipes.data.archived.find((r) => r.recipeId === id) : undefined;
    return (
      <div className={ui.screen}>
        <EmptyState
          title={retired ? "Questa ricetta è ritirata" : "Ricetta non trovata"}
          text={
            retired
              ? "Non compare più nel ricettario. Puoi rimetterla dall'elenco, in fondo alla pagina."
              : "Potrebbe essere stata ritirata o annullata. Torna al ricettario per sceglierne un'altra."
          }
          actionLabel="Torna al ricettario"
          actionHref="/app/ricette"
        />
      </div>
    );
  }
  // Chi torna dalla cucina o da «L'ho già cucinata» ritrova porzioni e sostituzioni scelte: se l'indirizzo cambia, la scheda riparte da lì.
  const servings = servingsFromParam(params.get("porzioni"));
  const chosen = parseSubstitutions(params.getAll(SUBSTITUTION_PARAM), recipe.ingredients.length);
  const key = JSON.stringify([recipe.recipeId, servings ?? null, chosen]);
  return <Detail key={key} recipe={recipe} initialServings={servings} initialSubstitutions={chosen} />;
}

type OpenSheet = "plan" | "missing" | null;

function Detail({ recipe: written, initialServings, initialSubstitutions }: { recipe: Recipe; initialServings: number | undefined; initialSubstitutions: Substitution[] }) {
  const pantry = usePantry();
  const foods = useFoods();
  const overrides = useFoodOverrides();
  const router = useRouter();
  const notice = useNotice();
  const { recordWith, busy } = useRecord();
  const ids = useId();
  const [servingsText, setServingsText] = useState<string | null>(initialServings === undefined ? null : String(initialServings).replace(".", ","));
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<OpenSheet>(null);
  const [answers, setAnswers] = useState<Answers>({});
  const history = useDishHistory();
  const past = history.byRecipe.get(written.recipeId);

  const typed = servingsText === null ? written.servings : Number(servingsText.replace(",", "."));
  const servingsValid = Number.isFinite(typed) && typed > 0 && typed <= 1000;
  const servings = servingsValid ? typed : written.servings;

  const lots = useMemo(() => (pantry.data ? activeLots(pantry.data) : []), [pantry.data]);
  const lookup = useMemo(() => (foods ? makeLookup(foods, overrides) : undefined), [foods, overrides]);
  const book = useMemo(() => (pantry.data ? buildPriceBook(pantry.data) : undefined), [pantry.data]);

  // Ciò che manca davvero (ricetta scritta) decide dove proporre un sostituto.
  const writtenComparison = useMemo(() => {
    const cmp = compareWithPantry(written, stockFromLots(lots), {
      servings,
      ...(lookup ? { contextFor: makeContextFor(lookup) } : {}),
    });
    return cmp.ok ? cmp.value : undefined;
  }, [written, lots, servings, lookup]);
  const missing = useMemo(() => (writtenComparison ? missingIndices(writtenComparison, answers) : []), [writtenComparison, answers]);
  const substitutes = useSubstitutes(written, missing);

  // Le sostituzioni valgono per questa cottura: la ricetta scritta non cambia. Si applicano solo quelle che sono tra le
  // proposte già controllate (un indirizzo scritto a mano non ne introduce altre). Tutto il resto (controllo allergeni,
  // dispensa, nutrienti) legge la ricetta come verrà cucinata.
  const [chosen, setChosen] = useState<Substitution[]>(initialSubstitutions);
  const substitutions = useMemo(() => validSubstitutions(chosen, substitutes.options), [chosen, substitutes.options]);
  const recipe = useMemo(() => applySubstitutions(written, substitutions), [written, substitutions]);
  const unapplied =
    substitutes.status === "loading"
      ? undefined
      : unappliedNote(chosen, substitutions, { missing, failed: substitutes.failed, originalName: (i) => written.ingredients[i]?.name ?? "" });
  const safetyState = useRecipeSafety(recipe);

  const scaled = useMemo(() => {
    const r = scaleRecipe(recipe, servings);
    return r.ok ? r.value : undefined;
  }, [recipe, servings]);
  const comparison = useMemo(() => {
    const cmp = compareWithPantry(recipe, stockFromLots(lots), {
      servings,
      ...(lookup ? { contextFor: makeContextFor(lookup) } : {}),
    });
    return cmp.ok ? cmp.value : undefined;
  }, [recipe, lots, servings, lookup]);
  const facts = useMemo(() => computeFacts(recipe, { lookup, book }), [recipe, lookup, book]);

  const minutes = totalMinutes(recipe);
  const source = safeSourceUrl(recipe.origin?.url);
  const shortfalls = useMemo(() => (comparison ? shortfallsWith(comparison, answers) : []), [comparison, answers]);
  const pending = comparison ? pendingConfirmations(comparison, answers).length : 0;
  const missingCount = shortfalls.length;
  const haveNames = useMemo(
    () => (comparison ? comparison.items.filter((i) => i.status === "available").map((i) => i.ingredient.name) : []),
    [comparison],
  );
  const have = comparison ? haveText({ total: comparison.items.length, missing: missingCount, pending }) : undefined;
  const nutrient = facts.nutrition ? nutrientLines(facts.nutrition) : [];
  const energy = nutrient.find((n) => n.key === "energyKcal");
  const hasCost = facts.cost !== undefined && facts.cost.coverage.resolved > 0;

  async function rate(value: number) {
    const next = recipe.rating === value ? undefined : value;
    // la ricetta si rilegge dall'archivio: una versione più nuova (anche da un altro telefono) non va sostituita con quella a schermo
    const fresh = (await getRecipes()).recipes.find((r) => r.recipeId === written.recipeId);
    if (!fresh) return setError("Questa ricetta non c'è più nel ricettario.");
    const r = await recordWith((deviceId) => {
      const res = rateRecipe(fresh, next, { now: new Date().toISOString(), deviceId });
      if (!res.ok) throw new Error(res.error);
      return { events: [res.event], message: next === undefined ? "Voto tolto." : `Voto: ${next} su 5.` };
    });
    if (!r.ok) setError(r.error);
  }

  /** Corregge il voto dell'ultima cottura: un nuovo evento, «Annulla» riporta quello di prima. */
  async function rateLast(vote: DishVote) {
    if (!past) return;
    const r = await recordWith((deviceId) => {
      const res = dishRatingEvent(past.last.mealId, written.recipeId, vote, { now: new Date().toISOString(), deviceId });
      if (!res.ok) throw new Error(res.error);
      return { events: [res.event], message: vote.rating ? "Voto salvato." : "Voto tolto." };
    });
    if (!r.ok) setError(r.error);
  }

  /** Parte dal foglio «Altro», già chiuso: l'avviso nasce a foglio chiuso. */
  async function retire() {
    setError(null);
    const fresh = (await getRecipes()).recipes.find((r) => r.recipeId === written.recipeId);
    if (!fresh) return setError("Questa ricetta non c'è più nel ricettario.");
    const r = await recordWith((deviceId) => {
      const res = retireRecipe(fresh, { now: new Date().toISOString(), deviceId });
      if (!res.ok) throw new Error(res.error);
      return { events: [res.event], message: `Tolta dal ricettario: ${fresh.title}.` };
    });
    if (r.ok) router.push("/app/ricette");
    else setError(r.error);
  }

  async function share() {
    const text = shareText(written, servings);
    const outcome = await shareRecipe(
      { title: written.title, text },
      {
        ...(typeof navigator !== "undefined" && typeof navigator.share === "function" ? { share: (data: { title: string; text: string }) => navigator.share(data) } : {}),
        ...(typeof navigator !== "undefined" && navigator.clipboard ? { copy: (t: string) => navigator.clipboard.writeText(t) } : {}),
      },
    );
    if (outcome === "copied") notice.show({ message: SHARE_COPIED });
    else if (outcome === "failed") notice.show({ message: SHARE_FAILED });
  }

  const more: ActionItem[] = [
    { id: "edit", label: "Modifica", href: `/app/ricette/nuova?modifica=${encodeURIComponent(recipe.recipeId)}` },
    { id: "prep", label: "Preparane più porzioni", href: prepHref(recipe.recipeId, servings, substitutions) },
    { id: "done", label: "L'ho già cucinata", href: recipeHref("/app/ricette/cucinata", recipe.recipeId, substitutions, servings) },
    { id: "pairings", label: "Con cosa sta bene", href: `/app/ricette/abbinamenti?ricetta=${encodeURIComponent(recipe.recipeId)}` },
    { id: "share", label: "Condividi", onSelect: () => void share() },
    { id: "retire", label: "Togli dal ricettario", danger: true, onSelect: () => void retire() },
  ];

  const lastDay = past ? dayMonth(dayOf(past.last.at)) : undefined;
  const energySummary = energy ? `${energy.prefix}${energy.text}` : undefined;
  const costSummary = hasCost && facts.cost ? `${costText(facts.cost).prefix}${costText(facts.cost).text}` : undefined;
  const factsSummary = !lookup ? "Calcolo in corso" : [energySummary, costSummary].filter((x): x is string => x !== undefined).join(" · ") || "Nessun dato";

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <Link href="/app/ricette" className={ui.textLink}>
          Torna al ricettario
        </Link>
        {recipe.rating !== undefined ? <Label>{"★".repeat(recipe.rating)}</Label> : null}
      </div>

      <header className={ui.section}>
        <h1 className={ui.title}>{recipe.title}</h1>
        <p className={styles.heroMeta}>
          <span>{statusLine({ ...(minutes !== undefined ? { minutes } : {}), servings, ...(have ? { have } : {}) })}</span>
        </p>
        {recipe.tags.length > 0 ? <p className={styles.note}>{recipe.tags.join(" · ")}</p> : null}
      </header>

      <div className={styles.actions}>
        <Button href={recipeHref("/app/ricette/cucina", recipe.recipeId, substitutions, servings)}>Cucina</Button>
        <Button variant="outline" onClick={() => setSheet("plan")}>
          Metti nel piano
        </Button>
        {missingCount > 0 ? (
          <Button variant="outline" onClick={() => setSheet("missing")}>
            Che cosa manca ({missingCount})
          </Button>
        ) : null}
        <MoreActions items={more} />
      </div>

      <SafetyPanel state={safetyState} heading="Allergeni ed esclusioni" />
      {substitutions.length > 0 && safetyState.status !== "none" ? (
        <p className={ui.hint}>
          Il controllo legge la ricetta con le sostituzioni scelte. I passi restano quelli scritti: se nominano l&apos;ingrediente originale, il controllo li legge così.
        </p>
      ) : null}

      {unapplied ? (
        <p className={ui.hint} role="status">
          {unapplied}
        </p>
      ) : null}

      <section className={ui.section} aria-labelledby={`${ids}-ing`}>
        <div className={ui.head}>
          <h2 id={`${ids}-ing`} className={ui.fieldLabel}>
            Ingredienti
          </h2>
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-serv`}>
            Porzioni
          </label>
          <div className={styles.servings}>
            <button
              type="button"
              className={styles.step}
              aria-label="Una porzione in meno"
              disabled={servings <= 1}
              onClick={() => setServingsText(String(Math.max(1, Math.round(servings) - 1)))}
            >
              −
            </button>
            <input
              id={`${ids}-serv`}
              className={`${ui.input} ${styles.servingsInput}`}
              inputMode="decimal"
              value={servingsText ?? String(recipe.servings).replace(".", ",")}
              onChange={(e) => setServingsText(e.target.value)}
              aria-invalid={servingsValid ? undefined : true}
            />
            <button
              type="button"
              className={styles.step}
              aria-label="Una porzione in più"
              disabled={servings >= 1000}
              onClick={() => setServingsText(String(Math.round(servings) + 1))}
            >
              +
            </button>
            {servings !== recipe.servings ? (
              <Button variant="text" onClick={() => setServingsText(null)}>
                Come scritta ({recipe.servings})
              </Button>
            ) : null}
          </div>
          {!servingsValid ? <p className={ui.error}>Scrivi un numero di porzioni da 1 a 1000.</p> : null}
          {servings !== recipe.servings ? (
            <p className={ui.hint}>Le quantità sono scalate e arrotondate a valori comodi: sono approssimative.</p>
          ) : null}
        </div>

        <ul className={styles.ingredients}>
          {(scaled?.ingredients ?? recipe.ingredients).map((ing, i) => {
            const item = comparison?.items[i];
            const answer = answers[i];
            const label = item ? availabilityLabel(item, answer) : undefined;
            const original = written.ingredients[i]?.name ?? ing.name;
            const picked = chosenFor(substitutions, i);
            const options = substitutes.options.get(i) ?? [];
            return (
              <li key={i} className={styles.ingredient}>
                <span className={styles.ingredientName}>
                  <span className={styles.ingredientQty}>{ing.quantity ? formatQuantity(ing.quantity) : "q.b."}</span>
                  {ing.name}
                  {picked !== undefined ? <span className={styles.replaces}> (al posto di «{original}»)</span> : null}
                  {ing.note ? <span className={styles.note}> ({ing.note})</span> : null}
                  {safetyState.status === "ready" ? <FlagText flag={safetyState.flags.get(i)} /> : null}
                </span>
                {label ? (
                  <span className={label.tone === "ok" ? styles.statusOk : label.tone === "neutral" ? styles.status : styles.statusMissing}>
                    {label.text}
                  </span>
                ) : null}
                {item?.status === "to_confirm" && answer === undefined ? (
                  <div className={styles.confirm} role="group" aria-label={`Conferma ${ing.name}`}>
                    <span className={styles.note}>
                      In dispensa c&apos;è {item.matched.map((m) => `«${m}»`).join(", ")}. È questo?
                    </span>
                    <div className={ui.row}>
                      <Button variant="outline" onClick={() => setAnswers((a) => ({ ...a, [i]: "yes" }))}>
                        Sì, è questo
                      </Button>
                      <Button variant="outline" onClick={() => setAnswers((a) => ({ ...a, [i]: "no" }))}>
                        No, è un altro
                      </Button>
                    </div>
                  </div>
                ) : item?.status === "to_confirm" ? (
                  <div className={styles.confirm}>
                    <Button variant="text" onClick={() => setAnswers((a) => Object.fromEntries(Object.entries(a).filter(([k]) => Number(k) !== i)) as Answers)}>
                      Cambia risposta
                    </Button>
                  </div>
                ) : null}
                {options.length > 0 || picked !== undefined ? (
                  <SubstituteOptions
                    ingredient={original}
                    options={options}
                    chosen={picked}
                    onChoose={(name) => setChosen((subs) => withSubstitution(subs, i, name))}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
        {substitutes.options.size > 0 ? <p className={ui.hint}>{SUBSTITUTE_BASIS}</p> : null}
        {substitutes.options.size > 0 && substitutes.incomplete ? <IncompleteDeclarations /> : null}
        {pending > 0 ? (
          <p className={ui.hint}>
            {pending === 1 ? "Un ingrediente è da confermare" : `${pending} ingredienti sono da confermare`}: finché non rispondi non lo conto tra quelli che hai né tra quelli che mancano.
          </p>
        ) : null}
        {comparison && comparison.items.some((x) => x.check === "presence" && x.status === "available" && x.needed) ? (
          <p className={ui.hint}>Dove scrivo «in casa» senza quantità, l&apos;unità non si confronta con la dispensa: ho controllato solo che ci sia.</p>
        ) : null}
      </section>

      <Disclosure title="Passi" summary={stepsSummary(recipe.steps.length, minutes)}>
        {recipe.equipment.length > 0 ? <p className={ui.hint}>Ti serve: {recipe.equipment.join(", ")}.</p> : null}
        <ol className={styles.stepsList}>
          {recipe.steps.map((s, i) => (
            <li key={i} className={styles.stepsItem}>
              <span>
                {s.text}
                {s.durationMinutes !== undefined ? <span className={styles.note}> ({formatMinutes(s.durationMinutes)})</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </Disclosure>

      <Disclosure title="Per porzione (stima)" summary={factsSummary}>
        <section className={styles.facts} aria-label="Valori per porzione">
          {!lookup ? (
            <p className={ui.hint}>Calcolo dei nutrienti…</p>
          ) : nutrient.length === 0 ? (
            <p className={ui.hint}>Non ho dati nutrizionali per questi ingredienti: non scrivo numeri inventati.</p>
          ) : (
            <>
              {energy ? (
                <p className={ui.lead}>
                  {energy.prefix}
                  <Value certainty="estimated">{energy.text}</Value>
                </p>
              ) : null}
              <dl className={styles.factGrid}>
                {nutrient
                  .filter((n) => n.key !== "energyKcal")
                  .map((n) => (
                    <div key={n.key}>
                      <dt>{n.label}</dt>
                      <dd>
                        {n.prefix}
                        <Value certainty="estimated">{n.text}</Value>
                      </dd>
                    </div>
                  ))}
              </dl>
              {facts.nutrition && coverageText(facts.nutrition.coverage) ? (
                <p className={ui.hint}>{coverageText(facts.nutrition.coverage)} I valori sono minimi: «almeno» dice che il vero valore può essere più alto.</p>
              ) : null}
              <p className={ui.hint}>
                Ingredienti letti allo stato crudo o secco, con i valori di una tabella generica. {NUTRITION_DISCLAIMER_SHORT}
              </p>
            </>
          )}
          <div>
            <Label>Costo per porzione</Label>
            {facts.cost && facts.cost.coverage.resolved > 0 ? (
              <>
                <p className={ui.lead}>
                  {costText(facts.cost).prefix}
                  <Value certainty="estimated">{costText(facts.cost).text}</Value>
                </p>
                {coverageText(facts.cost.coverage, "prezzi") ? <p className={ui.hint}>{coverageText(facts.cost.coverage, "prezzi")}</p> : null}
                <p className={ui.hint}>Stima dagli ultimi prezzi che hai pagato per gli stessi prodotti.</p>
              </>
            ) : (
              <p className={ui.hint}>Nessun prezzo noto: comparirà quando registri un acquisto, con il prezzo, di questi ingredienti.</p>
            )}
          </div>
        </section>
      </Disclosure>

      <Disclosure title="Le volte che l'hai cucinata" summary={cookedSummary(past?.times ?? 0, lastDay)}>
        {past ? (
          <>
            <p className={ui.lead}>{historyText(past)}</p>
            {countsText(past) ? <p className={ui.hint}>{countsText(past)}</p> : null}
            <DishRatingRow
              label="Com'era l'ultima volta?"
              value={{ ...(past.last.rating ? { rating: past.last.rating } : {}), ...(past.last.again ? { again: true } : {}) }}
              onChange={(v) => void rateLast(v)}
              disabled={busy}
            />
          </>
        ) : null}
        <div className={ui.field}>
          <h3 className={ui.fieldLabel}>Il tuo voto alla ricetta</h3>
          <div className={styles.rating} role="group" aria-label="Voto da 1 a 5">
            {[1, 2, 3, 4, 5].map((n) => (
              <button
                key={n}
                type="button"
                className={recipe.rating !== undefined && n <= recipe.rating ? styles.starOn : styles.star}
                aria-pressed={recipe.rating === n}
                aria-label={`${n} su 5`}
                disabled={busy}
                onClick={() => void rate(n)}
              >
                {recipe.rating !== undefined && n <= recipe.rating ? "★" : "☆"}
              </button>
            ))}
          </div>
        </div>
      </Disclosure>

      {recipe.origin?.url || recipe.origin?.author ? (
        <Disclosure title="Fonte" summary={source?.host ?? (recipe.origin?.author ? `di ${recipe.origin.author}` : undefined)}>
          <section className={styles.source} aria-label="Fonte">
            {recipe.origin?.author ? <span>di {recipe.origin.author}</span> : null}
            {source ? (
              <a className={styles.sourceLink} href={source.href} target="_blank" rel="noopener noreferrer">
                {source.host}
              </a>
            ) : recipe.origin?.url ? (
              <span>{recipe.origin.url}</span>
            ) : null}
          </section>
        </Disclosure>
      ) : null}

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {sheet === "plan" ? <PlanSheet recipeId={written.recipeId} title={written.title} servings={servings} onClose={() => setSheet(null)} /> : null}
      {sheet === "missing" ? <MissingSheet shortfalls={shortfalls} have={haveNames} onClose={() => setSheet(null)} /> : null}
    </div>
  );
}
