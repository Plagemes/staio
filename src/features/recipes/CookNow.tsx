"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type FormEvent } from "react";
import type { MealKind } from "@/core/diary";
import { activeLots } from "@/core/ledger";
import { applySubstitutions, compareWithPantry, scaleRecipe, stockFromLots, type Quantity, type Recipe, type Substitution } from "@/core/recipes";
import { formatQuantity } from "@/core/units";
import { usePantry, useRecipes } from "@/data";
import { Button, Label } from "@/design";
import { evaluateLots, type PantryEntry } from "../lots";
import { MEAL_KIND_LABELS, MEAL_KIND_ORDER, buildMealEvents, suggestMealKind, type MealErrors } from "../meals";
import { useFoodOverrides, useFoods } from "../nutrition/useNutrition";
import { picksFromProposal, proposeFromRecipe, unmatchedText, type Unmatched } from "../prep/fromRecipe";
import { IngredientPicker, type PickRow } from "../prep/IngredientPicker";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import { makeContextFor, makeLookup } from "./facts";
import { FlagText, SafetyPanel } from "./SafetyPanel";
import { SUBSTITUTE_NOTICE, SUBSTITUTION_PARAM, chosenText, missingIndices, parseSubstitutions, recipeHref, unappliedNote, validSubstitutions } from "./substitutes";
import { useRecipeSafety } from "./useRecipeSafety";
import { useSubstitutes } from "./useSubstitutes";

interface FreeRow {
  id: number;
  name: string;
  quantityText: string;
  foodId?: string;
  use: boolean;
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
  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );

  if (recipes.error || pantry.error) return <StorageError />;
  if (!recipes.data || !pantry.data || !now || !foods) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Registra il pasto</h1>
        <LoadingLine />
      </div>
    );
  }
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
  return <Checked key={recipe.recipeId} recipe={recipe} chosen={chosen} servings={servings} entries={entries} now={now} />;
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
}: {
  recipe: Recipe;
  chosen: Substitution[];
  servings: number;
  entries: PantryEntry[];
  now: string;
}) {
  const missing = useMemo(() => {
    const cmp = compareWithPantry(recipe, stockFromLots(entries.map((e) => e.lot)), { servings });
    return cmp.ok ? missingIndices(cmp.value) : [];
  }, [recipe, entries, servings]);
  const substitutes = useSubstitutes(recipe, missing);
  const substitutions = useMemo(() => validSubstitutions(chosen, substitutes.options), [chosen, substitutes.options]);
  if (chosen.length > 0 && substitutes.status === "loading") {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Registra il pasto</h1>
        <LoadingLine />
      </div>
    );
  }
  const unapplied = unappliedNote(chosen, substitutions, { missing, failed: substitutes.failed, originalName: (i) => recipe.ingredients[i]?.name ?? "" });
  return <Form recipe={recipe} substitutions={substitutions} unapplied={unapplied} servings={servings} entries={entries} now={now} />;
}

function Form({
  recipe: written,
  substitutions,
  unapplied,
  servings,
  entries,
  now,
}: {
  recipe: Recipe;
  substitutions: Substitution[];
  unapplied: string | undefined;
  servings: number;
  entries: PantryEntry[];
  now: string;
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

  // Calcolata una volta, alla prima apertura: le correzioni dell'utente non vengono mai riscritte.
  const [start] = useState(() => {
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
  });

  const [picks, setPicks] = useState<PickRow[]>(start.picks);
  const [free, setFree] = useState<FreeRow[]>(start.free);
  const [kind, setKind] = useState<MealKind | null>(null);
  const [errors, setErrors] = useState<MealErrors | null>(null);
  const effectiveKind = kind ?? suggestMealKind(now);
  const byId = useMemo(() => new Map(entries.map((e) => [e.lot.lotId, e.lot])), [entries]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    let failed: MealErrors | null = null;
    const used = free.filter((f) => f.use);
    const result = await recordWith((deviceId) => {
      const built = buildMealEvents(
        {
          kind: effectiveKind,
          title: recipe.title,
          picks: picks.flatMap((p) => {
            const lot = byId.get(p.lotId);
            return lot ? [{ lot, choice: { kind: "text" as const, text: p.quantityText } }] : [];
          }),
          freeItems: used.map((f) => ({ name: f.name, quantityText: f.quantityText, ...(f.foodId ? { foodId: f.foodId } : {}) })),
        },
        { now: new Date().toISOString(), deviceId },
      );
      if (!built.ok) {
        failed = built.errors;
        throw new Error("invalid");
      }
      return { events: built.events, message: built.message };
    });
    if (result.ok) router.push("/app");
    else setErrors(failed ?? { picks: {}, free: {}, general: result.error });
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Registra il pasto</h1>
        <Label>{MEAL_KIND_LABELS[effectiveKind]}</Label>
      </div>
      <p className={ui.lead}>
        «{recipe.title}» per {servings === 1 ? "1 porzione" : `${servings} porzioni`}, mangiate adesso. Ho proposto dalla dispensa ciò che serve, prima ciò che scade: controlla le quantità.
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

        <Button type="submit" disabled={busy}>
          {busy ? "Salvo…" : "Registra il pasto"}
        </Button>
        <p className={ui.hint}>
          Se ne cucini di più per i giorni dopo, usa invece «Preparane più porzioni»: le porzioni restano in dispensa con la loro scadenza.
        </p>
      </form>

      <Link href={recipeHref("/app/ricette/vedi", written.recipeId, substitutions)} className={ui.textLink}>
        Torna alla ricetta
      </Link>
    </div>
  );
}
