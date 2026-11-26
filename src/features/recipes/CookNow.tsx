"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useRef, useState, type FormEvent } from "react";
import type { MealKind } from "@/core/diary";
import { activeLots, type Lot } from "@/core/ledger";
import { portionsExpiry } from "@/core/prep";
import { applySubstitutions, compareWithPantry, scaleRecipe, stockFromLots, type Quantity, type Recipe, type Substitution } from "@/core/recipes";
import { formatQuantity } from "@/core/units";
import { getPantry, usePantry, useRecipes } from "@/data";
import { Button } from "@/design";
import { ActionBar, Disclosure } from "../common";
import { useFormEpoch } from "../common/freshForm";
import { dayOf } from "../format";
import { evaluateLots, type PantryEntry } from "../lots";
import { dayMonth } from "../plan/dates";
import { MEAL_KIND_LABELS, MEAL_KIND_ORDER, buildMealEvents, suggestMealKind, type MealErrors } from "../meals";
import { useFoodOverrides, useFoods } from "../nutrition/useNutrition";
import { picksFromProposal, proposeFromRecipe, unmatchedText, type Unmatched } from "../prep/fromRecipe";
import { IngredientPicker, type PickRow } from "../prep/IngredientPicker";
import { useStartProposal } from "../prep/startProposal";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import { DishRatingRow } from "./DishRatingRow";
import { dishRatingEvent, type DishVote } from "./dishRating";
import { clearCookSessionOf } from "./cookSession";
import { LEFTOVER_PLACES, NEEDS_PANTRY_ITEM, leftoverEvents, leftoverSummary, shortageText, type LeftoverPlace } from "./leftovers";
import { makeContextFor, makeLookup } from "./facts";
import { FlagText, SafetyPanel } from "./SafetyPanel";
import { SUBSTITUTE_NOTICE, SUBSTITUTION_PARAM, chosenText, missingIndices, parseSubstitutions, recipeHref, unappliedNote, validSubstitutions } from "./substitutes";
import { useRecipeSafety } from "./useRecipeSafety";
import { useSubstitutes } from "./useSubstitutes";
import styles from "./recipes.module.css";

interface FreeRow {
  id: number;
  name: string;
  quantityText: string;
  foodId?: string;
  use: boolean;
}

/** Mentre si carica il titolo è già quello definitivo («Registra pranzo»), senza passare da un altro: prima dell'ora non c'è titolo. */
function Loading({ now }: { now: string | null }) {
  return (
    <div className={ui.screen}>
      {now ? <h1 className={ui.title}>{`Registra ${MEAL_KIND_LABELS[suggestMealKind(now)].toLowerCase()}`}</h1> : null}
      <LoadingLine />
    </div>
  );
}

/** `/app/ricette/cucinata?id=…&porzioni=…`: ciò che hai usato per cucinare la ricetta, registrato come pasto. */
export function CookNow() {
  const params = useSearchParams();
  const id = params.get("id");
  const requested = Number(params.get("porzioni"));
  const recipes = useRecipes();
  const pantry = usePantry();
  const now = useNow();
  const foods = useFoods();
  // dopo il salvataggio il modulo riparte da zero: tornando indietro non si registra due volte
  const { epoch, renew } = useFormEpoch(params.toString());
  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );

  if (recipes.error || pantry.error) return <StorageError />;
  if (!recipes.data || !pantry.data || !now || !foods) return <Loading now={now} />;
  const recipe = id ? recipes.data.recipes.find((r) => r.recipeId === id) : undefined;
  if (!recipe) {
    return (
      <div className={ui.screen}>
        <EmptyState title="Ricetta non trovata" text="Torna al ricettario e scegline un'altra." actionLabel="Torna al ricettario" actionHref="/app/ricette" />
      </div>
    );
  }
  const servings = Number.isFinite(requested) && requested > 0 && requested <= 1000 ? requested : recipe.servings;
  const chosen = parseSubstitutions(params.getAll(SUBSTITUTION_PARAM), recipe.ingredients.length);
  return <Checked key={`${recipe.recipeId}|${epoch}`} recipe={recipe} chosen={chosen} servings={servings} entries={entries} now={now} onSaved={renew} />;
}

/**
 * Le sostituzioni dall'indirizzo valgono solo se sono tra le proposte già controllate per quell'ingrediente (stesso
 * controllo della scheda): il resto si scarta in silenzio. Il modulo parte solo dopo, perché calcola la proposta una volta.
 */
function Checked({
  recipe,
  chosen,
  servings,
  entries,
  now,
  onSaved,
}: {
  recipe: Recipe;
  chosen: Substitution[];
  servings: number;
  entries: PantryEntry[];
  now: string;
  onSaved: () => void;
}) {
  const missing = useMemo(() => {
    const cmp = compareWithPantry(recipe, stockFromLots(entries.map((e) => e.lot)), { servings });
    return cmp.ok ? missingIndices(cmp.value) : [];
  }, [recipe, entries, servings]);
  const substitutes = useSubstitutes(recipe, missing);
  const substitutions = useMemo(() => validSubstitutions(chosen, substitutes.options), [chosen, substitutes.options]);
  if (chosen.length > 0 && substitutes.status === "loading") return <Loading now={now} />;
  const unapplied = unappliedNote(chosen, substitutions, { missing, failed: substitutes.failed, originalName: (i) => recipe.ingredients[i]?.name ?? "" });
  return <Form recipe={recipe} substitutions={substitutions} unapplied={unapplied} servings={servings} entries={entries} now={now} onSaved={onSaved} />;
}

function Form({
  recipe: written,
  substitutions,
  unapplied,
  servings,
  entries,
  now,
  onSaved,
}: {
  recipe: Recipe;
  substitutions: Substitution[];
  unapplied: string | undefined;
  servings: number;
  entries: PantryEntry[];
  now: string;
  onSaved: () => void;
}) {
  const router = useRouter();
  const ids = useId();
  const foods = useFoods();
  const overrides = useFoodOverrides();
  const { recordWith, busy } = useRecord();
  // Con una sostituzione scelta si scala il sostituto e non l'originale: la ricetta come verrà cucinata sostituisce
  // il nome dell'ingrediente, e dispensa, quantità e controllo allergeni la leggono così.
  const recipe = useMemo(() => applySubstitutions(written, substitutions), [written, substitutions]);
  const safety = useRecipeSafety(recipe);

  /** Ingredienti e voci a mano come li ha lasciati l'utente; `null` finché non li tocca e vale la proposta. */
  const [editedPicks, setPicks] = useState<PickRow[] | null>(null);
  const [editedFree, setEditedFree] = useState<FreeRow[] | null>(null);
  // Calcolata all'apertura e rifatta con i dati che arrivano subito dopo (`useStartProposal`): le correzioni
  // dell'utente non vengono mai riscritte.
  const start = useStartProposal(() => {
    const lookup = foods ? makeLookup(foods, overrides) : undefined;
    const proposal = proposeFromRecipe(recipe, entries.map((e) => e.lot), {
      servings,
      ...(lookup ? { contextFor: makeContextFor(lookup) } : {}),
    });
    const scaled = scaleRecipe(recipe, servings);
    const ingredients = scaled.ok ? scaled.value.ingredients : recipe.ingredients;
    // gli ingredienti con una quantità che non sono in dispensa (o non del tutto) diventano voci a mano, stimate
    const free: FreeRow[] = proposal.unmatched
      .filter((u) => u.reason !== "no_quantity" && ingredients[u.index]?.quantity)
      .map((u, i) => {
        const ing = ingredients[u.index];
        return {
          id: i,
          name: ing.name,
          quantityText: formatQuantity((u.shortfall ?? ing.quantity) as Quantity),
          ...(ing.foodId ? { foodId: ing.foodId } : {}),
          use: true,
        };
      });
    return { picks: picksFromProposal(proposal), unmatched: proposal.unmatched as Unmatched[], free };
  }, [recipe, entries, servings, foods, overrides], editedPicks !== null || editedFree !== null);

  const picks = editedPicks ?? start.picks;
  const free = editedFree ?? start.free;
  const setFree = (change: (rows: FreeRow[]) => FreeRow[]) => setEditedFree((rows) => change(rows ?? start.free));
  const [kind, setKind] = useState<MealKind | null>(null);
  const [errors, setErrors] = useState<MealErrors | null>(null);
  const [vote, setVote] = useState<DishVote>({});
  const effectiveKind = kind ?? suggestMealKind(now);

  // gli avanzi: K porzioni mangiate adesso su N cotte, le altre in frigo o in freezer, tutto in una scrittura
  const [leftoverOpen, setLeftoverOpen] = useState(false);
  const [eaten, setEaten] = useState(1);
  const [place, setPlace] = useState<LeftoverPlace>("frigo");
  const [submitting, setSubmitting] = useState(false);
  // un secondo tocco prima che il disegno si aggiorni non deve scrivere due volte
  const inFlight = useRef(false);
  const whole = Number.isInteger(servings) && servings >= 2;
  const canKeep = whole && picks.length > 0;
  const keepLeftovers = canKeep && leftoverOpen;
  const kept = servings - eaten;
  const expiryDate = useMemo(() => {
    try {
      return portionsExpiry({ location: place, cookedOn: dayOf(now) }).date;
    } catch {
      return undefined;
    }
  }, [place, now]);

  async function onSubmit(event?: FormEvent) {
    event?.preventDefault();
    if (busy || submitting || inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setErrors(null);
    try {
      // la dispensa si rilegge dall'archivio: un lotto può essere cambiato dopo che la schermata si è aperta
      const fresh = await getPantry();
      const lotsNow = new Map<string, Lot>(fresh.lots.map((l) => [l.lotId, l]));
      const gone: Record<string, string> = {};
      const pickLots = picks.flatMap((p) => {
        const lot = lotsNow.get(p.lotId);
        if (!lot || lot.remaining <= 0) {
          gone[p.lotId] = "Di questo alimento non resta niente: toglilo dall'elenco.";
          return [];
        }
        return [{ lot, quantityText: p.quantityText }];
      });
      if (Object.keys(gone).length > 0) {
        setErrors({ picks: gone, free: {} });
        return;
      }
      const used = free.filter((f) => f.use).map((f) => ({ name: f.name, quantityText: f.quantityText, ...(f.foodId ? { foodId: f.foodId } : {}) }));
      const outcome: { errors?: MealErrors } = {};
      const result = await recordWith((deviceId) => {
        const ctx = { now: new Date().toISOString(), deviceId };
        if (keepLeftovers) {
          const r = leftoverEvents({ kind: effectiveKind, recipeId: written.recipeId, title: recipe.title, servings, eaten, place, picks: pickLots, freeItems: used, vote }, ctx);
          if (!r.ok) {
            outcome.errors = r.errors;
            throw new Error("invalid");
          }
          return { events: r.events, message: r.message };
        }
        const built = buildMealEvents(
          { kind: effectiveKind, title: recipe.title, picks: pickLots.map((p) => ({ lot: p.lot, choice: { kind: "text" as const, text: p.quantityText } })), freeItems: used },
          ctx,
        );
        if (!built.ok) {
          outcome.errors = { ...built.errors, picks: Object.fromEntries(Object.entries(built.errors.picks).map(([id, text]) => [id, shortageText(text)])) };
          throw new Error("invalid");
        }
        // il pasto è sempre legato alla ricetta: così conta come «cucinata», col voto se l'hai dato
        const meal = built.events.find((e) => e.type === "meal");
        const rated = meal && "mealId" in meal ? dishRatingEvent(meal.mealId, written.recipeId, vote, ctx) : undefined;
        return { events: rated?.ok ? [...built.events, rated.event] : built.events, message: built.message };
      });
      if (result.ok) {
        // la cottura è registrata: la sessione di cucina non serve più
        await clearCookSessionOf(written.recipeId);
        onSaved();
        router.push("/app");
      } else setErrors(outcome.errors ?? { picks: {}, free: {}, general: result.error });
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  }

  const busyNow = busy || submitting;
  const buttonText = `Registra ${MEAL_KIND_LABELS[effectiveKind].toLowerCase()}`;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>{buttonText}</h1>
      </div>
      <p className={ui.lead}>
        «{recipe.title}», {servings === 1 ? "1 porzione" : `${servings} porzioni`}. Ho proposto dalla dispensa ciò che serve, prima ciò che scade: controlla le quantità.
      </p>

      {substitutions.length > 0 ? (
        <p className={ui.hint}>
          Per questa cottura: {substitutions.map((s) => chosenText(written.ingredients[s.index]?.name ?? "", s.name)).join("; ")}, nella stessa quantità
          (cambiala qui sotto). {SUBSTITUTE_NOTICE}
        </p>
      ) : null}

      {unapplied ? (
        <p className={ui.hint} role="status">
          {unapplied}
        </p>
      ) : null}

      <SafetyPanel state={safety} />

      <form className={ui.form} onSubmit={onSubmit} noValidate>
        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Che pasto è</legend>
          <div className={ui.choices}>
            {MEAL_KIND_ORDER.map((k) => (
              <label key={k} className={ui.choice}>
                <input
                  type="radio"
                  name={`${ids}-kind`}
                  value={k}
                  checked={effectiveKind === k}
                  onChange={() => {
                    setKind(k);
                    setErrors(null);
                  }}
                />
                <span>{MEAL_KIND_LABELS[k]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <IngredientPicker
          entries={entries}
          picks={picks}
          onChange={(p) => {
            setPicks(p);
            setErrors(null);
          }}
          errors={errors?.picks ?? {}}
        />

        {free.length > 0 ? (
          <section className={ui.field} aria-labelledby={`${ids}-free`}>
            <h2 className={ui.fieldLabel} id={`${ids}-free`}>
              Non in dispensa
            </h2>
            <p className={ui.hint}>Le segno come voci a mano: non scalano la dispensa e valgono come stime.</p>
            {free.map((row) => {
              const usedIndex = free.filter((f) => f.use).findIndex((f) => f.id === row.id);
              return (
              <div key={row.id} className={ui.field}>
                <label className={ui.switch}>
                  <input
                    type="checkbox"
                    checked={row.use}
                    onChange={(e) => setFree((rows) => rows.map((r) => (r.id === row.id ? { ...r, use: e.target.checked } : r)))}
                  />
                  <span className={ui.switchText}>{row.name}</span>
                  {safety.status === "ready" ? <FlagText flag={safety.flags.get(recipe.ingredients.findIndex((x) => x.name === row.name))} /> : null}
                </label>
                {row.use ? (
                  <input
                    className={ui.input}
                    type="text"
                    value={row.quantityText}
                    onChange={(e) => setFree((rows) => rows.map((r) => (r.id === row.id ? { ...r, quantityText: e.target.value } : r)))}
                    aria-label={`Quantità di ${row.name}`}
                    autoComplete="off"
                  />
                ) : null}
                {errors?.free[usedIndex] ? <p className={ui.error}>{errors.free[usedIndex]}</p> : null}
              </div>
              );
            })}
          </section>
        ) : null}

        {start.unmatched.some((u) => u.reason === "no_quantity") ? (
          <p className={ui.hint}>
            Senza quantità, non registrati: {start.unmatched.filter((u) => u.reason === "no_quantity").map((u) => unmatchedText(u).split(":")[0]).join(", ")}.
          </p>
        ) : null}

        {errors?.general ? (
          <p className={ui.error} role="alert">
            {errors.general}
          </p>
        ) : null}

        {whole ? (
          canKeep ? (
            <Disclosure title="È avanzato qualcosa?" summary={leftoverSummary(leftoverOpen, kept, place)} open={leftoverOpen} onOpenChange={(open) => {
              setLeftoverOpen(open);
              if (open) setEaten(1);
            }}>
              <div className={ui.form}>
                <div className={ui.field}>
                  <label className={ui.fieldLabel} htmlFor={`${ids}-eaten`}>
                    Porzioni mangiate adesso
                  </label>
                  <div className={styles.servings}>
                    <button type="button" className={styles.step} aria-label="Una porzione in meno" disabled={eaten <= 1} onClick={() => setEaten((n) => Math.max(1, n - 1))}>
                      −
                    </button>
                    <input
                      id={`${ids}-eaten`}
                      className={`${ui.input} ${styles.servingsInput}`}
                      inputMode="numeric"
                      value={String(eaten)}
                      onChange={(e) => {
                        const n = Math.round(Number(e.target.value.replace(",", ".")));
                        if (Number.isFinite(n)) setEaten(Math.min(servings - 1, Math.max(1, n)));
                      }}
                    />
                    <button type="button" className={styles.step} aria-label="Una porzione in più" disabled={eaten >= servings - 1} onClick={() => setEaten((n) => Math.min(servings - 1, n + 1))}>
                      +
                    </button>
                  </div>
                  <p className={ui.hint}>Su {servings} cotte: {kept === 1 ? "1 resta" : `${kept} restano`}.</p>
                </div>
                <fieldset className={ui.field}>
                  <legend className={ui.fieldLabel}>Le altre vanno in</legend>
                  <div className={ui.choices}>
                    {LEFTOVER_PLACES.map((p) => (
                      <label key={p.id} className={ui.choice}>
                        <input type="radio" name={`${ids}-place`} value={p.id} checked={place === p.id} onChange={() => setPlace(p.id)} />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                {expiryDate ? <p className={ui.hint}>Si conservano fino al {dayMonth(expiryDate)} (stima).</p> : null}
              </div>
            </Disclosure>
          ) : (
            <div className={ui.field}>
              <h2 className={ui.fieldLabel}>È avanzato qualcosa?</h2>
              <p className={ui.hint}>{NEEDS_PANTRY_ITEM}</p>
            </div>
          )
        ) : null}

        <DishRatingRow value={vote} onChange={setVote} disabled={busyNow} />
        <p className={ui.hint}>Si salta: la ritrovi nella scheda della ricetta e la puoi cambiare quando vuoi.</p>
      </form>

      <Link href={recipeHref("/app/ricette/vedi", written.recipeId, substitutions, servings)} className={ui.textLink}>
        Torna alla ricetta
      </Link>

      <ActionBar>
        <Button disabled={busyNow} onClick={() => void onSubmit()}>
          {busyNow ? "Salvo…" : buttonText}
        </Button>
      </ActionBar>
    </div>
  );
}
