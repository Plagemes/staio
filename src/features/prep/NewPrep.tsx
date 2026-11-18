"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState, type FormEvent } from "react";
import type { AnyEvent } from "@/core/events";
import { LOCATIONS, activeLots, type Location } from "@/core/ledger";
import { compareWithPantry, stockFromLots, type Recipe, type Substitution } from "@/core/recipes";
import { usePantry, useRecipes } from "@/data";
import { Button, Label, Value } from "@/design";
import { formatCalendarDate, formatPrice, relativeDay, dayOf } from "../format";
import { LOCATION_LABELS } from "../labels";
import { evaluateLots, type PantryEntry } from "../lots";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import { NUTRITION_DISCLAIMER_SHORT } from "../nutrition/labels";
import { barcodesOfLots, buildResolver } from "../nutrition/resolver";
import { useFoodOverrides, useFoods, useProducts } from "../nutrition/useNutrition";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import { makeContextFor, makeLookup, nutrientLinesOf } from "../recipes/facts";
import { composeFromInput, nutrientsOfFrom, prepMessage, type PrepErrors, type PrepInput } from "./compose";
import { picksFromProposal, proposeFromRecipe, unmatchedText, type Unmatched } from "./fromRecipe";
import { IngredientPicker, type PickRow } from "./IngredientPicker";
import { SUBSTITUTION_PARAM, chosenText, missingIndices, parseSubstitutions } from "../recipes/substitutes";
import { useSubstitutes } from "../recipes/useSubstitutes";
import styles from "./prep.module.css";
import { useStartProposal } from "./startProposal";
import { resolvePrepSubstitutions } from "./substitution";

/** `/app/preparazioni/nuova`, con `?ricetta=ID&porzioni=N` per partire da una ricetta. */
export function NewPrep() {
  const params = useSearchParams();
  const recipeId = params.get("ricetta");
  const requested = Number(params.get("porzioni"));
  const pantry = usePantry();
  const recipes = useRecipes();
  const now = useNow();
  const foods = useFoods();
  const entries = useMemo(
    () => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []),
    [pantry.data, now],
  );

  if (pantry.error || recipes.error) return <StorageError />;
  if (!pantry.data || !recipes.data || !now || !foods) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Nuova preparazione</h1>
        <LoadingLine />
      </div>
    );
  }
  const recipe = recipeId ? recipes.data.recipes.find((r) => r.recipeId === recipeId) : undefined;
  if (recipeId && !recipe) {
    return (
      <div className={ui.screen}>
        <EmptyState
          title="Ricetta non trovata"
          text="Non trovo la ricetta da cui partire: potrebbe essere stata ritirata. Puoi comunque scegliere gli ingredienti a mano."
          actionLabel="Prepara senza ricetta"
          actionHref="/app/preparazioni/nuova"
          secondaryLabel="Vai al ricettario"
          secondaryHref="/app/ricette"
        />
      </div>
    );
  }
  const servings = recipe && Number.isFinite(requested) && requested > 0 ? requested : recipe?.servings;
  if (recipe && servings !== undefined) {
    const chosen = parseSubstitutions(params.getAll(SUBSTITUTION_PARAM), recipe.ingredients.length);
    return <Checked key={recipe.recipeId} recipe={recipe} chosen={chosen} servings={servings} entries={entries} now={now} />;
  }
  return <Form key="libera" recipe={undefined} substitutions={[]} unapplied={undefined} servings={undefined} entries={entries} now={now} />;
}

/**
 * Le sostituzioni dall'indirizzo valgono solo se sono tra le proposte già controllate per quell'ingrediente (stesso
 * controllo della scheda e della cottura): il resto si scarta con una riga. Il modulo parte dopo, perché calcola la proposta una volta.
 */
function Checked({
  recipe: written,
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
    const cmp = compareWithPantry(written, stockFromLots(entries.map((e) => e.lot)), { servings });
    return cmp.ok ? missingIndices(cmp.value) : [];
  }, [written, entries, servings]);
  const substitutes = useSubstitutes(written, missing);
  if (chosen.length > 0 && substitutes.status === "loading") {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Nuova preparazione</h1>
        <LoadingLine />
      </div>
    );
  }
  const { recipe, applied, unapplied } = resolvePrepSubstitutions(written, chosen, substitutes.options, { missing, failed: substitutes.failed });
  return <Form recipe={recipe} written={written} substitutions={applied} unapplied={unapplied} servings={servings} entries={entries} now={now} />;
}

interface FormProps {
  /** Come verrà preparata (con i sostituti scelti). */
  recipe: Recipe | undefined;
  /** Come è scritta, per dire cosa si è sostituito. */
  written?: Recipe;
  substitutions: Substitution[];
  unapplied: string | undefined;
  servings: number | undefined;
  entries: PantryEntry[];
  now: string;
}

function Form({ recipe, written, substitutions, unapplied, servings, entries, now }: FormProps) {
  const router = useRouter();
  const ids = useId();
  const foods = useFoods();
  const overrides = useFoodOverrides();
  const products = useProducts();
  const { recordWith, busy } = useRecord();

  /** Gli ingredienti come li ha lasciati l'utente; `null` finché non li tocca e vale la proposta. */
  const [editedPicks, setPicks] = useState<PickRow[] | null>(null);
  // La proposta si calcola all'apertura e si rifà con i dati che arrivano subito dopo (`useStartProposal`): le
  // correzioni dell'utente non vengono mai riscritte.
  const start = useStartProposal(
    () => {
      if (!recipe) return { picks: [] as PickRow[], unmatched: [] as Unmatched[] };
      const lookup = foods ? makeLookup(foods, overrides) : undefined;
      const proposal = proposeFromRecipe(recipe, entries.map((e) => e.lot), {
        ...(servings !== undefined ? { servings } : {}),
        ...(lookup ? { contextFor: makeContextFor(lookup) } : {}),
      });
      return { picks: picksFromProposal(proposal), unmatched: proposal.unmatched };
    },
    [recipe, entries, servings, foods, overrides],
    editedPicks !== null,
  );

  const [title, setTitle] = useState(recipe?.title ?? "");
  const [portionsText, setPortionsText] = useState(servings !== undefined ? String(Math.max(1, Math.round(servings))) : "");
  const [location, setLocation] = useState<Location>("frigo");
  const [shelfDaysText, setShelfDaysText] = useState("");
  const picks = editedPicks ?? start.picks;
  const [errors, setErrors] = useState<PrepErrors | null>(null);

  const byId = useMemo(() => new Map(entries.map((e) => [e.lot.lotId, e.lot])), [entries]);
  const input: PrepInput = {
    title,
    ...(recipe ? { recipeId: recipe.recipeId } : {}),
    portionsText,
    location,
    shelfDaysText,
    picks: picks.flatMap((p) => {
      const lot = byId.get(p.lotId);
      return lot ? [{ lot, quantityText: p.quantityText }] : [];
    }),
  };

  const resolver = useMemo(
    () =>
      foods
        ? buildResolver({
            foods,
            products: products ?? new Map(),
            barcodes: barcodesOfLots(entries.map((e) => e.lot)),
            overrides,
          })
        : undefined,
    [foods, products, entries, overrides],
  );
  const nutrientsOf = useMemo(() => (resolver ? nutrientsOfFrom(resolver) : undefined), [resolver]);

  // Anteprima: stessa composizione del salvataggio, con id e dispositivo di prova
  const preview = useMemo(
    () => composeFromInput(input, { now, deviceId: "anteprima", ...(nutrientsOf ? { nutrientsOf } : {}) }),
    // `input` si ricostruisce a ogni disegno: contano i suoi ingredienti
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [title, recipe, portionsText, location, shelfDaysText, picks, byId, now, nutrientsOf],
  );

  const set = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setErrors(null);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    let failed: PrepErrors | null = null;
    const result = await recordWith((deviceId) => {
      const composed = composeFromInput(input, { now: new Date().toISOString(), deviceId });
      if (!composed.ok) {
        failed = composed.errors;
        throw new Error("invalid");
      }
      return { events: composed.composed.events as AnyEvent[], message: prepMessage(title, Number(portionsText), location) };
    });
    if (result.ok) router.push("/app/preparazioni");
    else setErrors(failed ?? { picks: {}, general: result.error });
  }

  const expiry = preview.ok ? preview.composed.expiry : undefined;
  const cost = preview.ok ? preview.composed.cost : undefined;
  const nutrients = preview.ok ? preview.composed.nutrients : undefined;
  const lines = nutrients ? nutrientLinesOf(nutrients.perPortion) : [];
  const energy = lines.find((l) => l.key === "energyKcal");
  const today = dayOf(now);

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Nuova preparazione</h1>
        {recipe ? <Label>Da ricetta</Label> : null}
      </div>
      {recipe ? (
        <p className={ui.lead}>
          Parti da «{recipe.title}»: ho proposto dalla dispensa ciò che serve, prima ciò che scade. Controlla le quantità.
        </p>
      ) : (
        <p className={ui.lead}>Scegli gli ingredienti dalla dispensa, quante porzioni ottieni e dove le metti.</p>
      )}

      {substitutions.length > 0 && written ? (
        <p className={ui.hint}>
          Con le sostituzioni scelte nella ricetta: {substitutions.map((s) => chosenText(written.ingredients[s.index]?.name ?? "", s.name)).join("; ")}. Alla preparazione si scala il sostituto.
        </p>
      ) : null}
      {unapplied ? (
        <p className={ui.hint} role="note">
          {unapplied}
        </p>
      ) : null}

      {start.unmatched.length > 0 ? (
        <div className={ui.callout} role="note">
          <p className={ui.paragraph}>
            <strong>Non tutto è in dispensa.</strong> Non li ho proposti:
          </p>
          <ul className={ui.bullets}>
            {start.unmatched.map((u) => (
              <li key={u.index} className={ui.hint}>
                {unmatchedText(u)}
              </li>
            ))}
          </ul>
          <p className={ui.hint}>Se li hai usati lo stesso, aggiungili dalla dispensa qui sotto o registrali prima come acquisto.</p>
        </div>
      ) : null}

      <form className={ui.form} onSubmit={onSubmit} noValidate>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-title`}>
            Nome della preparazione
          </label>
          <input
            id={`${ids}-title`}
            className={ui.input}
            type="text"
            value={title}
            onChange={(e) => set(setTitle)(e.target.value)}
            autoComplete="off"
            aria-invalid={errors?.title ? true : undefined}
          />
          {errors?.title ? <p className={ui.error}>{errors.title}</p> : null}
        </div>

        <IngredientPicker entries={entries} picks={picks} onChange={set(setPicks)} errors={errors?.picks ?? {}} label="Ingredienti dalla dispensa" />
        {errors?.general ? (
          <p className={ui.error} role="alert">
            {errors.general}
          </p>
        ) : null}

        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-portions`}>
            Quante porzioni ottieni
          </label>
          <input
            id={`${ids}-portions`}
            className={ui.input}
            type="text"
            inputMode="numeric"
            value={portionsText}
            onChange={(e) => set(setPortionsText)(e.target.value)}
            autoComplete="off"
            aria-invalid={errors?.portions ? true : undefined}
          />
          {errors?.portions ? <p className={ui.error}>{errors.portions}</p> : null}
        </div>

        <fieldset className={ui.field}>
          <legend className={ui.fieldLabel}>Dove le metti</legend>
          <div className={ui.choices}>
            {LOCATIONS.map((l) => (
              <label key={l} className={ui.choice}>
                <input type="radio" name={`${ids}-loc`} value={l} checked={location === l} onChange={() => set(setLocation)(l)} />
                <span>{LOCATION_LABELS[l]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-days`}>
            Quanti giorni durano <span className={ui.optional}>(facoltativo)</span>
          </label>
          <input
            id={`${ids}-days`}
            className={ui.input}
            type="text"
            inputMode="numeric"
            value={shelfDaysText}
            onChange={(e) => set(setShelfDaysText)(e.target.value)}
            autoComplete="off"
            placeholder="Lascia vuoto per la stima"
            aria-invalid={errors?.shelfDays ? true : undefined}
          />
          {errors?.shelfDays ? <p className={ui.error}>{errors.shelfDays}</p> : null}
        </div>

        <section className={styles.preview} aria-label="Anteprima" aria-live="polite">
          <Label>Anteprima</Label>
          {!preview.ok ? (
            <p className={ui.hint}>Scegli ingredienti e porzioni e vedrai qui scadenza, costo e nutrienti per porzione.</p>
          ) : (
            <>
              <div className={styles.previewRow}>
                <span>Scadenza delle porzioni</span>
                <span>
                  {expiry ? (
                    <Value certainty="estimated">
                      {formatCalendarDate(expiry.date)} ({relativeDay(expiry.date, today)})
                    </Value>
                  ) : null}
                </span>
              </div>
              <p className={ui.hint}>
                {shelfDaysText.trim() !== ""
                  ? "Durata scelta da te, contata dal giorno di cottura."
                  : "Stima per cibo cotto in casa: dipende da come lo conservi. Se hai dubbi, fidati di vista e odore."}
              </p>
              <div className={styles.previewRow}>
                <span>Costo per porzione</span>
                <span>
                  {cost?.perPortionCents !== undefined ? (
                    <>
                      {cost.partial ? "almeno " : ""}
                      <Value certainty="estimated">{formatPrice(cost.perPortionCents)}</Value>
                    </>
                  ) : (
                    <Value certainty="untracked" />
                  )}
                </span>
              </div>
              {cost?.partial ? (
                <p className={ui.hint}>
                  Manca il prezzo di {cost.unknownLotIds.length === 1 ? "un ingrediente" : `${cost.unknownLotIds.length} ingredienti`}: il costo reale è più alto.
                </p>
              ) : null}
              {cost?.perPortionCents === undefined ? <p className={ui.hint}>Nessun ingrediente ha un prezzo registrato.</p> : null}
              <div className={styles.previewRow}>
                <span>Energia per porzione</span>
                <span>
                  {energy ? (
                    <>
                      {energy.prefix}
                      <Value certainty="estimated">{energy.text}</Value>
                    </>
                  ) : (
                    <Value certainty="untracked" />
                  )}
                </span>
              </div>
              {lines
                .filter((l) => l.key !== "energyKcal")
                .map((l) => (
                  <div key={l.key} className={styles.previewRow}>
                    <span>{l.label}</span>
                    <span>
                      {l.prefix}
                      <Value certainty="estimated">{l.text}</Value>
                    </span>
                  </div>
                ))}
              {nutrients && nutrients.notComputable.length > 0 ? (
                <p className={ui.hint}>
                  Per {nutrients.notComputable.length === 1 ? "un ingrediente" : `${nutrients.notComputable.length} ingredienti`} non ho i dati nutrizionali: i valori
                  sono minimi.
                </p>
              ) : null}
              <p className={ui.hint}>{NUTRITION_DISCLAIMER_SHORT}</p>
            </>
          )}
        </section>

        <Button type="submit" disabled={busy}>
          {busy ? "Salvo…" : "Salva la preparazione"}
        </Button>
        <p className={ui.hint}>Gli ingredienti escono dalla dispensa e le porzioni ci entrano. Con «Annulla» subito dopo torna tutto com&apos;era.</p>
      </form>

      <Link href="/app/preparazioni" className={ui.textLink}>
        Torna alle preparazioni
      </Link>
    </div>
  );
}
