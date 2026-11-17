"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { activeLots } from "@/core/ledger";
import { applySubstitutions, compareWithPantry, scaleRecipe, stockFromLots, totalMinutes, type Recipe, type Substitution } from "@/core/recipes";
import { formatQuantity } from "@/core/units";
import { buildPriceBook } from "@/core/shopping";
import { usePantry, useRecipes } from "@/data";
import { Button, Label, Value } from "@/design";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import { NUTRITION_DISCLAIMER_SHORT } from "../nutrition/labels";
import { useFoodOverrides, useFoods } from "../nutrition/useNutrition";
import { useNotice } from "../notice";
import ui from "../ui.module.css";
import { useRecord } from "../useRecord";
import { formatMinutes, formatServings, safeSourceUrl } from "./common";
import { computeFacts, costText, coverageText, makeContextFor, makeLookup, nutrientLines } from "./facts";
import { availabilityLabel, pendingConfirmations, shortfallsWith, type Answers } from "./list";
import { PairingsRow } from "./PairingsRow";
import { rateRecipe, retireRecipe } from "./model";
import { FlagText, SafetyPanel } from "./SafetyPanel";
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
import { addToShoppingListWithUndo, proposalFromShortfalls } from "./shopping";

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
  // chi torna dalla modalità cucina ritrova le sostituzioni scelte
  const chosen = parseSubstitutions(params.getAll(SUBSTITUTION_PARAM), recipe.ingredients.length);
  return <Detail key={recipe.recipeId} recipe={recipe} initialSubstitutions={chosen} />;
}

function Detail({ recipe: written, initialSubstitutions }: { recipe: Recipe; initialSubstitutions: Substitution[] }) {
  const pantry = usePantry();
  const foods = useFoods();
  const overrides = useFoodOverrides();
  const router = useRouter();
  const notice = useNotice();
  const { recordWith, busy } = useRecord();
  const ids = useId();
  const [servingsText, setServingsText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cooking, setCooking] = useState(false);
  const [answers, setAnswers] = useState<Answers>({});

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
  const nutrient = facts.nutrition ? nutrientLines(facts.nutrition) : [];
  const energy = nutrient.find((n) => n.key === "energyKcal");

  async function addMissing() {
    if (!comparison) return;
    setError(null);
    const proposal = proposalFromShortfalls(shortfalls);
    try {
      const r = await addToShoppingListWithUndo(proposal.entries);
      if (r.added === 0) {
        notice.show({ message: "Niente da aggiungere." });
        return;
      }
      const voci = `${r.added} ${r.added === 1 ? "voce" : "voci"}`;
      const senza =
        r.withoutQuantity > 0
          ? ` ${r.withoutQuantity === 1 ? "Una è entrata" : `${r.withoutQuantity} sono entrate`} senza quantità («q.b.»).`
          : "";
      notice.show({ message: `Aggiunte alla lista della spesa: ${voci}.${senza}`, onUndo: r.undo });
    } catch {
      setError("Non sono riuscito ad aggiungere alla lista della spesa. Riprova.");
    }
  }

  async function rate(value: number) {
    const next = recipe.rating === value ? undefined : value;
    const r = await recordWith((deviceId) => {
      const res = rateRecipe(written, next, { now: new Date().toISOString(), deviceId });
      if (!res.ok) throw new Error(res.error);
      return { events: [res.event], message: next === undefined ? "Voto tolto." : `Voto: ${next} su 5.` };
    });
    if (!r.ok) setError(r.error);
  }

  async function retire() {
    const r = await recordWith((deviceId) => {
      const res = retireRecipe(written, { now: new Date().toISOString(), deviceId });
      if (!res.ok) throw new Error(res.error);
      return { events: [res.event], message: `«${recipe.title}» è stata ritirata dal ricettario.` };
    });
    if (r.ok) router.push("/app/ricette");
    else setError(r.error);
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <Link href="/app/ricette" className={ui.textLink}>
          Ricettario
        </Link>
        {recipe.rating !== undefined ? <Label>{"★".repeat(recipe.rating)}</Label> : null}
      </div>

      <header className={ui.section}>
        <h1 className={ui.title}>{recipe.title}</h1>
        <p className={styles.heroMeta}>
          <span>{formatServings(recipe.servings)}</span>
          {minutes !== undefined ? <span>{formatMinutes(minutes)}</span> : null}
          {recipe.equipment.length > 0 ? <span>{recipe.equipment.join(", ")}</span> : null}
        </p>
        {recipe.tags.length > 0 ? <p className={styles.note}>{recipe.tags.join(" · ")}</p> : null}
      </header>

      <div className={styles.actions}>
        <Button onClick={() => setCooking(true)}>Cucinala ora</Button>
        <Button href={`/app/ricette/nuova?modifica=${encodeURIComponent(recipe.recipeId)}`} variant="outline">
          Modifica
        </Button>
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

      <PairingsRow recipe={written} lots={lots} foods={foods} safety={safetyState} />

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
        {pending > 0 ? (
          <p className={ui.hint}>
            {pending === 1 ? "Un ingrediente è da confermare" : `${pending} ingredienti sono da confermare`}: finché non rispondi non lo conto tra quelli che hai né tra quelli che mancano.
          </p>
        ) : null}
        {comparison && comparison.items.some((x) => x.check === "presence" && x.status === "available" && x.needed) ? (
          <p className={ui.hint}>Dove scrivo «in casa» senza quantità, l&apos;unità non si confronta con la dispensa: ho controllato solo che ci sia.</p>
        ) : null}
        <div className={ui.row}>
          <Button variant="outline" onClick={() => void addMissing()} disabled={missingCount === 0}>
            {missingCount === 0 ? "Hai tutto in casa" : `Aggiungi ciò che manca alla spesa (${missingCount})`}
          </Button>
          <Link href="/app/spesa" className={ui.textLink}>
            Apri la spesa
          </Link>
        </div>
      </section>

      <section className={ui.section} aria-labelledby={`${ids}-steps`}>
        <h2 id={`${ids}-steps`} className={ui.fieldLabel}>
          Passi
        </h2>
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
      </section>

      <section className={styles.facts} aria-labelledby={`${ids}-facts`}>
        <h2 id={`${ids}-facts`} className={ui.fieldLabel}>
          Per porzione <span className={ui.optional}>(stima)</span>
        </h2>
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

      <section className={ui.section} aria-labelledby={`${ids}-rate`}>
        <h2 id={`${ids}-rate`} className={ui.fieldLabel}>
          Il tuo voto
        </h2>
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
      </section>

      {recipe.origin?.url || recipe.origin?.author ? (
        <section className={styles.source} aria-label="Fonte">
          <Label>Fonte</Label>
          {recipe.origin?.author ? <span>di {recipe.origin.author}</span> : null}
          {source ? (
            <a className={styles.sourceLink} href={source.href} target="_blank" rel="noopener noreferrer">
              {source.host}
            </a>
          ) : recipe.origin?.url ? (
            <span>{recipe.origin.url}</span>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={ui.row}>
        <button type="button" className={ui.danger} onClick={() => void retire()} disabled={busy}>
          Ritira dal ricettario
        </button>
      </div>
      <p className={ui.hint}>La ricetta ritirata resta nel registro e si può rimettere dall&apos;elenco, o con «Annulla» subito dopo.</p>

      {cooking ? <CookChoice recipeId={recipe.recipeId} servings={servings} substitutions={substitutions} onClose={() => setCooking(false)} /> : null}
    </div>
  );
}

function CookChoice({
  recipeId,
  servings,
  substitutions,
  onClose,
}: {
  recipeId: string;
  servings: number;
  substitutions: readonly Substitution[];
  onClose: () => void;
}) {
  const id = encodeURIComponent(recipeId);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={styles.sheet}
      aria-labelledby={titleId}
      onClose={(e) => {
        if (!e.currentTarget.open) onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) ref.current?.close();
      }}
    >
      <div className={styles.sheetBody}>
        <h2 id={titleId} className={styles.sheetTitle}>
          Cucinala ora
        </h2>
        <Link className={styles.option} href={recipeHref("/app/ricette/cucina", recipeId, substitutions, servings)}>
          <span className={styles.optionTitle}>Segui i passi</span>
          <span className={styles.optionText}>Un passo alla volta, con caratteri grandi e i timer.</span>
        </Link>
        <Link className={styles.option} href={recipeHref("/app/ricette/cucinata", recipeId, substitutions, servings)}>
          <span className={styles.optionTitle}>Registra il pasto</span>
          <span className={styles.optionText}>Scegli cosa togli dalla dispensa e segna il pasto.</span>
        </Link>
        <Link className={styles.option} href={`/app/preparazioni/nuova?ricetta=${id}&porzioni=${servings}`}>
          <span className={styles.optionTitle}>Preparane più porzioni</span>
          <span className={styles.optionText}>Cucini una volta e conservi le porzioni in frigo o in freezer.</span>
        </Link>
        <Button variant="text" onClick={() => ref.current?.close()}>
          Chiudi
        </Button>
      </div>
    </dialog>
  );
}
