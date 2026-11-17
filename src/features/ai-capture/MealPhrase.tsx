"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { isAiError } from "@/core/ai";
import type { MealPhraseDraft } from "@/core/ai/mealPhraseParse";
import { MAX_PHRASE_LENGTH } from "@/core/ai/mealPhrase";
import { mealsWithPantry, type MealKind } from "@/core/diary";
import { activeLots } from "@/core/ledger";
import { useDiary, useEventLog, usePantry } from "@/data";
import { Button } from "@/design";
import { dayOf } from "../format";
import { parseMealTarget } from "../meal/mealTarget";
import { describeAiError } from "../ai/messages";
import { NotReady } from "../ai/NotReady";
import { activeModel, configIssue, dexieSettingsStore, type AiSettings } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import { evaluateLots } from "../lots";
import { suggestMealKind } from "../meals";
import { createFoodSearch } from "../nutrition/candidates";
import { useFoods } from "../nutrition/useNutrition";
import { EmptyState, LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { ReadInfo, SendNotice } from "./AiNotices";
import styles from "./AiCapture.module.css";
import { AiHead, MealDraftReview } from "./MealDraftReview";
import { rowsFromPhrase, type DraftRow } from "./mealDraft";
import { recentMealsFor, toPantryTarget } from "./pantryRefs";
import { readMealPhrase, type CallInfo } from "./reads";
import { useDictation } from "./speech";

const TITLE = "Pasto da una frase";

export function MealPhrase() {
  const { settings, ready } = useAiSettings();
  if (!ready) {
    return (
      <div className={ui.screen}>
        <h1 className={ui.title}>{TITLE}</h1>
        <p className={ui.lead} role="status">
          Un attimo…
        </p>
      </div>
    );
  }
  const issue = configIssue(settings);
  if (issue !== null) {
    return <NotReady issue={issue} title={TITLE} what="registrare un pasto da una frase" alternative={{ href: "/app/pasto", label: "Registra a mano" }} />;
  }
  return <Phraser settings={settings} />;
}

interface Outcome {
  draft: MealPhraseDraft;
  info: CallInfo;
  rows: DraftRow[];
  kind: MealKind;
  /** Cambia a ogni lettura: la revisione riparte da zero. */
  run: number;
}

function Phraser({ settings }: { settings: AiSettings }) {
  const ids = useId();
  const now = useNow();
  const pantry = usePantry();
  const diary = useDiary();
  const log = useEventLog();
  const foods = useFoods();
  const search = useSearchParams();
  const abortRef = useRef<AbortController | null>(null);
  const runs = useRef(0);

  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const appendDictated = useCallback((text: string) => setPhrase((p) => `${p.trim() === "" ? "" : `${p.trim()} `}${text}`.slice(0, MAX_PHRASE_LENGTH)), []);
  const dictation = useDictation(appendDictated);

  const entries = useMemo(() => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []), [pantry.data, now]);
  const foodSearch = useMemo(() => (foods ? createFoodSearch(foods) : undefined), [foods]);

  if (pantry.error || diary.error || log.error) return <StorageError />;
  if (!pantry.data || !diary.data || !log.data || !now) {
    return (
      <div className={ui.screen}>
        <AiHead title={TITLE} />
        <LoadingLine />
      </div>
    );
  }
  const model = activeModel(settings);
  const today = dayOf(now);
  // da una riga di Oggi: il momento e il giorno arrivano dall'indirizzo e valgono come punto di partenza
  const mealTarget = parseMealTarget(search.get("momento"), search.get("giorno"), today);

  async function onRead() {
    if (busy || phrase.trim() === "" || !pantry.data || !diary.data || !log.data) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setOutcome(null);
    setBusy(true);
    try {
      const target = toPantryTarget(entries);
      const meals = mealsWithPantry(diary.data, log.data);
      const recent = recentMealsFor(meals, pantry.data.lots, target, today);
      const out = await readMealPhrase({ store: dexieSettingsStore(), phrase, target, recent, today, signal: controller.signal });
      runs.current += 1;
      setOutcome({ ...out, rows: rowsFromPhrase(out.draft, target), kind: mealTarget.kind ?? out.draft.kind ?? suggestMealKind(new Date().toISOString()), run: runs.current });
    } catch (e) {
      setError(isAiError(e) ? describeAiError(e, { provider: settings.provider, model }) : "La lettura non è riuscita. Riprova.");
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  function startOver() {
    setOutcome(null);
    setError(null);
    setPhrase("");
  }

  if (outcome) {
    const lowConfidence = outcome.rows.filter((r) => r.confidence < 0.5).length;
    return (
      <div className={ui.screen}>
        <AiHead title={TITLE} />
        <MealDraftReview
          key={outcome.run}
          source="voice"
          initialKind={outcome.kind}
          pastDate={mealTarget.pastDate}
          initialRows={outcome.rows}
          entries={entries}
          foodSearch={foodSearch}
          sourceNoun="frase"
          restartLabel="Un'altra frase"
          onRestart={startOver}
          leftovers={outcome.draft.unclear}
          banner={
            <>
              <div className={ui.callout} role="note">
                <p className={ui.paragraph}>
                  <strong>È una bozza stimata.</strong> Ho letto: «{phrase.trim()}». Quantità e voci possono essere sbagliate
                  {lowConfidence > 0 ? `, e ${lowConfidence === 1 ? "una voce" : `${lowConfidence} voci`} con poca certezza` : ""}: correggi ciò che serve. Le voci che non sono in dispensa le
                  collego io a un alimento della tabella solo se lo scegli tu.
                </p>
                <ReadInfo info={outcome.info} problems={outcome.draft.problems} />
              </div>
            </>
          }
        />
      </div>
    );
  }

  return (
    <div className={ui.screen}>
      <AiHead title={TITLE} />
      <p className={ui.lead}>
        Scrivi (o detta) che cosa hai mangiato: ti propongo il pasto, e tu lo rivedi prima che entri nel registro. Per esempio «a colazione due uova e una fetta di pane» oppure «come ieri a
        pranzo ma senza pane».
      </p>

      <SendNotice settings={settings} sends="La frase, l'elenco della tua dispensa (nomi e quantità) e i tuoi pasti degli ultimi giorni" now={now} />

      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-phrase`}>
          Che cosa hai mangiato
        </label>
        <textarea
          id={`${ids}-phrase`}
          className={styles.phrase}
          value={phrase}
          maxLength={MAX_PHRASE_LENGTH}
          onChange={(e) => setPhrase(e.target.value)}
          disabled={busy}
          placeholder="A pranzo pasta al pomodoro e un'insalata"
          autoComplete="off"
        />
        <p className={ui.hint}>Puoi anche usare la dettatura della tastiera del telefono.</p>
      </div>

      {dictation.supported ? (
        <div className={ui.field}>
          <div className={ui.row}>
            <Button variant="outline" onClick={dictation.listening ? dictation.stop : dictation.start} disabled={busy}>
              {dictation.listening ? "Smetti di ascoltare" : "Detta con la voce"}
            </Button>
          </div>
          <p className={ui.hint} role="status">
            {dictation.listening
              ? "Ti ascolto… parla, poi rileggi il testo qui sopra."
              : "La dettatura la fa il browser del dispositivo: su alcuni browser l'audio passa dai suoi server, non da questa app."}
          </p>
          {dictation.error ? (
            <p className={ui.error} role="alert">
              {dictation.error}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={ui.row}>
        <Button onClick={onRead} disabled={busy || phrase.trim() === ""}>
          {busy ? "Leggo la frase…" : "Proponi il pasto"}
        </Button>
        {busy ? (
          <Button variant="outline" onClick={() => abortRef.current?.abort()}>
            Annulla
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
      {entries.length === 0 ? (
        <EmptyState title="La dispensa è vuota" text="Posso comunque proporre voci libere, ma non scalerò nulla dalla dispensa." actionLabel="Aggiungi un alimento" />
      ) : null}
      <p className={ui.hint}>
        Non vuoi usare l&apos;intelligenza artificiale?{" "}
        <Link href="/app/pasto" className={ui.textLink}>
          Registra a mano
        </Link>
      </p>
    </div>
  );
}
