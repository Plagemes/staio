"use client";

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { QUESTION_MAX_CHARS, viewNeedsNutrition, type PinnedView, type ViewProblem, type ViewSpec } from "@/core/views";
import { Button, Label, SectionHeader } from "@/design";
import { configIssue, dexieSettingsStore } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import ui from "../ui.module.css";
import { askAssistant, type AskResult } from "./ask";
import { RunView } from "./GeneratedView";
import { pinSpec, removePinnedView, renamePinnedView, usePinnedViews } from "./pinnedStore";
import { ViewContextGate } from "./ViewContextGate";
import styles from "./assistant.module.css";

export const EXAMPLE_QUESTIONS = [
  "Com'è andato il ferro questo mese?",
  "Quanto ho speso in latticini?",
  "Cosa scade questa settimana?",
  "Quanta acqua bevo in media?",
  "Come cambia il mio peso?",
  "Cosa butto di più e perché?",
] as const;

type Pin = "idle" | "pinned" | "already" | "full" | "error";

export function Assistant() {
  const ids = useId();
  const { settings, ready } = useAiSettings();
  const issue = ready ? configIssue(settings) : null;
  const abortRef = useRef<AbortController | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AskResult | null>(null);
  const [pin, setPin] = useState<Pin>("idle");

  useEffect(() => () => abortRef.current?.abort(), []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready || issue !== null) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setResult(null);
    setPin("idle");
    const out = await askAssistant({ store: dexieSettingsStore(), question, signal: controller.signal });
    if (abortRef.current === controller) {
      setResult(out.kind === "error" && out.aborted ? null : out);
      setBusy(false);
    }
  }

  function onCancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
  }

  async function onPin(spec: ViewSpec, asked: string) {
    try {
      const res = await pinSpec(spec, asked);
      setPin(res.ok ? "pinned" : res.reason === "already_pinned" ? "already" : res.reason === "full" ? "full" : "error");
    } catch {
      setPin("error");
    }
  }

  const disabled = !ready || issue !== null;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Assistente</h1>
        <Label>Domande ai tuoi dati</Label>
      </div>
      <p className={ui.lead}>
        Chiedi a parole, per esempio «com&apos;è andato il ferro questo mese?». L&apos;assistente compone una schermata con i pezzi che l&apos;app sa calcolare; i numeri vengono sempre dai tuoi dati, mai dall&apos;intelligenza artificiale.
      </p>
      <p className={styles.privacy}>
        All&apos;intelligenza artificiale viene mandata solo la tua domanda, con l&apos;elenco di ciò che l&apos;app sa calcolare: non i tuoi dati. I numeri li calcola questa app, sul tuo telefono.
      </p>

      {issue !== null ? <NoKey issue={issue} /> : null}

      <form className={styles.askForm} onSubmit={onSubmit}>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-q`}>
            La tua domanda
          </label>
          <input
            id={`${ids}-q`}
            className={ui.input}
            type="text"
            value={question}
            maxLength={QUESTION_MAX_CHARS}
            onChange={(e) => setQuestion(e.target.value)}
            disabled={disabled}
            autoComplete="off"
            enterKeyHint="send"
            placeholder="Per esempio: quanto ho speso in latticini?"
          />
        </div>
        <div className={ui.row}>
          <Button type="submit" disabled={disabled || busy || question.trim().length === 0}>
            {busy ? "Sto pensando…" : "Chiedi"}
          </Button>
          {busy ? (
            <Button variant="outline" onClick={onCancel}>
              Annulla
            </Button>
          ) : null}
        </div>
        <ul className={styles.examples} aria-label="Esempi di domande">
          {EXAMPLE_QUESTIONS.map((q) => (
            <li key={q}>
              <button type="button" className={styles.example} disabled={disabled || busy} onClick={() => setQuestion(q)}>
                {q}
              </button>
            </li>
          ))}
        </ul>
      </form>

      <div className={styles.answer} aria-live="polite">
        {busy ? <p className={ui.lead}>Sto componendo la schermata…</p> : null}
        {result ? <Answer result={result} pin={pin} onPin={onPin} /> : null}
      </div>

      <PinnedList />
    </div>
  );
}

function NoKey({ issue }: { issue: NonNullable<ReturnType<typeof configIssue>> }) {
  const text =
    issue === "missing_key"
      ? "Per fare domande serve la tua chiave personale di un fornitore di intelligenza artificiale. È facoltativa: senza, l'app funziona lo stesso, e le viste che hai già fissato continuano ad aggiornarsi."
      : issue === "missing_model"
        ? "Hai scelto il fornitore, ma manca il nome del modello da usare. Scrivilo nelle impostazioni."
        : "L'indirizzo del servizio scelto non è valido. Correggilo nelle impostazioni.";
  return (
    <div className={ui.calloutStrong} role="status">
      <p className={ui.paragraph}>{text}</p>
      <div className={ui.row}>
        <Button href="/app/impostazioni/ai" variant="outline">
          Vai alle impostazioni
        </Button>
      </div>
    </div>
  );
}

function Problems({ problems }: { problems: readonly ViewProblem[] }) {
  return (
    <ul className={styles.problems}>
      {problems.slice(0, 8).map((p, i) => (
        <li key={i}>{p.message}</li>
      ))}
      {problems.length > 8 ? <li>…e altri {problems.length - 8} problemi.</li> : null}
    </ul>
  );
}

function Answer({ result, pin, onPin }: { result: AskResult; pin: Pin; onPin: (spec: ViewSpec, question: string) => void }) {
  if (result.kind === "error") {
    return (
      <div className={ui.calloutStrong} role="alert">
        <p className={ui.paragraph}>{result.message}</p>
        {result.needsSettings ? (
          <div className={ui.row}>
            <Button href="/app/impostazioni/ai" variant="outline">
              Vai alle impostazioni
            </Button>
          </div>
        ) : null}
      </div>
    );
  }
  const { outcome } = result;
  const cost = result.cost ? (
    <p className={ui.hint}>
      Questa domanda è costata {result.usageEstimated ? "circa " : ""}
      {result.cost}.
    </p>
  ) : null;

  if (outcome.kind === "unsupported") {
    return (
      <>
        <div className={ui.callout}>
          <p className={ui.paragraph}>{outcome.message}</p>
          <p className={ui.hint}>Prova con una delle domande d&apos;esempio, o chiedi la stessa cosa in un altro modo.</p>
        </div>
        {cost}
      </>
    );
  }

  if (outcome.kind === "invalid") {
    return (
      <>
        <div className={ui.calloutStrong} role="alert">
          <p className={ui.paragraph}>
            {outcome.reason === "truncated"
              ? "La risposta si è interrotta a metà e non l'ho potuta usare. Prova con una domanda più semplice."
              : "Non ho capito la risposta dell'assistente, quindi non ti mostro nulla di inventato. Ecco cosa non andava:"}
          </p>
          <Problems problems={outcome.problems} />
          <p className={ui.hint}>Riprova, anche con altre parole.</p>
        </div>
        {cost}
      </>
    );
  }

  const spec = outcome.view;
  return (
    <>
      <ViewContextGate needsNutrition={viewNeedsNutrition(spec)}>
        {(state) =>
          state.status === "ready" ? (
            <RunView spec={spec} ctx={state.ctx} />
          ) : (
            <p className={ui.lead} role="status">
              {state.status === "loading" ? "Apro i dati del telefono…" : "Non riesco a leggere i dati del telefono."}
            </p>
          )
        }
      </ViewContextGate>
      {outcome.problems.length > 0 ? (
        <div className={ui.callout}>
          <p className={ui.paragraph}>Una parte della risposta non l&apos;ho capita e l&apos;ho tolta:</p>
          <Problems problems={outcome.problems} />
        </div>
      ) : null}
      <div className={ui.row}>
        <Button onClick={() => onPin(spec, result.question)} disabled={pin === "pinned" || pin === "already"}>
          Fissa in Oggi
        </Button>
      </div>
      <p className={ui.hint} role="status">
        {pin === "pinned"
          ? "Fissata: la trovi in Oggi e si aggiorna da sola con i dati nuovi, senza intelligenza artificiale. Le note dell'assistente non vengono fissate."
          : pin === "already"
            ? "Questa vista è già fissata."
            : pin === "full"
              ? "Hai già troppe viste fissate: toglierne una per aggiungerne altre."
              : pin === "error"
                ? "Non sono riuscito a fissarla."
                : "Fissandola, si ricalcola da sola sui dati nuovi senza richiamare l'intelligenza artificiale."}
      </p>
      {cost}
    </>
  );
}

function PinnedList() {
  const { views, loading } = usePinnedViews();
  if (loading) return null;
  return (
    <section className={ui.section} aria-label="Viste fissate">
      <SectionHeader label="Fissate in Oggi" />
      {views.length === 0 ? (
        <p className={ui.hint}>Non hai ancora fissato nessuna vista. Quando una risposta ti serve, fissala: si aggiornerà da sola.</p>
      ) : (
        <ViewContextGate needsNutrition={views.some((v) => viewNeedsNutrition(v.spec))}>
          {(state) =>
            views.map((v) => (
              <PinnedItem key={`${v.id}:${v.name}`} pinned={v}>
                {state.status === "ready" ? (
                  <RunView spec={v.spec} ctx={state.ctx} title={v.name} headingLevel={3} />
                ) : (
                  <p className={ui.hint} role="status">
                    {state.status === "loading" ? "Un attimo…" : "Non riesco a leggere i dati del telefono."}
                  </p>
                )}
              </PinnedItem>
            ))
          }
        </ViewContextGate>
      )}
    </section>
  );
}

function PinnedItem({ pinned, children }: { pinned: PinnedView; children: ReactNode }) {
  const id = useId();
  const [name, setName] = useState(pinned.name);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setError(null);
    try {
      await action();
    } catch {
      setError("Non sono riuscito a salvare la modifica.");
    }
  }

  return (
    <div className={styles.pinnedItem}>
      {children}
      {pinned.question ? <p className={ui.hint}>Domanda: «{pinned.question}»</p> : null}
      <form
        className={styles.pinnedTools}
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => renamePinnedView(pinned.id, name));
        }}
      >
        <label className={ui.srOnly} htmlFor={`${id}-name`}>
          Nome della vista
        </label>
        <input id={`${id}-name`} className={`${ui.input} ${styles.renameInput}`} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="outline" disabled={name.trim() === "" || name.trim() === pinned.name}>
          Rinomina
        </Button>
        <Button variant="text" onClick={() => void run(() => removePinnedView(pinned.id))}>
          Rimuovi
        </Button>
      </form>
      {error ? (
        <p className={ui.hint} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
