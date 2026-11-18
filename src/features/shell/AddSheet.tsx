"use client";

// Il foglio del «+»: da qualunque schermata si dice che cosa è successo (ho mangiato, ho bevuto, ho comprato, mi manca
// una cosa) oppure si cerca. Un foglio solo, con i suoi passi: nessun passo ne apre un altro.

import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createWater, localMoment, type DiaryHabit } from "@/core/diary";
import type { AnyEvent } from "@/core/events";
import { DEFAULT_TIME_ZONE } from "@/core/expiry";
import { activeLots } from "@/core/ledger";
import { appendEvents, getDeviceId, useDiary, usePantry, usePlan, useRecipes } from "@/data";
import { Button, Label, cx } from "@/design";
import { buildUndo } from "../actions";
import { ActionList, Sheet, type ActionItem } from "../common";
import { formatMl } from "../health";
import { DrinkPresetChips, useDrinkActions } from "../health/Drinks";
import { evaluateLots } from "../lots";
import { useNotice } from "../notice";
import { useProducts } from "../nutrition/useNutrition";
import { makeLinkOf, pantryFoods } from "../recipes/allergenLinks";
import { NO_FILTERS, applyFilters, buildRows, confirmedRowText, pantryView, sortRows } from "../recipes/list";
import { useRecipePrefs, type RecipePrefs } from "../recipes/prefs";
import { unionDeclared } from "../recipes/safety";
import { useConfirmations } from "../recipes/useConfirmations";
import { SEARCH_PAGES } from "../search/pages";
import { SearchResults } from "../search/SearchResults";
import { isSearching, pantrySources, queryText, search, type SearchAction, type SearchSources } from "../search/searchIndex";
import { addManualEntries, type ManualInput } from "../shopping";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { useRecord } from "../useRecord";
import { drinkNoticeText, eatenHint, visitNoticeText } from "./addSheetText";
import { LoadingLine, StorageError } from "./EmptyState";
import styles from "./AddSheet.module.css";

type Step = "main" | "drinks" | "shopping" | "more";

const WATER_ML = 200;

const MORE_ITEMS: readonly ActionItem[] = [
  { id: "health", label: "Peso, umore, integratori", href: "/app/salute" },
  { id: "ideas", label: "Cosa cucinare", href: "/app/ricette/idee" },
  { id: "import", label: "Importa una ricetta", href: "/app/ricette/importa" },
  { id: "photo", label: "Foto del frigo", href: "/app/dispensa/foto" },
  { id: "ask", label: "Chiedi", href: "/app/assistente" },
  { id: "activity", label: "Ultime azioni", href: "/app/attivita" },
];

/** Le stesse parole che il ricettario mette sopra il suo elenco quando ci sono allergeni o esclusioni dichiarati (`recipes/Recipes.tsx`). */
const RECIPES_NOTE = "Quelle mostrate non hanno dato nessuna corrispondenza nei nomi: non vuol dire che siano sicure.";

/** Una voce messa in lista in questa visita del foglio, con ciò che serve per toglierla. */
interface AddedEntry {
  id: number;
  name: string;
  input: ManualInput;
  /** Rimette la lista com'era prima di questa aggiunta. */
  undo: () => Promise<void>;
}

/** Ciò che si è appena segnato da bere, e che ha già il suo avviso: come dirlo e gli eventi scritti. */
interface JustLogged {
  text: string;
  events: readonly AnyEvent[];
}

/* ------------------------------------------------------------------------------------------------
   La tastiera. Il foglio sta in fondo allo schermo e la tastiera gli passa sopra: senza un rimedio coprirebbe proprio
   i risultati della ricerca e l'elenco di ciò che si è appena aggiunto. Si misura quanta parte dello schermo occupa
   e in fondo al corpo si lascia altrettanto spazio: il foglio cresce verso l'alto e ciò che serve resta in vista.
   ------------------------------------------------------------------------------------------------ */

/** Sotto questa misura non è una tastiera: sono le barre del browser che compaiono e scompaiono. */
const KEYBOARD_MIN_PX = 120;

function subscribeToViewport(onChange: () => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  viewport.addEventListener("resize", onChange);
  return () => viewport.removeEventListener("resize", onChange);
}

/** L'altezza della tastiera: quanto la parte visibile è più bassa dello schermo dell'app. Zero dove non si può sapere. */
function keyboardInset(): number {
  const viewport = window.visualViewport;
  // con lo zoom delle dita la parte visibile si restringe senza che ci sia una tastiera
  if (!viewport || viewport.scale > 1.01) return 0;
  const covered = Math.round(window.innerHeight - viewport.height);
  return covered >= KEYBOARD_MIN_PX ? covered : 0;
}

function useKeyboardInset(): number {
  return useSyncExternalStore(subscribeToViewport, keyboardInset, () => 0);
}

/* ------------------------------------------------------------------------------------------------
   I dati della ricerca. Si leggono solo quando si comincia a scrivere.
   ------------------------------------------------------------------------------------------------ */

type RecipeSources = Pick<SearchSources, "recipes" | "recipesNote">;

const NO_RECIPES: RecipeSources = { recipes: [] };

/**
 * Le ricette che il ricettario mostra, con il suo stesso controllo: stesse funzioni, stessi dati (ciò che è dichiarato
 * nel ricettario e nel piano, dispensa, prodotti, conferme, attrezzatura). Finché uno di questi non è letto non c'è
 * nessuna ricetta: mai una ricetta che non è passata dal controllo.
 */
function useShownRecipes(lots: ReturnType<typeof activeLots> | undefined, now: string | null): RecipeSources {
  const recipes = useRecipes();
  const plan = usePlan();
  const products = useProducts();
  const { prefs, ready } = useRecipePrefs();
  const { byKey: confirmations } = useConfirmations();
  // le preferenze si rileggono a ogni disegno in un oggetto nuovo: conta il loro contenuto
  const prefsKey = JSON.stringify(prefs);
  const structure = plan.data?.structure;

  return useMemo(() => {
    if (!recipes.data || !plan.data || !lots || !now || !products || !ready || !confirmations) return NO_RECIPES;
    const declared = JSON.parse(prefsKey) as RecipePrefs;
    const allergens = unionDeclared(declared.allergens, structure?.allergens ?? []);
    const excludedFoods = unionDeclared(declared.excludedFoods, structure?.excludedFoods ?? []);
    const filtered = applyFilters(buildRows(recipes.data.recipes, pantryView(lots, now)), {
      ...NO_FILTERS,
      ...(declared.limitToEquipment ? { ownedEquipment: declared.ownedEquipment } : {}),
      allergens,
      excludedFoods,
      linkOf: makeLinkOf(pantryFoods(lots, products)),
      confirmations,
    });
    return {
      recipes: sortRows(filtered.rows, "title").map((row) => {
        const note = confirmedRowText(filtered.confirmedBy.get(row.recipe.recipeId) ?? []);
        return {
          id: row.recipe.recipeId,
          title: row.recipe.title,
          href: `/app/ricette/vedi?id=${encodeURIComponent(row.recipe.recipeId)}`,
          ...(note ? { note } : {}),
        };
      }),
      ...(allergens.length > 0 || excludedFoods.length > 0 ? { recipesNote: RECIPES_NOTE } : {}),
    };
  }, [recipes.data, plan.data, structure, lots, now, products, ready, confirmations, prefsKey]);
}

function SearchPanel({
  query,
  habits,
  disabled,
  onAction,
}: {
  query: string;
  habits: readonly DiaryHabit[] | undefined;
  disabled: boolean;
  onAction: (action: SearchAction) => void;
}) {
  const pantry = usePantry();
  const now = useNow();
  const lots = useMemo(() => (pantry.data ? activeLots(pantry.data) : undefined), [pantry.data]);
  const inHome = useMemo(() => (lots && now ? pantrySources(evaluateLots(lots, now)) : undefined), [lots, now]);
  const shownRecipes = useShownRecipes(lots, now);
  const groups = useMemo(() => {
    if (!inHome) return undefined;
    return search(query, {
      pantry: inHome,
      ...shownRecipes,
      habits: (habits ?? []).map((habit) => ({ habitId: habit.habitId, title: habit.title })),
      pages: SEARCH_PAGES,
    });
  }, [query, inHome, shownRecipes, habits]);

  if (pantry.error) return <StorageError />;
  if (!groups) return <LoadingLine />;
  return <SearchResults groups={groups} onAction={onAction} disabled={disabled} />;
}

/* ------------------------------------------------------------------------------------------------
   Il foglio
   ------------------------------------------------------------------------------------------------ */

export function AddSheet({ onClose }: { onClose: () => void }) {
  const notice = useNotice();
  const now = useNow();
  const diary = useDiary();
  const timeZone = diary.data?.timeZone ?? DEFAULT_TIME_ZONE;
  const { recordWith, busy: recording } = useRecord();
  const drinkActions = useDrinkActions(timeZone);
  const keyboard = useKeyboardInset();
  const ids = useId();

  const [step, setStep] = useState<Step>("main");
  const [query, setQuery] = useState("");
  const [item, setItem] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Ciò che è entrato in lista in questa visita. Il riferimento è la copia che leggono le azioni: lo stato arriva un disegno dopo. */
  const [added, setAdded] = useState<readonly AddedEntry[]>([]);
  const addedRef = useRef<readonly AddedEntry[]>([]);
  const [listBusy, setListBusy] = useState(false);
  const listBusyRef = useRef(false);
  const nextId = useRef(0);
  const closedRef = useRef(false);
  const itemRef = useRef<HTMLInputElement>(null);

  const busy = recording || drinkActions.busy || listBusy;

  // «Alla spesa» si apre per scrivere: qui, e solo qui, il campo prende il fuoco
  useEffect(() => {
    if (step === "shopping") itemRef.current?.focus();
  }, [step]);

  const commitAdded = (next: readonly AddedEntry[]) => {
    addedRef.current = next;
    setAdded(next);
  };

  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };

  /**
   * L'unica uscita. Se in questa visita qualcosa è entrato in lista lo dice adesso, a foglio chiuso, qualunque sia
   * stata la strada (anche «Chiudi» o il tasto indietro): l'avviso non nasce mai sotto il foglio.
   * `logged`: la bevanda appena segnata, che ha già mostrato il suo avviso. L'avviso in vista è uno solo: se c'è anche
   * la spesa prende il posto di quello della bevanda, quindi dice tutte e due le cose e il suo «Annulla» le annulla
   * entrambe, dall'ultima alla prima.
   */
  const close = (logged?: JustLogged) => {
    if (closedRef.current) return;
    closedRef.current = true;
    const list = addedRef.current;
    if (list.length > 0) {
      notice.show({
        message: visitNoticeText(
          list.map((entry) => entry.name),
          logged?.text,
        ),
        onUndo: async () => {
          if (logged) {
            const written = await appendEvents(buildUndo(logged.events, { now: new Date().toISOString(), deviceId: await getDeviceId() }));
            if (written.rejected.length > 0) throw new Error("undo rejected");
          }
          for (const entry of [...list].reverse()) await entry.undo();
        },
        link: { label: "Vedi", href: "/app/spesa" },
      });
    }
    onClose();
  };

  /** Una voce in lista, in una unità (si cambia poi nella lista). Falso se non è entrata. */
  async function addToShopping(text: string): Promise<boolean> {
    const name = queryText(text);
    if (name === "" || listBusyRef.current) return false;
    listBusyRef.current = true;
    setListBusy(true);
    setError(null);
    try {
      const input: ManualInput = { product: name, quantity: { value: 1, unit: "pz" } };
      const result = await addManualEntries([input]);
      if (result.added === 0) return false;
      nextId.current += 1;
      commitAdded([...addedRef.current, { id: nextId.current, name, input, undo: result.undo }]);
      return true;
    } catch {
      setError("Non sono riuscito ad aggiungerlo alla lista. Riprova.");
      return false;
    } finally {
      listBusyRef.current = false;
      setListBusy(false);
    }
  }

  /** Invio nel campo di «Alla spesa»: aggiunge e lascia il campo pronto. Vero se non resta niente da aggiungere. */
  async function submitItem(): Promise<boolean> {
    // un secondo Invio mentre il primo sta ancora scrivendo non fa niente: il campo non si tocca
    if (listBusyRef.current) return false;
    const text = item;
    if (queryText(text) === "") return true;
    setItem("");
    const ok = await addToShopping(text);
    // non è entrata: ciò che era scritto torna nel campo, se nel frattempo non si è scritto altro
    if (!ok) setItem((current) => (current === "" ? text : current));
    return ok;
  }

  /**
   * «Togli» su una voce aggiunta in questa visita. Ogni aggiunta sa solo rimettere la lista com'era prima di lei:
   * si torna indietro fino a questa voce, dall'ultima, e poi si rimettono quelle venute dopo.
   */
  async function removeAdded(id: number) {
    const list = addedRef.current;
    const at = list.findIndex((entry) => entry.id === id);
    if (at < 0 || listBusyRef.current) return;
    listBusyRef.current = true;
    setListBusy(true);
    setError(null);
    try {
      for (let i = list.length - 1; i >= at; i -= 1) await list[i].undo();
      let kept = list.slice(0, at);
      commitAdded(kept);
      for (const later of list.slice(at + 1)) {
        const result = await addManualEntries([later.input]);
        kept = [...kept, { ...later, undo: result.undo }];
        commitAdded(kept);
      }
    } catch {
      setError("Non sono riuscito a toglierlo dalla lista. Riprova.");
    } finally {
      listBusyRef.current = false;
      setListBusy(false);
    }
  }

  async function addWater() {
    setError(null);
    const message = `Aggiunta acqua: ${formatMl(WATER_ML)}.`;
    let events: AnyEvent[] = [];
    const result = await recordWith((deviceId) => {
      events = [createWater({ ml: WATER_ML }, { deviceId })];
      return { events, message };
    });
    if (result.ok) close({ text: message, events });
    else setError(result.error);
  }

  /** «Aggiungi “latte” alla spesa» dai risultati: aggiunge e chiude. L'altra azione è un collegamento. */
  const onSearchAction = (action: SearchAction) => {
    if (action !== "addToShopping") return;
    void addToShopping(query).then((ok) => {
      if (ok) close();
    });
  };

  const minutes = now ? localMoment(now, timeZone)?.minutes : undefined;
  const mainItems: ActionItem[] = [
    { id: "eaten", label: "Ho mangiato", ...(minutes !== undefined ? { hint: eatenHint(minutes) } : {}), href: "/app/pasto" },
    { id: "drunk", label: "Ho bevuto", hint: "acqua, caffè, tè…", onSelect: () => go("drinks") },
    { id: "bought", label: "Ho comprato", hint: "codice, scontrino, a mano", href: "/app/cattura" },
    { id: "shopping", label: "Alla spesa", hint: "scrivi che cosa manca", onSelect: () => go("shopping") },
  ];
  const moreItem: ActionItem[] = [{ id: "more", label: "Altro", onSelect: () => go("more") }];

  const searching = isSearching(query);
  const errorLine = error ? (
    <p className={ui.error} role="alert">
      {error}
    </p>
  ) : null;
  const back = (
    <Button variant="text" className={styles.back} disabled={busy} onClick={() => go("main")}>
      Indietro
    </Button>
  );

  let body: ReactNode;
  let footer: ReactNode;
  if (step === "main") {
    body = (
      <>
        <div>
          <label htmlFor={`${ids}-search`} className={ui.srOnly}>
            Cerca o scrivi
          </label>
          <input
            id={`${ids}-search`}
            type="search"
            className={ui.input}
            placeholder="Cerca o scrivi"
            autoComplete="off"
            enterKeyHint="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setError(null);
            }}
            // Invio non ha altro da fare: toglie la tastiera, e i risultati si vedono tutti
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
          />
        </div>
        {searching ? (
          <SearchPanel query={query} habits={diary.data?.habits} disabled={busy} onAction={onSearchAction} />
        ) : (
          <>
            <ActionList items={mainItems} />
            <ActionList items={moreItem} />
          </>
        )}
        {errorLine}
      </>
    );
  } else if (step === "drinks") {
    body = (
      <>
        <Label as="h3" className={styles.stepTitle}>
          Ho bevuto
        </Label>
        <Button variant="outline" disabled={busy} onClick={() => void addWater()}>
          Acqua +{formatMl(WATER_ML)}
        </Button>
        {/* un tocco segna e chiude: l'avviso non deve restare sotto il foglio */}
        <DrinkPresetChips actions={drinkActions} onError={setError} onAdded={(name, events) => close({ text: drinkNoticeText(name), events })} />
        {errorLine}
      </>
    );
    footer = back;
  } else if (step === "shopping") {
    body = (
      <>
        <Label as="h3" className={styles.stepTitle}>
          Alla spesa
        </Label>
        <form
          className={ui.field}
          onSubmit={(event) => {
            event.preventDefault();
            void submitItem();
          }}
        >
          <label className={ui.fieldLabel} htmlFor={`${ids}-item`}>
            Che cosa manca
          </label>
          <input
            ref={itemRef}
            id={`${ids}-item`}
            type="text"
            className={ui.input}
            autoComplete="off"
            enterKeyHint="done"
            value={item}
            onChange={(event) => {
              setItem(event.target.value);
              setError(null);
            }}
          />
        </form>
        {errorLine}
        {added.length > 0 ? (
          <ul className={cx(styles.added, ui.group)} aria-label="Aggiunti alla lista adesso">
            {added.map((entry) => (
              <li key={entry.id} className={styles.addedRow}>
                <span className={styles.addedName}>{entry.name}</span>
                <Button variant="text" disabled={busy} aria-label={`Togli ${entry.name}`} onClick={() => void removeAdded(entry.id)}>
                  Togli
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </>
    );
    footer = (
      <div className={styles.stepFooter}>
        {back}
        <Button
          className={styles.done}
          disabled={busy}
          onClick={() =>
            // ciò che è rimasto scritto nel campo entra in lista: non si perde per un Invio mancato
            void submitItem().then((ok) => {
              if (ok) close();
            })
          }
        >
          Fatto
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <Label as="h3" className={styles.stepTitle}>
          Altro
        </Label>
        <ActionList items={MORE_ITEMS} />
      </>
    );
    footer = back;
  }

  return (
    <Sheet title="Aggiungi" onClose={() => close()} busy={busy} footer={footer} onBack={step === "main" ? undefined : () => go("main")}>
      {body}
      {keyboard > 0 ? <div aria-hidden="true" style={{ height: keyboard }} /> : null}
    </Sheet>
  );
}
