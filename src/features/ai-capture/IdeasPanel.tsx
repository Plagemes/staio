"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { isAiError } from "@/core/ai";
import {
  checkIdeas,
  expiringText,
  type CheckedIdea,
  type CheckedIngredient,
  type CheckedPantryRef,
  type IdeaCriteria,
  type IngredientStatus,
} from "@/core/ai/recipeIdeasCheck";
import { ALLERGEN_CHECK_NOTICE, type ConfirmationMap, type ItemSubject } from "@/core/allergens";
import { isStoredProduct } from "@/core/catalog";
import { activeLots } from "@/core/ledger";
import { totalMinutes } from "@/core/recipes";
import { formatQuantity } from "@/core/units";
import { appendEvents, getDeviceId, getProductRecord, usePantry, useRecipes } from "@/data";
import { Button, SectionHeader } from "@/design";
import { DIET_HREF, declaredLists, readDietDeclarations, useDietDeclarations } from "../allergens";
import { dayOf } from "../format";
import { describeAiError } from "../ai/messages";
import { PROVIDER_LABELS } from "../ai/providers/types";
import { activeModel, configIssue, dexieSettingsStore, type AiSettings, type ConfigIssue } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import { evaluateLots } from "../lots";
import { useNotice } from "../notice";
import { makeLinkOf, pantryFoods } from "../recipes/allergenLinks";
import { formatMinutes, formatServings, ingredientLine, splitList } from "../recipes/common";
import {
  applyFilters,
  buildRows,
  confirmedRowText,
  countsText,
  expiringText as rowExpiringText,
  hiddenText,
  missingText,
  pantryView,
  type RecipeRow,
} from "../recipes/list";
import { SAVE_LABELS, pairHref } from "../pantry/saveActions";
import { useProducts } from "../nutrition/useNutrition";
import { useRecipePrefs, type RecipePrefs } from "../recipes/prefs";
import recipeStyles from "../recipes/recipes.module.css";
import { CONFIRMATION_NOTICE, IncompleteDeclarations } from "../recipes/SafetyPanel";
import { confirmButtonText, confirmedText } from "../recipes/safety";
import { useConfirmationActions, useConfirmations } from "../recipes/useConfirmations";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { ReadInfo, SendNotice } from "./AiNotices";
import styles from "./AiCapture.module.css";
import { recipeEventFromIdea } from "./ideaRecipe";
import { FOOD_PARAM, cookHref, declaredCoveredBy, foodFirst, ideasFoodFirst, parseFood, rowsUsing, sameFood, savedForExpiring } from "./ideasFood";
import { toPantryTarget, type PantryTarget } from "./pantryRefs";
import { readRecipeIdeas, type IdeasOutcome } from "./reads";

const TIME_OPTIONS = [0, 15, 30, 45, 60, 90];
const HONEST_LINE =
  "Sono proposte generate da un modello: leggile con giudizio, soprattutto per cotture e conservazione (carne, pesce, uova, avanzi). Le controlli tu prima di cucinarle.";
const SETTINGS_AI_HREF = "/app/impostazioni/ai";
const DECLARED_CHANGED = "Allergeni o esclusioni sono cambiati da quando hai chiesto le idee. Chiedi di nuovo le proposte.";

/**
 * La scheda «Idee» di «Cosa cucinare». Senza titolo né schermata propria: li mette la pagina. `?alimento=Nome` (Oggi, scheda di
 * un lotto) fa partire dalle ricette salvate che usano quell'alimento; senza chiave l'elenco c'è lo stesso.
 */
export function IdeasPanel() {
  // dall'indirizzo a ogni disegno: la pagina resta viva tra una visita e l'altra
  const food = parseFood(useSearchParams().get(FOOD_PARAM));
  const { settings, ready } = useAiSettings();
  if (!ready) {
    return (
      <>
        <LoadingLine text="Un attimo…" />
      </>
    );
  }
  const issue = configIssue(settings);
  // senza chiave le ricette salvate servono lo stesso: non hanno bisogno del modello
  if (issue !== null) return <SavedIdeas food={food} issue={issue} />;
  return <Loader settings={settings} food={food} />;
}

/** I dati che servono per elencare le ricette salvate con lo stesso controllo del ricettario. */
function useSavedContext() {
  const recipes = useRecipes();
  const pantry = usePantry();
  const diet = useDietDeclarations();
  const products = useProducts();
  const now = useNow();
  const { byKey: confirmations } = useConfirmations();
  const lots = useMemo(() => (pantry.data ? activeLots(pantry.data) : []), [pantry.data]);
  const view = useMemo(() => (pantry.data && now ? pantryView(lots, now) : undefined), [pantry.data, now, lots]);
  const lists = useMemo(() => (diet.state ? declaredLists(diet.state) : undefined), [diet.state]);
  const linkOf = useMemo(() => makeLinkOf(pantryFoods(lots, products)), [lots, products]);
  const failed = Boolean(recipes.error || pantry.error || diet.error);
  return { recipes, diet, products, view, lists, linkOf, confirmations, failed };
}

/** Il punto di partenza: l'alimento scelto e le ricette salvate che lo usano. */
function FoodStart({ food }: { food: string }) {
  const { recipes, diet, products, view, lists, linkOf, confirmations, failed } = useSavedContext();
  // stesso controllo del ricettario: una ricetta con un allergene o un alimento escluso non compare, e si dice quante
  const found = useMemo(() => {
    // come il ricettario: senza i prodotti il controllo non ha le etichette, e si aspetta
    if (!recipes.data || !view || !confirmations || !lists || !products) return undefined;
    const rows = rowsUsing(buildRows(recipes.data.recipes, view), food);
    return applyFilters(rows, { query: "", tags: [], allergens: lists.allergens, excludedFoods: lists.excludedFoods, linkOf, confirmations });
  }, [recipes.data, view, confirmations, lists, products, food, linkOf]);

  return (
    <>
      <section className={ui.section}>
        <SectionHeader label="Si parte da" />
        <p className={ui.paragraph}>
          <strong>«{food}»</strong>{" "}
          <Link href="/app/ricette/idee" className={ui.textLink}>
            Senza un alimento
          </Link>
        </p>
      </section>

      <section className={ui.section}>
        <SectionHeader label="Le tue ricette salvate" />
        {diet.state && !diet.state.complete ? <IncompleteDeclarations /> : null}
        {failed ? (
          <p className={ui.error} role="alert">
            Non riesco a leggere il ricettario. Riprova.
          </p>
        ) : !found ? (
          <LoadingLine />
        ) : found.rows.length === 0 ? (
          <p className={ui.paragraph}>Nessuna ricetta salvata usa «{food}»{found.hidden > 0 ? `, tra quelle che puoi usare (${hiddenText(found)})` : ""}.</p>
        ) : (
          <>
            <p className={ui.hint} role="status">
              {found.rows.length === 1 ? "1 ricetta" : `${found.rows.length} ricette`} con «{food}»{found.hidden > 0 ? ` · ${hiddenText(found)}` : ""}
            </p>
            <ul className={recipeStyles.list}>
              {found.rows.map((row) => {
                const missing = missingText(row);
                const confirmedNote = confirmedRowText(found.confirmedBy.get(row.recipe.recipeId) ?? []);
                return (
                  <li key={row.recipe.recipeId}>
                    <Link className={recipeStyles.card} href={`/app/ricette/vedi?id=${encodeURIComponent(row.recipe.recipeId)}`}>
                      <span className={recipeStyles.cardTitle}>{row.recipe.title}</span>
                      <span className={recipeStyles.meta}>
                        <span>{formatServings(row.recipe.servings)}</span>
                        {row.minutes !== undefined ? <span>{formatMinutes(row.minutes)}</span> : null}
                      </span>
                      <span className={recipeStyles.noteStrong}>{countsText(row)}</span>
                      {missing ? <span className={recipeStyles.note}>{missing}</span> : null}
                      {confirmedNote ? <span className={recipeStyles.noteStrong}>{confirmedNote}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        )}
        <Link href={pairHref(food)} className={ui.textLink}>
          {SAVE_LABELS.pair}
        </Link>
      </section>
    </>
  );
}

/** Una ricetta salvata proposta: si apre toccando il titolo, un solo comando in vista. */
function SavedRow({ row, confirmedNote }: { row: RecipeRow; confirmedNote: string | undefined }) {
  const missing = missingText(row);
  const uses = rowExpiringText(row);
  return (
    <li className={recipeStyles.card}>
      <Link className={recipeStyles.cardTitle} href={`/app/ricette/vedi?id=${encodeURIComponent(row.recipe.recipeId)}`}>
        {row.recipe.title}
      </Link>
      <span className={recipeStyles.meta}>
        <span>{formatServings(row.recipe.servings)}</span>
        {row.minutes !== undefined ? <span>{formatMinutes(row.minutes)}</span> : null}
      </span>
      {uses ? <span className={recipeStyles.noteAccent}>{uses}</span> : null}
      <span className={recipeStyles.noteStrong}>{countsText(row)}</span>
      {missing ? <span className={recipeStyles.note}>{missing}</span> : null}
      {confirmedNote ? <span className={recipeStyles.noteStrong}>{confirmedNote}</span> : null}
      <div className={ui.row}>
        <Button href={cookHref(row.recipe.recipeId, row.recipe.servings)} variant="outline">
          Cucina
        </Button>
      </div>
    </li>
  );
}

/** Le ricette salvate in ordine «Per usare ciò che scade»: allergeni, esclusioni e conferme come nel ricettario. */
function SavedForExpiring({ withIncomplete }: { withIncomplete: boolean }) {
  const { recipes, diet, products, view, lists, linkOf, confirmations, failed } = useSavedContext();
  const result = useMemo(() => {
    if (!recipes.data || !view || !confirmations || !lists || !products) return undefined;
    return savedForExpiring(recipes.data.recipes, view, {
      query: "",
      tags: [],
      allergens: lists.allergens,
      excludedFoods: lists.excludedFoods,
      linkOf,
      confirmations,
    });
  }, [recipes.data, view, confirmations, lists, products, linkOf]);
  const none = recipes.data !== undefined && recipes.data.recipes.length === 0;

  return (
    <section className={ui.section}>
      <SectionHeader label="Le tue ricette per ciò che scade" />
      {withIncomplete && diet.state && !diet.state.complete ? <IncompleteDeclarations /> : null}
      {failed ? (
        <p className={ui.error} role="alert">
          Non riesco a leggere il ricettario. Riprova.
        </p>
      ) : none ? (
        <>
          <p className={ui.paragraph}>Non hai ancora ricette salvate.</p>
          <div className={ui.row}>
            <Button href="/app/ricette/nuova" variant="outline">
              Scrivi una ricetta
            </Button>
          </div>
        </>
      ) : !result ? (
        <LoadingLine />
      ) : result.picks.length === 0 ? (
        <p className={ui.paragraph}>Nessuna ricetta salvata da proporre adesso{result.outcome.hidden > 0 ? ` (${hiddenText(result.outcome)})` : ""}.</p>
      ) : (
        <>
          <ul className={recipeStyles.list}>
            {result.picks.map((row) => (
              <SavedRow key={row.recipe.recipeId} row={row} confirmedNote={confirmedRowText(result.outcome.confirmedBy.get(row.recipe.recipeId) ?? [])} />
            ))}
          </ul>
          {result.outcome.hidden > 0 ? <p className={ui.hint}>{hiddenText(result.outcome)}</p> : null}
        </>
      )}
    </section>
  );
}

/** Senza chiave: partenza da un alimento (se c'è), le tue ricette per ciò che scade, e una riga sulla chiave. */
function SavedIdeas({ food, issue }: { food: string | undefined; issue: ConfigIssue }) {
  return (
    <>
      {food ? <FoodStart food={food} /> : null}
      <SavedForExpiring withIncomplete={!food} />
      <p className={ui.hint}>
        {issue === "missing_key"
          ? "Con la tua chiave di un servizio di intelligenza artificiale ti propongo anche ricette nuove."
          : "Le impostazioni dell'intelligenza artificiale sono incomplete: completale per avere anche ricette nuove."}{" "}
        <Link href={SETTINGS_AI_HREF} className={ui.textLink}>
          Impostazioni
        </Link>
      </p>
      <Link href="/app/ricette" className={ui.textLink}>
        Torna al ricettario
      </Link>
    </>
  );
}

/** Gli alimenti mandati al modello con, se il codice a barre è noto, il nome del prodotto e gli allergeni in etichetta. */
async function withProductLabels(target: PantryTarget): Promise<CheckedPantryRef[]> {
  return Promise.all(
    target.refs.map(async (ref): Promise<CheckedPantryRef> => {
      const barcode = target.lotsById.get(ref.id)?.barcode;
      if (!barcode) return ref;
      const record = await getProductRecord(barcode).catch(() => undefined);
      const product = record && isStoredProduct(record.data) ? record.data : undefined;
      if (!product) return { ...ref, barcode };
      return {
        ...ref,
        barcode,
        ...(product.name ? { productName: product.name } : {}),
        ...(product.allergens && product.allergens.length > 0 ? { allergens: product.allergens } : {}),
      };
    }),
  );
}

/** Ricontrolla le idee con le etichette dei prodotti: può solo scartarne altre o renderle incerte, mai il contrario. */
function recheckWithLabels(out: IdeasOutcome, criteria: IdeaCriteria, labelled: readonly CheckedPantryRef[]): IdeasOutcome {
  if (!labelled.some((r) => r.productName !== undefined || r.allergens !== undefined)) return out;
  const ideas = [...out.accepted.map((a) => a.idea), ...out.rejected.map((r) => r.idea)];
  const again = checkIdeas(ideas, criteria, labelled);
  const before = new Map(out.rejected.map((r) => [r.idea, r]));
  // le idee già scartate restano scartate con i loro motivi
  const rejected = [...out.rejected, ...again.rejected.filter((r) => !before.has(r.idea))];
  const accepted = again.accepted.filter((a) => !before.has(a.idea));
  return { ...out, accepted, rejected };
}

/**
 * Rifà il controllo delle idee con le conferme di adesso: una conferma data (o revocata) dopo la risposta del modello cambia
 * l'esito subito. Le idee già scartate restano scartate: una conferma non vale mai per un allergene trovato.
 */
function recheckWithConfirmations(out: IdeasOutcome, criteria: IdeaCriteria, pantry: readonly CheckedPantryRef[]): IdeasOutcome {
  const ideas = [...out.accepted.map((a) => a.idea), ...out.rejected.map((r) => r.idea)];
  const again = checkIdeas(ideas, criteria, pantry);
  const before = new Set(out.rejected.map((r) => r.idea));
  return { ...out, accepted: again.accepted.filter((a) => !before.has(a.idea)), rejected: out.rejected };
}

function Loader({ settings, food }: { settings: AiSettings; food: string | undefined }) {
  const now = useNow();
  const pantry = usePantry();
  const diet = useDietDeclarations();
  const { prefs, ready } = useRecipePrefs();
  const { byKey: confirmations } = useConfirmations();
  const lists = useMemo(() => (diet.state ? declaredLists(diet.state) : undefined), [diet.state]);
  if (pantry.error || diet.error) return <StorageError />;
  if (!pantry.data || !diet.state || !lists || !ready || !now || !confirmations) {
    return (
      <>
        <LoadingLine />
      </>
    );
  }
  return (
    <Ideas
      settings={settings}
      now={now}
      prefs={prefs}
      declared={lists}
      incomplete={!diet.state.complete}
      lots={activeLots(pantry.data)}
      confirmations={confirmations}
      food={food}
    />
  );
}

function Ideas({
  settings,
  now,
  prefs,
  declared,
  incomplete,
  lots,
  confirmations,
  food,
}: {
  food: string | undefined;
  settings: AiSettings;
  now: string;
  prefs: RecipePrefs;
  /** Allergeni ed esclusioni dalla lettura unica: sono anche ciò che va al modello, niente di più. */
  declared: { allergens: string[]; excludedFoods: string[] };
  incomplete: boolean;
  lots: ReturnType<typeof activeLots>;
  confirmations: ConfirmationMap;
}) {
  const ids = useId();
  const router = useRouter();
  const notice = useNotice();
  const actions = useConfirmationActions();
  const abortRef = useRef<AbortController | null>(null);

  const allergens = declared.allergens;
  const excluded = declared.excludedFoods;
  // con un alimento di partenza i suoi lotti sono i primi dell'elenco mandato al modello
  const entries = useMemo(() => (food ? foodFirst(evaluateLots(lots, now), food) : evaluateLots(lots, now)), [lots, now, food]);
  const foodInHome = food ? entries.some((e) => sameFood(e.lot.productRef, food)) : true;

  const [maxMinutes, setMaxMinutes] = useState(0);
  const [servings, setServings] = useState(2);
  const [equipmentText, setEquipmentText] = useState(prefs.ownedEquipment.join(", "));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asked, setAsked] = useState<{ outcome: IdeasOutcome; criteria: IdeaCriteria; pantry: readonly CheckedPantryRef[] } | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<number, string>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // una richiesta in corso (e il suo costo) si ferma solo quando si lascia la pagina, non cambiando scheda
  useEffect(() => () => abortRef.current?.abort(), []);

  // le conferme di adesso, non quelle di quando è arrivata la risposta
  const outcome = useMemo(
    () => (asked ? recheckWithConfirmations(asked.outcome, { ...asked.criteria, confirmations }, asked.pantry) : null),
    [asked, confirmations],
  );

  const model = activeModel(settings);
  const equipment = splitList(equipmentText, 20);
  const emptyPantry = entries.length === 0;

  async function onAsk() {
    if (busy || emptyPantry) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setAsked(null);
    setConfirmError(null);
    setSaved({});
    setSaveError(null);
    try {
      const target = toPantryTarget(entries);
      const criteria: IdeaCriteria = { allergens, excludedFoods: excluded, ...(maxMinutes > 0 ? { maxMinutes } : {}), ownedEquipment: equipment, confirmations };
      const out = await readRecipeIdeas({
        store: dexieSettingsStore(),
        target,
        criteria,
        equipment,
        servings,
        today: dayOf(new Date().toISOString()),
        signal: controller.signal,
      });
      const labelled = await withProductLabels(target);
      const checked = recheckWithLabels(out, criteria, labelled);
      setAsked({ outcome: food ? { ...checked, accepted: ideasFoodFirst(checked.accepted, food) } : checked, criteria, pantry: labelled });
    } catch (e) {
      setError(isAiError(e) ? describeAiError(e, { provider: settings.provider, model }) : "La richiesta non è riuscita. Riprova.");
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  async function onConfirm(subject: ItemSubject): Promise<void> {
    setConfirmError(await actions.confirm(subject, { allergens, excludedFoods: excluded }));
  }

  async function onSave(index: number, checked: CheckedIdea, thenCook: boolean, confirmedUncertain: boolean) {
    if (saving !== null || !outcome || !asked) return;
    setSaving(index);
    setSaveError(null);
    try {
      const existing = saved[index];
      let recipeId = existing;
      if (!recipeId) {
        // si rilegge l'archivio: un allergene o un'esclusione dichiarati dopo la risposta non si ignorano
        const current = declaredLists(await readDietDeclarations());
        if (!declaredCoveredBy(current, { allergens: asked.criteria.allergens, excludedFoods: asked.criteria.excludedFoods })) {
          setSaveError(DECLARED_CHANGED);
          return;
        }
        const result = recipeEventFromIdea(
          checked,
          { provider: PROVIDER_LABELS[settings.provider], model: outcome.info.model },
          { now: new Date().toISOString(), deviceId: await getDeviceId() },
          { confirmedUncertain },
        );
        if (!result.ok) {
          setSaveError(result.error);
          return;
        }
        const written = await appendEvents([result.event]);
        if (written.added === 0 || written.rejected.length > 0) {
          setSaveError("Non sono riuscito a salvare. Riprova.");
          return;
        }
        recipeId = result.event.recipeId;
        notice.show({ message: `Salvata nel ricettario: «${checked.idea.title}», segnata come generata.`, undo: [result.event] });
        setSaved((s) => ({ ...s, [index]: result.event.recipeId }));
      }
      if (thenCook) router.push(cookHref(recipeId, checked.idea.servings));
    } catch {
      setSaveError("Non sono riuscito a salvare sul telefono. Riprova.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <>
      {food ? <FoodStart food={food} /> : null}
      <SectionHeader label="Idee nuove con l'intelligenza artificiale" />
      <p className={ui.lead}>Ti propongo tre ricette con ciò che hai, prima ciò che scade. Allergeni ed esclusioni li ricontrollo io sulla risposta.</p>
      {food ? (
        <p className={ui.hint}>
          {foodInHome
            ? `«${food}» è il primo alimento dell'elenco che mando, e le idee che lo usano vengono per prime.`
            : `«${food}» non risulta più tra gli alimenti in casa: le idee partono da ciò che hai.`}
        </p>
      ) : null}
      <p className={ui.hint}>{HONEST_LINE}</p>

      <SendNotice settings={settings} sends="L'elenco della tua dispensa (nomi, quantità, giorni alla scadenza), i tuoi allergeni ed esclusioni, il tempo e l'attrezzatura" now={now} />

      <section className={ui.section}>
        <SectionHeader label="Cosa ricordo di te" />
        {incomplete && !food ? <IncompleteDeclarations /> : null}
        <p className={ui.paragraph}>
          <strong>Allergeni:</strong> {allergens.length > 0 ? allergens.join(", ") : "nessuno dichiarato"}.
        </p>
        <p className={ui.paragraph}>
          <strong>Alimenti esclusi:</strong> {excluded.length > 0 ? excluded.join(", ") : "nessuno dichiarato"}.
        </p>
        <p className={ui.hint}>
          <Link href={DIET_HREF} className={ui.textLink}>
            Cambia
          </Link>
          . {ALLERGEN_CHECK_NOTICE}
        </p>
      </section>

      <div className={styles.limits}>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-time`}>
            Tempo disponibile
          </label>
          <select id={`${ids}-time`} className={ui.input} value={maxMinutes} onChange={(e) => setMaxMinutes(Number(e.target.value))} disabled={busy}>
            {TIME_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {m === 0 ? "Nessun limite" : `Al massimo ${formatMinutes(m)}`}
              </option>
            ))}
          </select>
        </div>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-servings`}>
            Per quante porzioni
          </label>
          <select id={`${ids}-servings`} className={ui.input} value={servings} onChange={(e) => setServings(Number(e.target.value))} disabled={busy}>
            {[1, 2, 3, 4, 5, 6].map((n) => (
              <option key={n} value={n}>
                {formatServings(n)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-equipment`}>
          Attrezzatura <span className={ui.optional}>(separata da virgole)</span>
        </label>
        <input id={`${ids}-equipment`} className={ui.input} type="text" value={equipmentText} onChange={(e) => setEquipmentText(e.target.value)} disabled={busy} autoComplete="off" placeholder="forno, padella, frullatore" />
        <p className={ui.hint}>Se la lasci vuota uso solo fornelli, forno e pentole comuni.</p>
      </div>

      <div className={ui.row}>
        {/* il pieno è uno solo: con le proposte in vista i pulsanti di ogni proposta contano più di «altre tre» */}
        <Button variant={outcome ? "outline" : "primary"} onClick={onAsk} disabled={busy || emptyPantry}>
          {busy ? "Penso a tre ricette…" : outcome ? "Proponi altre tre ricette" : "Proponi tre ricette"}
        </Button>
        {busy ? (
          <Button variant="outline" onClick={() => abortRef.current?.abort()}>
            Ferma
          </Button>
        ) : null}
      </div>
      {emptyPantry ? <p className={ui.hint}>La dispensa è vuota: aggiungi qualche alimento e poi chiedimi le idee.</p> : null}
      {busy ? (
        <p className={ui.hint} role="status">
          Può volerci mezzo minuto.
        </p>
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {outcome ? (
        <>
          <div className={ui.callout} role="note">
            <p className={ui.paragraph}>
              <strong>Idee, non ricette provate.</strong> {HONEST_LINE} Nulla è nel ricettario finché non lo salvi tu.
            </p>
            <ReadInfo info={outcome.info} problems={outcome.problems} />
          </div>

          {outcome.accepted.length === 0 ? (
            <div className={ui.empty}>
              <h2 className={ui.emptyTitle}>Nessuna ricetta utilizzabile</h2>
              <p className={ui.emptyText}>
                {outcome.rejected.length > 0 ? "Quelle proposte contenevano qualcosa che hai escluso (sotto trovi perché). Puoi chiedere altre idee." : "Dalla risposta non ho ricavato ricette leggibili. Riprova."}
              </p>
            </div>
          ) : (
            <section className={ui.section}>
              <SectionHeader label={`Proposte (${outcome.accepted.length})`} />
              <ul className={styles.cards}>
                {outcome.accepted.map((checked, index) => (
                  <IdeaCard
                    key={`${checked.idea.title}-${index}`}
                    checked={checked}
                    savedId={saved[index]}
                    busy={saving === index}
                    disabled={saving !== null}
                    onSave={(thenCook, confirmedUncertain) => onSave(index, checked, thenCook, confirmedUncertain)}
                    onConfirm={onConfirm}
                    allergens={allergens}
                  />
                ))}
              </ul>
              {confirmError ? (
                <p className={ui.error} role="alert">
                  {confirmError}
                </p>
              ) : null}
              {saveError ? (
                <p className={ui.error} role="alert">
                  {saveError}
                </p>
              ) : null}
            </section>
          )}

          {outcome.rejected.length > 0 ? (
            <section className={ui.section}>
              <SectionHeader label={`Scartate (${outcome.rejected.length})`} />
              <ul className={ui.bullets}>
                {outcome.rejected.map((r, i) => (
                  <li key={`${r.idea.title}-${i}`} className={ui.paragraph}>
                    <strong>{r.idea.title}</strong>: scartata perché {r.reasons.join("; ")}.
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}

      <Link href="/app/ricette" className={ui.textLink}>
        Torna al ricettario
      </Link>
    </>
  );
}

const STATUS_TEXT: Record<IngredientStatus, string> = {
  in_pantry: "in casa",
  partial: "in casa, ma non basta",
  to_confirm: "da confermare",
  unquantified: "in casa, quantità da verificare",
  missing: "da comprare",
};

function statusClass(status: IngredientStatus): string {
  if (status === "in_pantry") return styles.have;
  if (status === "missing" || status === "partial") return styles.lack;
  return styles.check;
}

function IngredientItem({ item }: { item: CheckedIngredient }) {
  const extra =
    item.status === "partial" && item.shortfall
      ? ` (mancano ${formatQuantity(item.shortfall)})`
      : item.status === "to_confirm" && item.matched.length > 0
        ? ` (hai «${item.matched.map((m) => m.name).join("», «")}»)`
        : "";
  return (
    <li>
      {ingredientLine(item.ingredient)} <span className={statusClass(item.status)}>· {STATUS_TEXT[item.status]}{extra}</span>
    </li>
  );
}

function IdeaCard({
  checked,
  savedId,
  busy,
  disabled,
  onSave,
  onConfirm,
  allergens,
}: {
  checked: CheckedIdea;
  savedId: string | undefined;
  busy: boolean;
  disabled: boolean;
  onSave: (thenCook: boolean, confirmedUncertain: boolean) => void;
  /** Conferma un ingrediente, uno alla volta: «ho letto l'etichetta, per me va bene». */
  onConfirm: (subject: ItemSubject) => Promise<void>;
  /** Gli allergeni dichiarati adesso: sono quelli che la conferma copre. */
  allergens: readonly string[];
}) {
  const { idea } = checked;
  const confirmId = useId();
  const [confirmed, setConfirmed] = useState(false);
  const minutes = totalMinutes({ times: idea.times, steps: idea.steps });
  const uncertain = checked.uncertain.length > 0;
  // finché l'utente non conferma di aver letto le etichette, la ricetta incerta non si salva
  const blocked = uncertain && !confirmed;
  return (
    <li className={styles.card}>
      <h3 className={styles.cardTitle}>{idea.title}</h3>
      <p className={styles.cardMeta}>
        <span>{formatServings(idea.servings)}</span>
        {minutes !== undefined ? <span>circa {formatMinutes(minutes)}</span> : null}
        <span>generata</span>
        {uncertain ? <span className={styles.check}>allergeni da verificare</span> : null}
        {checked.confirmed.length > 0 ? <span className={recipeStyles.flagConfirmed}>ingredienti confermati da te</span> : null}
      </p>

      {uncertain ? (
        <div className={ui.calloutStrong} role="alert">
          <p className={ui.paragraph}>
            <strong>Da controllare prima di salvare.</strong> Dal nome non so se questi ingredienti contengono i tuoi allergeni:
          </p>
          <ul className={styles.list}>
            {checked.uncertain.map((u, i) => (
              <li key={i}>{u}.</li>
            ))}
          </ul>
          {checked.uncertainIngredients.length > 0 ? (
            <>
              <p className={ui.hint}>Se hai letto l&apos;etichetta e per te va bene, puoi confermare un ingrediente alla volta.</p>
              <ul className={styles.list}>
                {checked.uncertainIngredients.map((u) => (
                  <li key={u.name}>
                    <Button variant="outline" onClick={() => void onConfirm(u.subject)}>
                      {confirmButtonText(u.name, allergens)}
                    </Button>
                  </li>
                ))}
              </ul>
              <p className={ui.hint}>{CONFIRMATION_NOTICE}</p>
            </>
          ) : null}
          {savedId ? null : (
            <label className={ui.switch} htmlFor={confirmId}>
              <input id={confirmId} type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              <span className={ui.switchText}>Ho letto le etichette di questi ingredienti: non contengono i miei allergeni.</span>
            </label>
          )}
        </div>
      ) : null}

      {checked.confirmed.length > 0 ? (
        <div className={`${ui.callout} ${recipeStyles.safetyConfirmed}`} role="note">
          <p className={ui.paragraph}>
            <strong>Confermato da te.</strong> L&apos;app non ha verificato questi ingredienti: l&apos;hai dichiarato tu.
          </p>
          <ul className={styles.list}>
            {checked.confirmed.map((c) => (
              <li key={c.name}>
                «{c.name}»: {confirmedText(c.confirmedAt)} per {c.allergens.join(", ")}.
              </li>
            ))}
          </ul>
          <p className={ui.hint}>
            <Link href={`${DIET_HREF}?sezione=conferme`} className={ui.textLink}>
              Le conferme si ritirano in Alimentazione.
            </Link>
          </p>
        </div>
      ) : null}

      {checked.expiringUsed.length > 0 ? (
        <p className={ui.paragraph}>
          <strong>Usa ciò che scade:</strong> {checked.expiringUsed.map(expiringText).join(", ")}.
        </p>
      ) : null}
      <p className={ui.paragraph}>
        <strong>Dalla tua dispensa:</strong> {checked.usedFromPantry.length > 0 ? checked.usedFromPantry.map((p) => p.name).join(", ") : "niente di sicuro"}.
      </p>
      <p className={ui.paragraph}>
        <strong>Ti manca:</strong> {checked.missing.length > 0 ? checked.missing.map((m) => ingredientLine(m)).join(", ") : "niente"}.
      </p>

      {checked.warnings.length > 0 ? (
        <ul className={styles.list}>
          {checked.warnings.map((w, i) => (
            <li key={i} className={styles.check}>
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      <details>
        <summary className={ui.fieldLabel}>Ingredienti e passi</summary>
        <ul className={styles.list}>
          {checked.ingredients.map((item, i) => (
            <IngredientItem key={i} item={item} />
          ))}
        </ul>
        <ol className={styles.list}>
          {idea.steps.map((s, i) => (
            <li key={i}>
              {s.text}
              {s.durationMinutes ? ` (${formatMinutes(s.durationMinutes)})` : ""}
            </li>
          ))}
        </ol>
        {idea.equipment.length > 0 ? <p className={ui.hint}>Attrezzatura: {idea.equipment.join(", ")}.</p> : null}
        {idea.notes ? <p className={ui.hint}>Dal modello, da verificare: {idea.notes}</p> : null}
      </details>

      {/* più proposte stanno in fila: il pieno è uno solo per schermata, quindi qui il comando in vista è a contorno */}
      {savedId ? (
        <div className={ui.row}>
          <p className={ui.hint} role="status">
            Salvata nel ricettario, segnata come generata.
          </p>
          <Button href={cookHref(savedId, idea.servings)} variant="outline">
            Cucina
          </Button>
          <Button href={`/app/ricette/vedi?id=${encodeURIComponent(savedId)}`} variant="text">
            Aprila
          </Button>
        </div>
      ) : (
        <div className={ui.row}>
          <Button variant="outline" onClick={() => onSave(true, confirmed)} disabled={disabled || blocked}>
            {busy ? "Salvo…" : "Salva e cucina"}
          </Button>
          <Button variant="text" onClick={() => onSave(false, confirmed)} disabled={disabled || blocked}>
            Salva nel ricettario
          </Button>
          {blocked ? <p className={ui.hint}>Per salvarla conferma prima di aver controllato le etichette.</p> : null}
        </div>
      )}
    </li>
  );
}
