"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { activeLots } from "@/core/ledger";
import { applySubstitutions, compareWithPantry, scaleRecipe, stockFromLots, type Recipe, type Substitution } from "@/core/recipes";
import { formatQuantity } from "@/core/units";
import { usePantry, useRecipes } from "@/data";
import { Button, Label } from "@/design";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { formatMinutes } from "./common";
import { FlagText, SafetyPanel } from "./SafetyPanel";
import { SubstituteOptions } from "./SubstituteOptions";
import { SUBSTITUTION_PARAM, chosenFor, missingIndices, parseSubstitutions, recipeHref, unappliedNote, validSubstitutions, withSubstitution } from "./substitutes";
import { useRecipeSafety } from "./useRecipeSafety";
import { useSubstitutes } from "./useSubstitutes";
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

/** `/app/ricette/cucina?id=…&porzioni=…`: un passo alla volta, a caratteri grandi. */
export function Cook() {
  const params = useSearchParams();
  const id = params.get("id");
  const requested = Number(params.get("porzioni"));
  const recipes = useRecipes();
  if (recipes.error) return <StorageError />;
  if (!recipes.data) {
    return (
      <div className={ui.screen}>
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
  return <Steps key={recipe.recipeId} recipe={recipe} servings={servings} initialSubstitutions={chosen} />;
}

type Wake = "idle" | "on" | "unavailable";

function Steps({ recipe: written, servings, initialSubstitutions }: { recipe: Recipe; servings: number; initialSubstitutions: Substitution[] }) {
  const [state, setState] = useState<CookState>(() => startCook(written.steps.length));
  const [nowMs, setNowMs] = useState(0);
  const [wake, setWake] = useState<Wake>("idle");
  // Le sostituzioni valgono per questa cottura: il controllo allergeni e gli ingredienti mostrati leggono la ricetta come
  // verrà cucinata; i passi si cercano con i nomi scritti, perché il testo dei passi nomina quelli.
  // Si applicano solo quelle tra le proposte già controllate: un indirizzo scritto a mano non ne introduce altre.
  const [chosen, setChosen] = useState<Substitution[]>(initialSubstitutions);
  // con allergeni o esclusioni dichiarati si parte solo dopo aver visto l'esito
  const [seen, setSeen] = useState(false);

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

  const scaledWritten = useMemo(() => {
    const r = scaleRecipe(written, servings);
    return r.ok ? r.value.ingredients : written.ingredients;
  }, [written, servings]);
  const ingredients = useMemo(() => {
    const r = scaleRecipe(recipe, servings);
    return r.ok ? r.value.ingredients : recipe.ingredients;
  }, [recipe, servings]);
  const back = recipeHref("/app/ricette/vedi", written.recipeId, substitutions);
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

  const anyRunning = Object.values(state.timers).some(isRunning);
  useEffect(() => {
    if (!anyRunning) return;
    const t = window.setInterval(() => setNowMs(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [anyRunning]);

  const finished = finishedSteps(state, nowMs);
  const finishedKey = finished.join(",");
  useEffect(() => {
    if (finishedKey !== "" && typeof navigator.vibrate === "function") navigator.vibrate([300, 150, 300]);
  }, [finishedKey]);

  // Lo schermo resta acceso dove il dispositivo lo permette; un rifiuto non è un errore.
  useEffect(() => {
    let sentinel: WakeLockSentinel | undefined;
    let cancelled = false;
    async function acquire() {
      try {
        if (!("wakeLock" in navigator)) throw new Error("unsupported");
        const s = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void s.release();
          return;
        }
        sentinel = s;
        setWake("on");
      } catch {
        if (!cancelled) setWake("unavailable");
      }
    }
    const onVisible = () => {
      if (document.visibilityState === "visible" && (!sentinel || sentinel.released)) void acquire();
    };
    void acquire();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => undefined);
    };
  }, []);

  if (written.steps.length === 0) {
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

  if (safety.status !== "none" && !seen) {
    const flags = safety.status === "ready" ? safety.flags : undefined;
    const needsAck = safety.status === "ready" && safety.safety.verdict !== "clear";
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>Prima di iniziare</h1>
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
          <Button disabled={safety.status !== "ready"} onClick={() => setSeen(true)}>
            {needsAck ? "Ho letto, inizia lo stesso" : "Inizia"}
          </Button>
          <Link href={back} className={ui.textLink}>
            Torna alla ricetta
          </Link>
        </div>
      </div>
    );
  }

  const step = written.steps[state.index];
  const timer = state.timers[state.index];
  const hint = ingredientsForStep(step, scaledWritten);
  const left = timer ? remaining(timer, nowMs) : 0;
  const over = timer !== undefined && isRunning(timer) && left <= 0;

  function start() {
    const n = Date.now();
    setNowMs(n);
    setState((s) => startTimer(s, s.index, step.durationMinutes, n));
  }

  return (
    <div className={styles.cook}>
      <div className={styles.cookTop}>
        <Link href={back} className={ui.textLink}>
          Esci
        </Link>
        <span className={styles.cookCount} aria-live="polite">
          Passo {state.index + 1} di {state.stepCount}
        </span>
      </div>

      {finished.length > 0 ? (
        <div className={ui.calloutStrong} role="alert">
          {finished.length === 1 ? `Il timer del passo ${finished[0] + 1} è finito.` : `Timer finiti: passi ${finished.map((n) => n + 1).join(", ")}.`}{" "}
          {finished.map((n) => (
            <Button key={n} variant="text" onClick={() => setState((s) => resetTimer(s, n))}>
              Spegni {n + 1}
            </Button>
          ))}
        </div>
      ) : null}

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
                  <Button variant="outline" onClick={() => setState((s) => pauseTimer(s, s.index, Date.now()))}>
                    Pausa
                  </Button>
                ) : left > 0 ? (
                  <Button onClick={start}>Riprendi</Button>
                ) : null}
                <Button variant="text" onClick={() => setState((s) => resetTimer(s, s.index))}>
                  Azzera
                </Button>
              </div>
            </>
          ) : (
            <Button onClick={start}>Avvia il timer</Button>
          )}
        </div>
      ) : null}

      <div className={styles.dots} role="group" aria-label="Vai al passo">
        {written.steps.map((_, i) => (
          <button
            key={i}
            type="button"
            className={i === state.index ? styles.dotOn : state.timers[i] ? styles.dotTimer : styles.dot}
            aria-current={i === state.index ? "step" : undefined}
            aria-label={`Passo ${i + 1}${state.timers[i] ? ", con un timer" : ""}`}
            onClick={() => setState((c) => goTo(c, i))}
          >
            {i + 1}
          </button>
        ))}
      </div>

      <div className={styles.cookNav}>
        <Button variant="outline" disabled={isFirst(state)} onClick={() => setState((s) => move(s, -1))}>
          Indietro
        </Button>
        {isLast(state) ? (
          <Button href={recipeHref("/app/ricette/cucinata", written.recipeId, substitutions, servings)}>Finito: registra il pasto</Button>
        ) : (
          <Button onClick={() => setState((s) => move(s, 1))}>Avanti</Button>
        )}
      </div>

      {wake === "unavailable" ? (
        <p className={ui.hint}>Questo dispositivo non mi lascia tenere lo schermo acceso: potrebbe spegnersi mentre cucini.</p>
      ) : null}
    </div>
  );
}
