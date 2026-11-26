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
  type TasteProfile,
  type Pairing,
  type PairingResult,
  type TasteFood,
  type TasteIndex,
  type TasteSubject,
} from "@/core/taste";
import { usePantry, useRecipes } from "@/data";
import { SectionHeader } from "@/design";
import { Disclosure } from "../common/Disclosure";
import { declaredLists, useDietDeclarations } from "../allergens";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import { useFoods, useProducts } from "../nutrition/useNutrition";
import { makeLinkOf, pantryFoods } from "../recipes/allergenLinks";
import { useDishHistory } from "../recipes/useDishHistory";
import { pantryView } from "../recipes/list";
import { IncompleteDeclarations } from "../recipes/SafetyPanel";
import recipeStyles from "../recipes/recipes.module.css";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import {
  TASTE_ORDER_NOTE,
  buildTasteProfile,
  dishesFromCookings,
  rankPairingsByTaste,
  tasteChangesOrder,
  tasteProfileView,
  type TasteItemView,
  cookedBasisText,
  cookedEmptyText,
  cookedView,
  daysText,
  doubtText,
  expiringPicks,
  hiddenText,
  homeSubjects,
  homeText,
  recipeSubjects,
  similarityText,
  supportText,
  togetherText,
  unknownText,
  type ExpiringFood,
  type FoodIdOf,
  type FoodNameOf,
  type CookedView,
} from "./logic";
import { useTasteData } from "./useTasteData";

const SET_LIMIT = 30;
const SOURCE_URL = "https://github.com/lamypark/FlavorGraph";
const MEANING = "Alimenti che nelle ricette e negli aromi stanno vicini a questo. A volte sono compagni, a volte sostituti.";

/** La scheda «Con cosa sta bene» di «Cosa cucinare»: senza titolo né schermata propria, li mette la pagina. */
export function PairingsPanel() {
  const params = useSearchParams();
  const recipeId = params.get("ricetta");
  const startFood = params.get("alimento") ?? "";
  const taste = useTasteData();
  const recipes = useRecipes();
  const pantry = usePantry();
  const diet = useDietDeclarations();
  const products = useProducts();
  const foods = useFoods();
  const now = useNow();

  const index = useMemo(() => (taste.status === "ready" ? createTasteIndex(taste.data) : undefined), [taste]);
  const foodIdOf = useMemo<FoodIdOf>(() => {
    const matcher = foods ? createFoodMatcher(foods) : undefined;
    return (name) => {
      const m = matcher?.match(name);
      // solo nomi uguali a meno di maiuscole, accenti e plurali: niente corrispondenze approssimate
      return m && m.confidence >= 0.95 ? m.food.id : undefined;
    };
  }, [foods]);

  const foodNameOf = useMemo<FoodNameOf>(() => {
    const names = new Map((foods ?? []).map((f) => [f.id, f.name]));
    return (id) => names.get(id);
  }, [foods]);

  const dishHistory = useDishHistory();
  const profile = useMemo<TasteProfile | undefined>(() => {
    if (!index || !recipes.data) return undefined;
    const { voted, cooked } = dishesFromCookings(
      dishHistory.cookings,
      [...recipes.data.recipes, ...recipes.data.archived],
      index,
      foodIdOf,
      foodNameOf,
    );
    return buildTasteProfile(voted, cooked);
  }, [index, recipes.data, dishHistory.cookings, foodIdOf, foodNameOf]);

  const lots = useMemo(() => (pantry.data ? activeLots(pantry.data) : []), [pantry.data]);
  const home = useMemo(() => homeSubjects(pantryFoods(lots, products), foodIdOf), [lots, products, foodIdOf]);
  const linkOf = useMemo(() => makeLinkOf(pantryFoods(lots, products)), [lots, products]);
  const expiring = useMemo(() => (now ? pantryView(lots, now).expiring : []), [lots, now]);

  const lists = useMemo(() => (diet.state ? declaredLists(diet.state) : undefined), [diet.state]);

  if (recipes.error || pantry.error || diet.error) return <StorageError />;
  if (taste.status === "error") {
    return (
      <>
        <div className={ui.calloutStrong} role="alert">
          Non riesco a caricare l&apos;elenco degli abbinamenti. Controlla la connessione e riprova.
        </div>
      </>
    );
  }
  if (!index || !recipes.data || !pantry.data || !lists || !diet.state || !products || !foods || !now || !profile || !dishHistory.ready) {
    return (
      <>
        <LoadingLine />
      </>
    );
  }

  const common: Common = {
    index,
    home,
    allergens: lists.allergens,
    excludedFoods: lists.excludedFoods,
    incomplete: !diet.state.complete,
    foodIdOf,
    foodNameOf,
    hasPantry: lots.length > 0,
    profile,
    linkOf,
  };
  if (recipeId) {
    const recipe = recipes.data.recipes.find((r) => r.recipeId === recipeId);
    if (!recipe) {
      return (
        <>
          <EmptyState
            title="Ricetta non trovata"
            text="Potrebbe essere stata ritirata o annullata. Puoi scegliere un ingrediente da solo."
            actionLabel="Scegli un ingrediente"
            actionHref="/app/ricette/abbinamenti"
            secondaryLabel="Torna al ricettario"
            secondaryHref="/app/ricette"
          />
        </>
      );
    }
    return <ForRecipe key={recipe.recipeId} recipe={recipe} {...common} />;
  }
  // `key` dal parametro: un altro `?alimento=` su una pagina rimasta viva riparte da quell'alimento
  return <ForIngredient key={startFood} {...common} expiring={expiring} recipes={recipes.data.recipes} startFood={startFood} />;
}

interface Common {
  index: TasteIndex;
  home: TasteSubject[];
  allergens: string[];
  excludedFoods: string[];
  /** Un posto delle dichiarazioni non si legge: si dice in testa. */
  incomplete: boolean;
  foodIdOf: FoodIdOf;
  foodNameOf: FoodNameOf;
  hasPantry: boolean;
  profile: TasteProfile;
  linkOf: ReturnType<typeof makeLinkOf>;
}

/** L'attribuzione richiesta dalla licenza dei dati: sempre in vista in fondo al pannello, mai dentro una riga richiusa. */
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

/** Le spiegazioni, richiuse sotto i risultati. */
function Meaning({ children }: { children?: string }) {
  return (
    <Disclosure title="Che cosa significa" quiet>
      <p className={ui.paragraph}>{MEANING}</p>
      {children ? <p className={ui.paragraph}>{children}</p> : null}
    </Disclosure>
  );
}

function ForRecipe({ recipe, index, home, allergens, excludedFoods, incomplete, foodIdOf, hasPantry, profile, linkOf }: Common & { recipe: Recipe }) {
  const result = useMemo(
    () => pairingsForSet(index, recipeSubjects(recipe, foodIdOf), { home, allergens, excludedFoods, limit: SET_LIMIT }),
    [index, recipe, foodIdOf, home, allergens, excludedFoods],
  );
  const declared = allergens.length > 0 || excludedFoods.length > 0;
  return (
    <>
      {incomplete ? <IncompleteDeclarations /> : null}
      <p className={ui.lead}>Con gli ingredienti di «{recipe.title}».</p>
      <YourTastes profile={profile} index={index} allergens={allergens} excludedFoods={excludedFoods} linkOf={linkOf} />
      <Results
        result={result}
        hasPantry={hasPantry}
        declared={declared}
        profile={profile}
        emptyHint="Nessun ingrediente di questa ricetta è nell'elenco degli abbinamenti."
      />
      <Meaning>Tra gli abbinamenti ti dico quali hai già in casa.</Meaning>
      <SourceNotice />
      <Link href={`/app/ricette/vedi?id=${encodeURIComponent(recipe.recipeId)}`} className={ui.textLink}>
        Torna alla ricetta
      </Link>
      <Link href="/app/ricette/abbinamenti" className={ui.textLink}>
        Scegli un ingrediente
      </Link>
    </>
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
  incomplete,
  foodIdOf,
  foodNameOf,
  hasPantry,
  profile,
  linkOf,
  expiring,
  recipes,
  startFood,
}: Common & { expiring: readonly ExpiringFood[]; recipes: readonly Recipe[]; startFood: string }) {
  const ids = useId();
  // `?alimento=` arriva dalla scheda di un alimento in dispensa: si parte già con quel nome cercato e il primo trovato scelto
  const start = useMemo(() => {
    const full = startFood.trim();
    if (full === "") return { query: "", food: undefined };
    const found = searchTasteFoods(index, full)[0];
    if (found) return { query: full, food: found };
    // un nome lungo come «Latte intero Brand» spesso non c'è tutto: si prova con la prima parola
    const firstWord = full.split(/\s+/)[0] ?? full;
    const byWord = searchTasteFoods(index, firstWord)[0];
    return byWord ? { query: firstWord, food: byWord } : { query: full, food: undefined };
  }, [index, startFood]);
  const [query, setQuery] = useState(start.query);
  const [pick, setPick] = useState<Pick | null>(start.food ? { kind: "food", key: start.food.key } : null);

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

  const pickedFood = pick?.kind === "food" ? index.byKey.get(pick.key) : undefined;
  const cooked = useMemo(
    () => (pickedFood ? cookedView(recipes, pickedFood, index, foodIdOf, foodNameOf, { allergens, excludedFoods }) : undefined),
    [pickedFood, recipes, index, foodIdOf, foodNameOf, allergens, excludedFoods],
  );

  const choose = (key: string) => setPick({ kind: "food", key });
  const chosenKey = pick?.kind === "food" ? pick.key : undefined;
  const typed = query.trim() !== "";
  const groupName = `${ids}-pick`;

  return (
    <>
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

      {incomplete ? <IncompleteDeclarations /> : null}

      <section className={ui.section}>
        <SectionHeader label="Parti da ciò che scade" />
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

      <YourTastes profile={profile} index={index} allergens={allergens} excludedFoods={excludedFoods} linkOf={linkOf} />

      {pickedFood && cooked ? <FromRecipes view={cooked} foodName={pickedFood.name} declared={declared} /> : null}

      {result ? (
        <Results
          result={result}
          hasPantry={hasPantry}
          declared={declared}
          profile={profile}
          emptyHint="Questo alimento non è nell'elenco degli abbinamenti."
        />
      ) : (
        <p className={ui.hint}>Scegli un alimento per vedere gli abbinamenti.</p>
      )}

      <Meaning>Scegli un alimento per vedere cosa gli sta bene vicino. Ti dico anche quali di questi hai già in casa.</Meaning>
      <SourceNotice />
      <Link href="/app/ricette" className={ui.textLink}>
        Torna al ricettario
      </Link>
    </>
  );
}

function TasteList({ title, items }: { title: string; items: readonly TasteItemView[] }) {
  if (items.length === 0) return null;
  return (
    <div className={ui.field}>
      <h3 className={ui.fieldLabel}>{title}</h3>
      <ul className={recipeStyles.list}>
        {items.map((i) => (
          <li key={i.label} className={recipeStyles.card}>
            <span className={recipeStyles.cardTitle}>{i.label}</span>
            <span className={recipeStyles.meta}>
              <span>{i.counts}</span>
            </span>
            {i.doubt ? <span className={recipeStyles.noteStrong}>{doubtText(i.doubt)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Dai voti dati dopo aver cucinato: cosa compare nei piatti votati bene e in quelli votati male. Sopra i dati generali. */
function YourTastes({
  profile,
  index,
  allergens,
  excludedFoods,
  linkOf,
}: {
  profile: TasteProfile;
  index: TasteIndex;
  allergens: string[];
  excludedFoods: string[];
  linkOf: ReturnType<typeof makeLinkOf>;
}) {
  const view = useMemo(
    () => tasteProfileView(profile, index, { allergens, excludedFoods, linkOf }),
    [profile, index, allergens, excludedFoods, linkOf],
  );
  const hidden = view.status === "ok" ? hiddenText(view.hiddenCount) : undefined;
  return (
    <section className={ui.section} aria-live="polite">
      <SectionHeader label="I tuoi gusti" />
      {view.status === "few" ? (
        <p className={ui.hint}>{view.text}</p>
      ) : (
        <>
          {view.empty ? <p className={ui.hint}>{view.empty}</p> : null}
          <TasteList title="Di solito ti piace" items={view.liked} />
          <TasteList title="Di solito no" items={view.disliked} />
          <TasteList title="In piatti buoni e cattivi" items={view.mixed} />
          <TasteList title="Coppie che di solito ti piacciono" items={view.likedPairs} />
          <TasteList title="Coppie che di solito no" items={view.dislikedPairs} />
          {view.often ? <p className={ui.hint}>{view.often}</p> : null}
          {hidden ? <p className={ui.hint}>{hidden}</p> : null}
          <p className={ui.hint}>{view.basis}</p>
        </>
      )}
    </section>
  );
}

function FromRecipes({ view, foodName, declared }: { view: CookedView; foodName: string; declared: boolean }) {
  const hidden = hiddenText(view.hiddenCount);
  return (
    <section className={ui.section} aria-live="polite">
      <SectionHeader label="Dalle tue ricette" />
      {view.pairs.length === 0 ? (
        <p className={ui.hint}>{cookedEmptyText(view, foodName)}</p>
      ) : (
        <>
          <ul className={recipeStyles.list}>
            {view.pairs.map((p) => (
              <li key={p.food.key} className={recipeStyles.card}>
                <span className={recipeStyles.cardTitle}>{p.food.name}</span>
                <span className={recipeStyles.meta}>
                  <span>{togetherText(p.together)}</span>
                </span>
                {p.doubt ? <span className={recipeStyles.noteStrong}>{doubtText(p.doubt)}</span> : null}
              </li>
            ))}
          </ul>
          {hidden ? <p className={ui.hint}>{hidden}</p> : null}
          {declared ? <p className={ui.hint}>{ALLERGEN_CHECK_NOTICE}</p> : null}
          <p className={ui.hint}>{cookedBasisText(view)}</p>
        </>
      )}
    </section>
  );
}

function Results({
  result,
  hasPantry,
  declared,
  profile,
  emptyHint,
}: {
  result: PairingResult;
  hasPantry: boolean;
  declared: boolean;
  profile: TasteProfile;
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
  // i gusti riordinano soltanto: nulla viene tolto, e il controllo allergeni è già passato
  const inHome = rankPairingsByTaste(result.pairings.filter((p) => p.inHome), profile, result.members);
  const others = rankPairingsByTaste(result.pairings.filter((p) => !p.inHome), profile, result.members);
  const ordered = tasteChangesOrder(result.pairings.filter((p) => p.inHome), profile, result.members) || tasteChangesOrder(result.pairings.filter((p) => !p.inHome), profile, result.members);
  const memberNames = result.members.map((m) => m.name).join(", ");
  const hidden = hiddenText(result.hiddenCount);
  const unknown = unknownText(result.unknown);
  const count = result.members.length;

  return (
    <section className={ui.section} aria-live="polite">
      <SectionHeader label={`Abbinamenti per: ${memberNames}`} />
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
      {ordered ? <p className={ui.hint}>{TASTE_ORDER_NOTE}</p> : null}
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
