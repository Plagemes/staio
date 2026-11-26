"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { activeLots } from "@/core/ledger";
import { applySubstitutions, compareWithPantry, scaleRecipe, stockFromLots, type Recipe, type Substitution } from "@/core/recipes";
import { formatQuantity } from "@/core/units";
import { getDeviceId, usePantry, useRecipes } from "@/data";
import { Button, Label } from "@/design";
import { ActionBar, MoreActions, Sheet, useWakeLock, type ActionItem } from "../common";
import { useFormEpoch } from "../common/freshForm";
import { useNotice } from "../notice";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { formatMinutes, formatServings } from "./common";
import { FlagText, IncompleteDeclarations, SafetyPanel } from "./SafetyPanel";
import { SubstituteOptions } from "./SubstituteOptions";
import { SUBSTITUTION_PARAM, chosenFor, missingIndices, parseSubstitutions, recipeHref, unappliedNote, validSubstitutions, withSubstitution } from "./substitutes";
import { useRecipeSafety } from "./useRecipeSafety";
import { useSubstitutes } from "./useSubstitutes";
import {
  clearCookSession,
  cookProgressText,
  cookResumeHref,
  cookFingerprint,
  isOutcomePending,
  isPassageSeen,
  loadCookSession,
  restoreCookSession,
  saveCookSession,
  type AckedOutcome,
  type CookSession,
} from "./cookSession";
import {
  finishedSteps,
  formatClock,
  goTo,
  ingredientsForStep,
  isFirst,
  isLast,
  isRunning,
  move,
  pauseTimer,
  remaining,
  resetTimer,
  startCook,
  startTimer,
  type CookState,
} from "./cookMode";
import styles from "./recipes.module.css";

/** Ciò che si sa prima del primo disegno dei passi: la sessione salvata (letta una volta) e il telefono. */
interface Boot {
  session: CookSession | undefined;
  deviceId: string;
}

function useBoot(): Boot | undefined {
  const [boot, setBoot] = useState<Boot>();
  useEffect(() => {
    let off = false;
    void Promise.all([loadCookSession(), getDeviceId().catch(() => "")]).then(([session, deviceId]) => {
      if (!off) setBoot({ session, deviceId });
    });
    return () => {
      off = true;
    };
  }, []);
  return boot;
}

/** `/app/ricette/cucina?id=…&porzioni=…`: un passo alla volta, a caratteri grandi. La cottura si ritrova dopo una telefonata o una ricarica. */
export function Cook() {
  const params = useSearchParams();
  // a ogni arrivo da un collegamento la sessione si rilegge: un'altra cottura, o la stessa finita nel frattempo, non resta a metà in memoria
  const { epoch } = useFormEpoch(params.toString());
  return <CookLoad key={epoch} />;
}

function CookLoad() {
  const params = useSearchParams();
  const id = params.get("id");
  const requested = Number(params.get("porzioni"));
  const recipes = useRecipes();
  const boot = useBoot();
  if (recipes.error) return <StorageError />;
  if (!recipes.data || !boot) {
    return (
      <div className={ui.screen}>
        <LoadingLine />
      </div>
    );
  }
  const recipe = id ? recipes.data.recipes.find((r) => r.recipeId === id) : undefined;
  if (!recipe) {
    return <NotFound sessionOf={id} boot={boot} />;
  }
  const { session } = boot;
  // la sessione vale solo per questa ricetta e solo se i passi sono ancora quelli
  const resume = session && session.recipeId === recipe.recipeId && session.state.stepCount === recipe.steps.length ? session : undefined;
  const other = session && session.recipeId !== recipe.recipeId ? session : undefined;
  const otherTitle = other ? recipes.data.recipes.find((r) => r.recipeId === other.recipeId)?.title : undefined;
  const servings = Number.isFinite(requested) && requested > 0 && requested <= 1000 ? requested : (resume?.servings ?? recipe.servings);
  const chosen = parseSubstitutions(params.getAll(SUBSTITUTION_PARAM), recipe.ingredients.length);
  return (
    <Steps
      key={recipe.recipeId}
      recipe={recipe}
      servings={servings}
      initialSubstitutions={chosen}
      resume={resume}
      deviceId={boot.deviceId}
      other={other && otherTitle ? { session: other, title: otherTitle } : undefined}
    />
  );
}

/** Ricetta tolta mentre la cucina è aperta: la sessione di quella ricetta non serve più. */
function NotFound({ sessionOf, boot }: { sessionOf: string | null; boot: Boot }) {
  const stale = boot.session !== undefined && boot.session.recipeId === sessionOf;
  useEffect(() => {
    if (stale) void clearCookSession();
  }, [stale]);
  return (
    <div className={ui.screen}>
      <EmptyState title="Ricetta non trovata" text="Torna al ricettario e scegline un'altra." actionLabel="Torna al ricettario" actionHref="/app/ricette" />
    </div>
  );
}

function Steps({
  recipe: written,
  servings,
  initialSubstitutions,
  resume,
  deviceId,
  other,
}: {
  recipe: Recipe;
  servings: number;
  initialSubstitutions: Substitution[];
  resume: CookSession | undefined;
  deviceId: string;
  other: { session: CookSession; title: string } | undefined;
}) {
  const router = useRouter();
  const notice = useNotice();
  const [state, setState] = useState<CookState>(() => resume?.state ?? startCook(written.steps.length));
  const [nowMs, setNowMs] = useState(() => Date.now());
  /** La cottura è cominciata davvero (primo passo o timer, o ripresa): da qui in poi la sessione si scrive. */
  const [begun, setBegun] = useState(resume !== undefined);
  const [rev, setRev] = useState(0);
  const [sheet, setSheet] = useState<"ingredients" | null>(null);
  const startedAt = useRef(resume?.startedAt ?? null);
  const closed = useRef(false);
  /** Le scritture della sessione una dopo l'altra: ognuna rilegge ciò che c'è prima di scrivere. */
  const saving = useRef<Promise<void>>(Promise.resolve());
  // Le sostituzioni valgono per questa cottura: il controllo allergeni e gli ingredienti mostrati leggono la ricetta come
  // verrà cucinata; i passi si cercano con i nomi scritti, perché il testo dei passi nomina quelli.
  // Si applicano solo quelle tra le proposte già controllate: un indirizzo scritto a mano non ne introduce altre.
  const [chosen, setChosen] = useState<Substitution[]>(initialSubstitutions);
  // Il passaggio «Prima di iniziare» si salta solo se le liste dichiarate sono quelle già viste su questo telefono: una
  // sessione arrivata da un altro telefono, o con le liste cambiate, o con il controllo incompleto, lo mostra.
  const [ack, setAck] = useState<AckedOutcome | null>(() => (resume && resume.deviceId !== "" && resume.deviceId === deviceId ? { key: resume.declaredKey, byUser: false } : null));

  const pantry = usePantry();
  const missing = useMemo(() => {
    if (!pantry.data) return [];
    const cmp = compareWithPantry(written, stockFromLots(activeLots(pantry.data)), { servings });
    return cmp.ok ? missingIndices(cmp.value) : [];
  }, [pantry.data, written, servings]);
  const substitutes = useSubstitutes(written, missing);
  const substitutions = useMemo(() => validSubstitutions(chosen, substitutes.options), [chosen, substitutes.options]);
  const recipe = useMemo(() => applySubstitutions(written, substitutions), [written, substitutions]);
  const safety = useRecipeSafety(recipe);
  const unapplied =
    substitutes.status === "loading" || !pantry.data
      ? undefined
      : unappliedNote(chosen, substitutions, { missing, failed: substitutes.failed, originalName: (i) => written.ingredients[i]?.name ?? "" });

  // L'impronta dell'esito: liste dichiarate, conferme, verdetto, ingredienti segnalati e ricetta come si cucina.
  const pending = isOutcomePending({ safetyLoading: safety.status === "loading", chosenCount: chosen.length, substitutesLoading: substitutes.status === "loading", pantryRead: pantry.data !== undefined });
  const currentKey = useMemo(() => {
    if (pending || safety.status === "loading") return null;
    const ingredientNames = recipe.ingredients.map((i) => i.name);
    const steps = recipe.steps.length;
    if (safety.status === "none") {
      return cookFingerprint({ declared: { allergens: [], excludedFoods: [] }, incomplete: false, verdict: "clear", contains: [], uncertain: [], confirmed: [], flags: [], ingredients: ingredientNames, steps });
    }
    return cookFingerprint({
      declared: safety.declared,
      incomplete: safety.incomplete,
      verdict: safety.safety.verdict,
      contains: safety.safety.contains,
      uncertain: safety.safety.uncertain,
      confirmed: safety.safety.confirmed.map((c) => ({ key: c.key, text: c.text })),
      flags: [...safety.flags].map(([index, flag]) => ({ index, verdict: flag.verdict, text: flag.text })),
      ingredients: ingredientNames,
      steps,
    });
  }, [pending, safety, recipe]);
  const incomplete = safety.status === "ready" && safety.incomplete;
  // senza nulla dichiarato non c'è niente da vedere; altrimenti vale solo l'esito visto per queste stesse liste
  const seen = isPassageSeen({ nothingDeclared: safety.status === "none", currentKey, incomplete, ack });
  const baseKey = ack?.key ?? resume?.declaredKey;
  const declarationsChanged = baseKey !== undefined && currentKey !== null && baseKey !== currentKey;
  const passage = !seen;
  const hasSteps = written.steps.length > 0;

  const subsText = substitutions.map((s) => `${s.index}:${s.name}`).join("\n");
  const back = recipeHref("/app/ricette/vedi", written.recipeId, substitutions, servings);

  /** Ogni cambio di passo o di timer passa da qui: la cottura è cominciata e la sessione si riscrive. */
  const update = (change: (s: CookState) => CookState) => {
    setState(change);
    setBegun(true);
    setRev((n) => n + 1);
  };

  const snapshot = (): CookSession | undefined =>
    currentKey === null
      ? undefined
      : {
          v: 1,
          recipeId: written.recipeId,
          servings,
          subs: subsText,
          state,
          declaredKey: currentKey,
          deviceId,
          startedAt: startedAt.current ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

  // Si scrive a ogni cambio, e mai prima che la persona abbia visto l'esito del controllo: la sessione di un'altra ricetta
  // si sostituisce solo qui, cioè quando si comincia davvero.
  useEffect(() => {
    if (rev === 0 || !begun || !seen || closed.current) return;
    const session = snapshot();
    if (!session) return;
    const known = startedAt.current;
    startedAt.current = session.startedAt;
    saving.current = saving.current.then(async () => {
      if (closed.current) return;
      // Se questa cottura era già salvata e la sessione non c'è più (registrata, chiusa, scaduta) o è di un'altra cottura,
      // questa pagina rimasta viva non la riscrive.
      if (known !== null) {
        const stored = await loadCookSession();
        if (!stored || stored.recipeId !== session.recipeId || stored.startedAt !== known) {
          closed.current = true;
          return;
        }
      }
      await saveCookSession(session);
    });
    // `snapshot` legge ciò che sta nelle dipendenze
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rev, begun, seen, currentKey, state, servings, subsText]);

  const scaledWritten = useMemo(() => {
    const r = scaleRecipe(written, servings);
    return r.ok ? r.value.ingredients : written.ingredients;
  }, [written, servings]);
  const ingredients = useMemo(() => {
    const r = scaleRecipe(recipe, servings);
    return r.ok ? r.value.ingredients : recipe.ingredients;
  }, [recipe, servings]);
  const choose = (i: number, name: string | null) => setChosen((subs) => withSubstitution(subs, i, name));
  /** Accanto all'ingrediente: al posto di cosa, e ciò che hai in casa per sostituirlo se non c'è. */
  const substitution = (i: number) => {
    const picked = chosenFor(substitutions, i);
    const options = substitutes.options.get(i) ?? [];
    const original = written.ingredients[i]?.name ?? "";
    return (
      <>
        {picked !== undefined ? <span className={styles.replaces}>(al posto di «{original}»)</span> : null}
        {options.length > 0 || picked !== undefined ? (
          <SubstituteOptions ingredient={original} options={options} chosen={picked} onChoose={(name) => choose(i, name)} />
        ) : null}
      </>
    );
  };

  // il tempo scorre da solo finché c'è un timer con qualcosa da contare; a tempo finito si ridisegna una volta sola
  const ticking = Object.values(state.timers).some((t) => isRunning(t) && remaining(t, nowMs) > 0);
  useEffect(() => {
    if (!ticking) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [ticking]);

  const finished = finishedSteps(state, nowMs);
  const finishedKey = finished.join(",");
  useEffect(() => {
    if (finishedKey !== "" && typeof navigator.vibrate === "function") navigator.vibrate([300, 150, 300]);
  }, [finishedKey]);

  // Lo schermo resta acceso mentre i passi sono a schermo, dove il telefono lo permette.
  const { supported: wakeSupported } = useWakeLock(hasSteps && !passage);

  async function finishWithoutRecording() {
    closed.current = true;
    // si toglie solo la sessione di questa ricetta: quella di un'altra non è questa a chiuderla
    const stored = await loadCookSession();
    const own = stored && stored.recipeId === written.recipeId ? stored : undefined;
    if (own) await clearCookSession();
    notice.show({ message: "Cucina chiusa.", onUndo: async () => (own ? restoreCookSession(own) : undefined) });
    router.push(back);
  }

  const banner = other && !begun ? (
    <div className={ui.callout}>
      <p className={ui.paragraph}>
        Stavi cucinando «{other.title}» ({cookProgressText(other.session, nowMs)}).
      </p>
      <Button variant="outline" href={cookResumeHref(other.session)}>
        Riprendi «{other.title}»
      </Button>
    </div>
  ) : null;

  if (!hasSteps) {
    return (
      <div className={ui.screen}>
        <EmptyState
          title="Questa ricetta non ha passi"
          text="Aggiungili con «Modifica» e potrai seguirla qui, un passo alla volta."
          actionLabel="Torna alla ricetta"
          actionHref={back}
        />
      </div>
    );
  }

  // la sessione dice che il passaggio è già stato visto: finché il controllo non è letto si aspetta, senza mostrare i passi
  if (pending && ack !== null) {
    return (
      <div className={ui.screen}>
        <LoadingLine text="Controllo gli ingredienti…" />
      </div>
    );
  }

  if (passage) {
    const flags = safety.status === "ready" ? safety.flags : undefined;
    const needsAck = safety.status === "ready" && safety.safety.verdict !== "clear";
    return (
      <div className={ui.screen}>
        {banner}
        <h1 className={ui.title}>Prima di iniziare</h1>
        {declarationsChanged ? (
          <p className={ui.calloutStrong} role="alert">
            Qualcosa è cambiato da quando hai iniziato: ricontrolla prima di continuare.
          </p>
        ) : null}
        <p className={ui.lead}>«{recipe.title}»: guarda l&apos;esito del controllo degli allergeni.</p>
        <SafetyPanel state={safety} />
        {unapplied ? (
          <p className={ui.hint} role="status">
            {unapplied}
          </p>
        ) : null}
        {flags ? (
          <ul className={styles.cookIngredients} aria-label="Ingredienti">
            {ingredients.map((ing, i) => (
              <li key={i} className={styles.cookIngredient}>
                <span className={styles.cookQty}>{ing.quantity ? formatQuantity(ing.quantity) : "q.b."}</span>
                <span>{ing.name}</span>
                <FlagText flag={flags.get(i)} />
                {substitution(i)}
              </li>
            ))}
          </ul>
        ) : null}
        <div className={ui.row}>
          <Button
            disabled={safety.status !== "ready" || currentKey === null}
            onClick={() => {
              if (currentKey === null) return;
              setAck({ key: currentKey, byUser: true });
              // una cottura già cominciata ricorda subito che l'esito è stato visto
              if (begun) setRev((n) => n + 1);
            }}
          >
            {needsAck ? "Ho letto, inizia lo stesso" : "Inizia"}
          </Button>
          <Link href={back} className={ui.textLink}>
            Torna alla ricetta
          </Link>
        </div>
      </div>
    );
  }

  const index = Math.min(state.index, written.steps.length - 1);
  const step = written.steps[index];
  const timer = state.timers[index];
  const hint = ingredientsForStep(step, scaledWritten);
  const left = timer ? remaining(timer, nowMs) : 0;
  const over = timer !== undefined && isRunning(timer) && left <= 0;

  function start() {
    const n = Date.now();
    setNowMs(n);
    update((s) => startTimer(s, s.index, step.durationMinutes, n));
  }

  const more: ActionItem[] = [
    { id: "ingredients", label: "Ingredienti", onSelect: () => setSheet("ingredients") },
    { id: "finish", label: "Ho finito senza registrare", onSelect: () => void finishWithoutRecording() },
  ];

  return (
    <div className={styles.cook}>
      <div className={styles.cookTop}>
        <Link href={back} className={ui.textLink}>
          Chiudi
        </Link>
        <span className={styles.cookCount} aria-live="polite">
          Passo {index + 1} di {state.stepCount}
        </span>
        <MoreActions items={more} />
      </div>
      <p className={ui.hint}>
        {recipe.title} · {formatServings(servings)}
      </p>

      {banner}

      {finished.length > 0 ? (
        <div className={ui.calloutStrong} role="alert">
          {finished.length === 1 ? `Il timer del passo ${finished[0] + 1} è finito.` : `Timer finiti: passi ${finished.map((n) => n + 1).join(", ")}.`}{" "}
          {finished.map((n) => (
            <Button key={n} variant="text" onClick={() => update((s) => resetTimer(s, n))}>
              Spegni {n + 1}
            </Button>
          ))}
        </div>
      ) : null}

      {incomplete ? <IncompleteDeclarations /> : null}
      {safety.status === "ready" && safety.safety.verdict !== "clear" ? (
        <p className={safety.safety.verdict === "contains" ? styles.flagContains : styles.flagUncertain} role="note">
          {safety.safety.verdict === "contains" ? "Questa ricetta contiene qualcosa che hai dichiarato." : "In questa ricetta c'è almeno un ingrediente non verificabile."} Il dettaglio è nella scheda della ricetta.
        </p>
      ) : null}
      {safety.status === "ready" && safety.safety.verdict === "clear" && safety.safety.confirmed.length > 0 ? (
        <p className={styles.flagConfirmed} role="note">
          Hai confermato tu {safety.safety.confirmed.length === 1 ? "un ingrediente" : `${safety.safety.confirmed.length} ingredienti`}: {safety.safety.confirmed.map((c) => `«${c.name}»`).join(", ")}. L&apos;app non li ha verificati. Il dettaglio è nella scheda della ricetta.
        </p>
      ) : null}

      {unapplied ? (
        <p className={ui.hint} role="status">
          {unapplied}
        </p>
      ) : null}

      <p className={styles.cookText}>{step.text}</p>

      {hint.length > 0 ? (
        <ul className={styles.cookIngredients} aria-label="Ingredienti di questo passo">
          {hint.map((i) => {
            const ing = ingredients[i];
            return (
              <li key={i} className={styles.cookIngredient}>
                <span className={styles.cookQty}>{ing.quantity ? formatQuantity(ing.quantity) : "q.b."}</span>
                <span>{ing.name}</span>
                {safety.status === "ready" ? <FlagText flag={safety.flags.get(i)} /> : null}
                {substitution(i)}
              </li>
            );
          })}
        </ul>
      ) : null}
      {substitutes.options.size > 0 && substitutes.incomplete && hint.some((i) => substitutes.options.has(i)) && !incomplete ? <IncompleteDeclarations /> : null}

      {step.durationMinutes !== undefined ? (
        <div className={over ? styles.timerDone : styles.timer}>
          <Label>Timer · {formatMinutes(step.durationMinutes)}</Label>
          {timer ? (
            <>
              <span className={styles.clock} role="timer" aria-live="off">
                {formatClock(left)}
              </span>
              <div className={ui.row}>
                {isRunning(timer) ? (
                  <Button variant="outline" onClick={() => update((s) => pauseTimer(s, s.index, Date.now()))}>
                    Pausa
                  </Button>
                ) : left > 0 ? (
                  <Button variant="outline" onClick={start}>
                    Riprendi
                  </Button>
                ) : null}
                <Button variant="text" onClick={() => update((s) => resetTimer(s, s.index))}>
                  Azzera
                </Button>
              </div>
            </>
          ) : (
            <Button variant="outline" onClick={start}>
              Avvia il timer
            </Button>
          )}
        </div>
      ) : null}

      <div className={styles.dots} role="group" aria-label="Vai al passo">
        {written.steps.map((_, i) => (
          <button
            key={i}
            type="button"
            className={i === index ? styles.dotOn : state.timers[i] ? styles.dotTimer : styles.dot}
            aria-current={i === index ? "step" : undefined}
            aria-label={`Passo ${i + 1}${state.timers[i] ? ", con un timer" : ""}`}
            onClick={() => update((c) => goTo(c, i))}
          >
            {i + 1}
          </button>
        ))}
      </div>

      {!wakeSupported ? <p className={ui.hint}>Lo schermo potrebbe spegnersi mentre cucini.</p> : null}

      <ActionBar>
        <Button variant="outline" disabled={isFirst(state)} onClick={() => update((s) => move(s, -1))}>
          Indietro
        </Button>
        {isLast(state) ? (
          <Button href={recipeHref("/app/ricette/cucinata", written.recipeId, substitutions, servings)}>Finito: registra</Button>
        ) : (
          <Button onClick={() => update((s) => move(s, 1))}>Avanti</Button>
        )}
      </ActionBar>

      {sheet === "ingredients" ? (
        <Sheet title="Ingredienti" onClose={() => setSheet(null)}>
          <ul className={styles.cookIngredients} aria-label="Tutti gli ingredienti">
            {ingredients.map((ing, i) => (
              <li key={i} className={styles.cookIngredient}>
                <span className={styles.cookQty}>{ing.quantity ? formatQuantity(ing.quantity) : "q.b."}</span>
                <span>{ing.name}</span>
                {safety.status === "ready" ? <FlagText flag={safety.flags.get(i)} /> : null}
                {substitution(i)}
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
    </div>
  );
}
