"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { ALLERGEN_CHECK_NOTICE } from "@/core/allergens";
import { activeLots } from "@/core/ledger";
import { createFoodMatcher } from "@/core/nutrition";
import type { Recipe } from "@/core/recipes";
import {
  createTasteIndex,
  pairingsForSet,
  searchTasteFoods,
  type Pairing,
  type PairingResult,
  type TasteFood,
  type TasteIndex,
  type TasteSubject,
} from "@/core/taste";
import { usePantry, usePlan, useRecipes } from "@/data";
import { Label } from "@/design";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import { useFoods, useProducts } from "../nutrition/useNutrition";
import { pantryFoods } from "../recipes/allergenLinks";
import { pantryView } from "../recipes/list";
import { useRecipePrefs } from "../recipes/prefs";
import { unionDeclared } from "../recipes/safety";
import recipeStyles from "../recipes/recipes.module.css";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import {
  daysText,
  doubtText,
  expiringPicks,
  hiddenText,
  homeSubjects,
  homeText,
  recipeSubjects,
  similarityText,
  supportText,
  unknownText,
  type ExpiringFood,
  type FoodIdOf,
} from "./logic";
import { useTasteData } from "./useTasteData";

const SET_LIMIT = 30;
const SOURCE_URL = "https://github.com/lamypark/FlavorGraph";
const MEANING = "Alimenti che nelle ricette e negli aromi stanno vicini a questo. A volte sono compagni, a volte sostituti.";

export function Pairings() {
  const recipeId = useSearchParams().get("ricetta");
  const taste = useTasteData();
  const recipes = useRecipes();
  const pantry = usePantry();
  const plan = usePlan();
  const products = useProducts();
  const foods = useFoods();
  const now = useNow();
  const { prefs, ready } = useRecipePrefs();

  const index = useMemo(() => (taste.status === "ready" ? createTasteIndex(taste.data) : undefined), [taste]);
  const foodIdOf = useMemo<FoodIdOf>(() => {
    const matcher = foods ? createFoodMatcher(foods) : undefined;
    return (name) => {
      const m = matcher?.match(name);
      // solo nomi uguali a meno di maiuscole, accenti e plurali: niente corrispondenze approssimate
      return m && m.confidence >= 0.95 ? m.food.id : undefined;
    };
  }, [foods]);

  const lots = useMemo(() => (pantry.data ? activeLots(pantry.data) : []), [pantry.data]);
  const home = useMemo(() => homeSubjects(pantryFoods(lots, products), foodIdOf), [lots, products, foodIdOf]);
  const expiring = useMemo(() => (now ? pantryView(lots, now).expiring : []), [lots, now]);

  const planAllergens = plan.data?.structure?.allergens;
  const planExcluded = plan.data?.structure?.excludedFoods;
  const allergens = useMemo(() => unionDeclared(prefs.allergens, planAllergens ?? []), [prefs.allergens, planAllergens]);
  const excludedFoods = useMemo(() => unionDeclared(prefs.excludedFoods, planExcluded ?? []), [prefs.excludedFoods, planExcluded]);

  if (recipes.error || pantry.error || plan.error) return <StorageError />;
  if (taste.status === "error") {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Abbinamenti di gusto</h1>
        <div className={ui.calloutStrong} role="alert">
          Non riesco a caricare l&apos;elenco degli abbinamenti. Controlla la connessione e riprova.
        </div>
      </div>
    );
  }
  if (!index || !recipes.data || !pantry.data || !plan.data || !products || !foods || !now || !ready) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Abbinamenti di gusto</h1>
        <LoadingLine />
      </div>
    );
  }

  const common: Common = { index, home, allergens, excludedFoods, foodIdOf, hasPantry: lots.length > 0 };
  if (recipeId) {
    const recipe = recipes.data.recipes.find((r) => r.recipeId === recipeId);
    if (!recipe) {
      return (
        <div className={ui.screen}>
          <EmptyState
            title="Ricetta non trovata"
            text="Potrebbe essere stata ritirata o annullata. Puoi scegliere un ingrediente da solo."
            actionLabel="Scegli un ingrediente"
            actionHref="/app/ricette/abbinamenti"
            secondaryLabel="Vai al ricettario"
            secondaryHref="/app/ricette"
          />
        </div>
      );
    }
    return <ForRecipe key={recipe.recipeId} recipe={recipe} {...common} />;
  }
  return <ForIngredient {...common} expiring={expiring} />;
}

interface Common {
  index: TasteIndex;
  home: TasteSubject[];
  allergens: string[];
  excludedFoods: string[];
  foodIdOf: FoodIdOf;
  hasPantry: boolean;
}

function SourceNotice() {
  return (
    <p className={ui.hint}>
      Abbinamenti da{" "}
      <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer" className={ui.textLink}>
        FlavorGraph
      </a>{" "}
      (Park e altri, Scientific Reports, 2021), dati CC BY-NC-SA 3.0 derivati da FlavorDB e Recipe1M, solo per uso non
      commerciale.
    </p>
  );
}

function ForRecipe({ recipe, index, home, allergens, excludedFoods, foodIdOf, hasPantry }: Common & { recipe: Recipe }) {
  const result = useMemo(
    () => pairingsForSet(index, recipeSubjects(recipe, foodIdOf), { home, allergens, excludedFoods, limit: SET_LIMIT }),
    [index, recipe, foodIdOf, home, allergens, excludedFoods],
  );
  const declared = allergens.length > 0 || excludedFoods.length > 0;
  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Cosa ci starebbe bene</h1>
        <Label>Abbinamenti</Label>
      </div>
      <p className={ui.lead}>{MEANING}</p>
      <p className={ui.lead}>
        Con gli ingredienti di «{recipe.title}». Tra gli abbinamenti ti dico quali hai già in casa.
      </p>
      <SourceNotice />
      <Results
        result={result}
        hasPantry={hasPantry}
        declared={declared}
        emptyHint="Nessun ingrediente di questa ricetta è nell'elenco degli abbinamenti."
      />
      <Link href={`/app/ricette/vedi?id=${encodeURIComponent(recipe.recipeId)}`} className={ui.textLink}>
        Torna alla ricetta
      </Link>
      <Link href="/app/ricette/abbinamenti" className={ui.textLink}>
        Scegli un ingrediente
      </Link>
    </div>
  );
}

type Pick = { kind: "food"; key: string } | { kind: "expiring" };

const subjectOfFood = (food: TasteFood): TasteSubject => ({
  name: food.name,
  ...(food.foodIds[0] ? { foodId: food.foodIds[0] } : {}),
});

function ForIngredient({
  index,
  home,
  allergens,
  excludedFoods,
  foodIdOf,
  hasPantry,
  expiring,
}: Common & { expiring: readonly ExpiringFood[] }) {
  const ids = useId();
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<Pick | null>(null);

  const candidates = useMemo(() => searchTasteFoods(index, query), [index, query]);
  const expiringInfo = useMemo(() => expiringPicks(index, expiring, foodIdOf), [index, expiring, foodIdOf]);
  const declared = allergens.length > 0 || excludedFoods.length > 0;

  const result = useMemo<PairingResult | undefined>(() => {
    if (!pick) return undefined;
    const options = { home, allergens, excludedFoods };
    if (pick.kind === "food") {
      const food = index.byKey.get(pick.key);
      return food ? pairingsForSet(index, [subjectOfFood(food)], options) : undefined;
    }
    return pairingsForSet(index, expiringInfo.picks.map((p) => subjectOfFood(p.food)), { ...options, limit: SET_LIMIT });
  }, [pick, index, home, allergens, excludedFoods, expiringInfo.picks]);

  const choose = (key: string) => setPick({ kind: "food", key });
  const chosenKey = pick?.kind === "food" ? pick.key : undefined;
  const typed = query.trim() !== "";
  const groupName = `${ids}-pick`;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Abbinamenti di gusto</h1>
        <Label>Ricettario</Label>
      </div>
      <p className={ui.lead}>{MEANING}</p>
      <p className={ui.lead}>
        Scegli un alimento per vedere cosa gli sta bene vicino. Ti dico anche quali di questi hai già in casa.
      </p>
      <SourceNotice />

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-q`}>
          Cerca un ingrediente
        </label>
        <input
          id={`${ids}-q`}
          className={ui.input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Per esempio pomodoro"
          autoComplete="off"
        />
        {typed && candidates.length > 0 ? (
          <div className={recipeStyles.chips} role="radiogroup" aria-label="Ingredienti trovati">
            {candidates.map((f) => (
              <label key={f.key} className={recipeStyles.chip}>
                <input type="radio" name={groupName} checked={chosenKey === f.key} onChange={() => choose(f.key)} />
                <span>{f.name}</span>
              </label>
            ))}
          </div>
        ) : null}
        {typed && candidates.length === 0 ? (
          <p className={ui.hint} role="status">
            «{query.trim()}» non è nell&apos;elenco degli alimenti di cui conosco gli abbinamenti. Non ne invento: prova con un
            altro nome.
          </p>
        ) : null}
        {!typed ? (
          <p className={ui.hint}>
            L&apos;elenco ha {index.data.foods.length} alimenti: scrivi le prime lettere per trovarli.
          </p>
        ) : null}
      </div>

      <section className={ui.field} aria-labelledby={`${ids}-exp`}>
        <h2 id={`${ids}-exp`} className={ui.fieldLabel}>
          Parti da ciò che scade
        </h2>
        {!hasPantry ? (
          <p className={ui.hint}>
            La dispensa è vuota: non ho niente da cui partire. Aggiungi ciò che hai comprato e qui comparirà ciò che scade.
          </p>
        ) : expiringInfo.picks.length === 0 && expiringInfo.notInList.length === 0 ? (
          <p className={ui.hint}>Niente in dispensa sta per scadere.</p>
        ) : (
          <>
            {expiringInfo.picks.length > 0 ? (
              <div className={recipeStyles.chips} role="radiogroup" aria-label="Alimenti in scadenza">
                {expiringInfo.picks.map((p) => (
                  <label key={p.food.key} className={recipeStyles.chip}>
                    <input type="radio" name={groupName} checked={chosenKey === p.food.key} onChange={() => choose(p.food.key)} />
                    <span>
                      {p.food.name} · {daysText(p.daysLeft)}
                    </span>
                  </label>
                ))}
                {expiringInfo.picks.length > 1 ? (
                  <label className={recipeStyles.chip}>
                    <input
                      type="radio"
                      name={groupName}
                      checked={pick?.kind === "expiring"}
                      onChange={() => setPick({ kind: "expiring" })}
                    />
                    <span>Tutti insieme</span>
                  </label>
                ) : null}
              </div>
            ) : (
              <p className={ui.hint}>Ciò che scade non è nell&apos;elenco degli abbinamenti.</p>
            )}
            {expiringInfo.notInList.length > 0 ? (
              <p className={ui.hint}>Non sono nell&apos;elenco degli abbinamenti: {expiringInfo.notInList.join(", ")}.</p>
            ) : null}
          </>
        )}
      </section>

      {result ? (
        <Results
          result={result}
          hasPantry={hasPantry}
          declared={declared}
          emptyHint="Questo alimento non è nell'elenco degli abbinamenti."
        />
      ) : (
        <p className={ui.hint}>Scegli un alimento per vedere gli abbinamenti.</p>
      )}

      <Link href="/app/ricette" className={ui.textLink}>
        Torna al ricettario
      </Link>
    </div>
  );
}

function Results({
  result,
  hasPantry,
  declared,
  emptyHint,
}: {
  result: PairingResult;
  hasPantry: boolean;
  declared: boolean;
  emptyHint: string;
}) {
  if (result.status === "not_in_list") {
    const unknown = unknownText(result.unknown);
    return (
      <div className={ui.empty}>
        <h2 className={ui.emptyTitle}>Non in elenco</h2>
        <p className={ui.emptyText}>{emptyHint}</p>
        {unknown ? <p className={ui.hint}>{unknown}</p> : null}
        <p className={ui.hint}>{result.basis.text}</p>
      </div>
    );
  }
  const inHome = result.pairings.filter((p) => p.inHome);
  const others = result.pairings.filter((p) => !p.inHome);
  const memberNames = result.members.map((m) => m.name).join(", ");
  const hidden = hiddenText(result.hiddenCount);
  const unknown = unknownText(result.unknown);
  const count = result.members.length;

  return (
    <section className={ui.section} aria-live="polite">
      <h2 className={ui.fieldLabel}>Abbinamenti per: {memberNames}</h2>
      {unknown ? <p className={ui.hint}>{unknown}</p> : null}
      {result.pairings.length === 0 ? (
        <div className={ui.empty}>
          <h3 className={ui.emptyTitle}>Nessun abbinamento da mostrare</h3>
          <p className={ui.emptyText}>
            {result.hiddenCount > 0
              ? "Quelli che conosco contengono un allergene o un alimento che hai escluso."
              : "Per questo alimento l'elenco non ha abbinamenti."}
          </p>
        </div>
      ) : (
        <>
          <div className={ui.field}>
            <h3 className={ui.fieldLabel}>Ce l&apos;hai in casa ({inHome.length})</h3>
            {inHome.length > 0 ? (
              <PairingList items={inHome} memberCount={count} />
            ) : (
              <p className={ui.hint}>
                {hasPantry
                  ? "Nessuno di questi abbinamenti è tra ciò che hai in dispensa."
                  : "La dispensa è vuota: non posso dire cosa hai già in casa."}
              </p>
            )}
            {result.homeNotInList > 0 ? (
              <p className={ui.hint}>
                {result.homeNotInList === 1
                  ? "1 alimento della dispensa non è nell'elenco: per quello non so dire se si abbina."
                  : `${result.homeNotInList} alimenti della dispensa non sono nell'elenco: per quelli non so dire se si abbinano.`}
              </p>
            ) : null}
          </div>
          {others.length > 0 ? (
            <div className={ui.field}>
              <h3 className={ui.fieldLabel}>Altri abbinamenti ({others.length})</h3>
              <PairingList items={others} memberCount={count} />
            </div>
          ) : null}
        </>
      )}
      {hidden ? <p className={ui.hint}>{hidden}</p> : null}
      {declared ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}
      <p className={ui.hint}>{result.basis.text}</p>
    </section>
  );
}

function PairingList({ items, memberCount }: { items: readonly Pairing[]; memberCount: number }) {
  return (
    <ul className={recipeStyles.list}>
      {items.map((p) => {
        const support = supportText(p, memberCount);
        return (
          <li key={p.food.key} className={recipeStyles.card}>
            <span className={recipeStyles.cardTitle}>{p.food.name}</span>
            <span className={recipeStyles.meta}>
              <span>{similarityText(p.score)}</span>
            </span>
            {p.inHome ? <span className={recipeStyles.noteAccent}>{homeText(p)}</span> : null}
            {support ? <span className={recipeStyles.note}>{support}</span> : null}
            {p.doubt ? <span className={recipeStyles.noteStrong}>{doubtText(p.doubt)}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}
