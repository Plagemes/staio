"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { formatCost, isAiError } from "@/core/ai";
import { APP_NAME } from "@/config";
import { Button, Label, SectionHeader } from "@/design";
import { describeAiError } from "../ai/messages";
import { activeModel, configIssue, dexieSettingsStore } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import { formFromDraft } from "../recipes/form";
import { draftSummary, type ImportDraft } from "../recipes/importDraft";
import { RecipeEditor } from "../recipes/RecipeEditor";
import ui from "../ui.module.css";
import { readVideo } from "./analyze";
import { captionHasRecipe, draftFromCaption, draftFromReading } from "./draft";
import { PLATFORM_LABELS, hasSharedContent, readShared, videoPlatform, type SharedContent } from "./links";
import { SERVICE_MESSAGES, extractVideo } from "./serviceClient";
import { isConfigured, serviceHost } from "./settings";
import { useVideoService } from "./useVideoService";
import styles from "./videoRecipes.module.css";

const PERSONAL_USE = `Una ricetta importata resta sul tuo telefono, per uso personale: ${APP_NAME} non la ripubblica né la condivide.`;
const NOT_A_RECIPE = "Dal video non è uscita una ricetta leggibile. Puoi incollare qui sotto la didascalia.";

export function SharedRecipe() {
  const params = useSearchParams();
  const shared = useMemo(() => readShared(params), [params]);
  // un'altra condivisione ricomincia da zero
  return <SharedBody key={params.toString()} shared={shared} />;
}

interface Opened {
  value: ImportDraft;
  key: number;
  via: "caption" | "video";
  /** Avvisi e punti incerti, per chi rivede. */
  notes: string[];
  /** Frase sul costo della lettura, se c'è stata una chiamata. */
  cost?: string;
}

type Busy = "extracting" | "reading" | null;

function SharedBody({ shared }: { shared: SharedContent }) {
  const ids = useId();
  const { settings: ai, ready: aiReady } = useAiSettings();
  const { service, ready: serviceReady } = useVideoService();
  const [text, setText] = useState(shared.caption);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const platform = shared.link ? videoPlatform(shared.link) : undefined;

  // Se il testo condiviso contiene già la ricetta, la bozza è pronta senza altri passaggi.
  const automatic = useMemo<Opened | null>(() => {
    if (!captionHasRecipe(shared.caption)) return null;
    const draft = draftFromCaption(shared.caption, shared.link);
    return draft ? { value: draft, key: 0, via: "caption", notes: [] } : null;
  }, [shared]);
  const shown = opened ?? (dismissed ? null : automatic);
  const initial = useMemo(() => (shown ? formFromDraft(shown.value) : undefined), [shown]);

  function open(value: ImportDraft, via: Opened["via"], notes: string[], cost?: string) {
    counter.current += 1;
    setOpened({ value, key: counter.current, via, notes, ...(cost ? { cost } : {}) });
  }

  function readPasted() {
    setError(null);
    if (text.trim() === "") {
      setError("Incolla prima la didascalia o il testo della ricetta.");
      return;
    }
    const draft = draftFromCaption(text, shared.link);
    if (!draft) {
      setError("Non ho trovato né ingredienti né passi. Controlla che il testo abbia gli elenchi «Ingredienti» e «Preparazione».");
      return;
    }
    open(draft, "caption", []);
  }

  async function readFromVideo() {
    if (busy || !shared.link || !platform) return;
    setError(null);
    const abort = new AbortController();
    abortRef.current = abort;
    setBusy("extracting");
    try {
      const extracted = await extractVideo(shared.link, service, {
        fetch: (input, init) => fetch(input, init),
        online: typeof navigator === "undefined" ? true : navigator.onLine,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (!extracted.ok) {
        setError(extracted.message);
        return;
      }
      const { video } = extracted;

      // Se la ricetta è già scritta nella didascalia non serve l'intelligenza artificiale: niente costo.
      if (captionHasRecipe(video.caption)) {
        const draft = draftFromCaption(video.caption, shared.link);
        if (draft) {
          open(draft, "caption", ["La ricetta era scritta nella didascalia del video: non ho usato l'intelligenza artificiale, quindi niente costo."]);
          return;
        }
      }

      setBusy("reading");
      const result = await readVideo({ store: dexieSettingsStore(), video, signal: abort.signal });
      if (abort.signal.aborted) return;
      const drafted = draftFromReading(result.reading, shared.link);
      if (!drafted) {
        setError(NOT_A_RECIPE);
        return;
      }
      const cost =
        result.cost === null
          ? "Il costo non è noto: nel listino non c'è il prezzo di questo modello."
          : `Costo stimato della lettura: ${formatCost(result.cost, result.currency)}${result.usageEstimated ? " (il fornitore non ha dichiarato i token: è una stima prudente)" : ""}.`;
      open(drafted.draft, "video", drafted.notes, cost);
    } catch (e) {
      if (abort.signal.aborted) return;
      setError(isAiError(e) ? describeAiError(e, { provider: ai.provider, model: activeModel(ai) }) : "La lettura non è riuscita. Riprova.");
    } finally {
      setBusy(null);
    }
  }

  if (shown && initial) {
    return (
      <RecipeEditor
        key={shown.key}
        initial={initial}
        certainty="estimated"
        title="Rivedi la bozza"
        saveLabel="Salva nel ricettario"
        leftovers={shown.value.leftovers}
        banner={
          <div className={ui.callout} role="note">
            <p className={ui.paragraph}>
              <strong>È una bozza: non è ancora salvata.</strong> {draftSummary(shown.value)}{" "}
              {shown.via === "video"
                ? "Letta dal video con la tua chiave di intelligenza artificiale, da didascalia, parlato e immagini: controlla bene quantità e passi."
                : "Letta dal testo condiviso: controlla bene quantità e passi."}
            </p>
            {shown.notes.length > 0 ? (
              <>
                <p className={ui.hint}>Da controllare:</p>
                <ul className={styles.notes}>
                  {shown.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </>
            ) : null}
            {shown.cost ? <p className={ui.hint}>{shown.cost}</p> : null}
            <p className={ui.hint}>
              {PERSONAL_USE} La fonte è già nei campi in fondo: lasciala, serve a ritrovare da dove viene.
            </p>
            <div>
              <Button
                variant="text"
                onClick={() => {
                  setOpened(null);
                  setDismissed(true);
                }}
              >
                Scarta la bozza e ricomincia
              </Button>
            </div>
          </div>
        }
      />
    );
  }

  if (!hasSharedContent(shared)) {
    return (
      <div className={ui.screen}>
        <div className={ui.head}>
          <h1 className={ui.title}>Condiviso con {APP_NAME}</h1>
        </div>
        <div className={ui.empty}>
          <h2 className={ui.emptyTitle}>Non è arrivato niente</h2>
          <p className={ui.emptyText}>
            Da un video o da una pagina scegli «Condividi» e poi {APP_NAME}: qui compare ciò che arriva. Puoi anche portare una ricetta
            a mano.
          </p>
          <div className={ui.row}>
            <Button href="/app/ricette/importa">Importa una ricetta</Button>
            <Button href="/app/ricette" variant="outline">
              Torna al ricettario
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const aiIssue = aiReady ? configIssue(ai) : null;
  const configured = isConfigured(service);
  const hasCaption = shared.caption.trim() !== "";
  // un solo pieno per schermata: «Leggi il video» se è offerto, altrimenti «Leggi il testo»
  const videoOffered = shared.link !== undefined && platform !== undefined && serviceReady && configured && aiIssue === null;

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Condiviso con {APP_NAME}</h1>
        <Label>{platform ? PLATFORM_LABELS[platform] : "Condiviso"}</Label>
      </div>
      <p className={ui.lead}>Ecco cosa è arrivato. Prima di salvare qualsiasi ricetta la rivedi e la correggi tu.</p>

      <div className={styles.received}>
        {shared.title !== "" ? <p className={styles.receivedTitle}>{shared.title}</p> : null}
        {shared.link ? (
          <p className={ui.paragraph}>
            <a className={styles.link} href={shared.link} target="_blank" rel="noopener noreferrer">
              {shared.link}
            </a>
          </p>
        ) : (
          <p className={ui.hint}>Nessun indirizzo: è arrivato solo del testo.</p>
        )}
        {hasCaption ? <p className={ui.hint}>Il testo condiviso è qui sotto, da rivedere.</p> : null}
      </div>

      {shared.link ? (
        <section className={ui.section} aria-labelledby={`${ids}-video`}>
          <SectionHeader label="Leggere il video" />
          <div className={styles.block} id={`${ids}-video`}>
            {!platform ? (
              <>
                <p className={ui.paragraph}>
                  Questo indirizzo non è un video di Instagram, TikTok o YouTube, quindi non so leggerlo come video. Se è una pagina con
                  una ricetta, puoi importarla dall&apos;indirizzo.
                </p>
                <Button href={`/app/ricette/importa?url=${encodeURIComponent(shared.link)}`} variant="outline">
                  Importa da un indirizzo
                </Button>
              </>
            ) : !serviceReady ? (
              <p className={ui.hint} role="status">
                Un attimo…
              </p>
            ) : !configured ? (
              <>
                <p className={ui.callout} role="status">
                  {SERVICE_MESSAGES.not_configured}
                </p>
                <Link href="/app/impostazioni/video" className={ui.textLink}>
                  Imposta il servizio di estrazione
                </Link>
              </>
            ) : aiIssue !== null ? (
              <>
                <p className={ui.callout} role="status">
                  {aiIssue === "missing_key"
                    ? "Per leggere il video serve la tua chiave di intelligenza artificiale: il servizio scarica il video, ma l'analisi la fa il telefono. Intanto puoi incollare qui la didascalia."
                    : "Le impostazioni dell'intelligenza artificiale sono incomplete: correggile per leggere il video. Intanto puoi incollare qui la didascalia."}
                </p>
                <Link href="/app/impostazioni/ai" className={ui.textLink}>
                  Vai alle impostazioni dell&apos;intelligenza artificiale
                </Link>
              </>
            ) : (
              <>
                <p className={ui.paragraph}>
                  Il link va al tuo servizio di estrazione ({serviceHost(service.url)}), che scarica il video e ne prende didascalia e alcune
                  immagini. Poi le legge il telefono, con la tua chiave: costa qualche centesimo e conta nel tetto di spesa.
                </p>
                <div className={ui.row}>
                  <Button onClick={() => void readFromVideo()} disabled={busy !== null || !aiReady}>
                    {busy === "extracting" ? "Scarico il video…" : busy === "reading" ? "Leggo il video…" : "Leggi il video"}
                  </Button>
                  {busy ? (
                    <Button variant="text" onClick={() => abortRef.current?.abort()}>
                      Ferma
                    </Button>
                  ) : null}
                </div>
                {busy ? (
                  <p className={ui.hint} role="status">
                    {busy === "extracting" ? "Può volerci un minuto." : "Sto chiedendo la bozza al fornitore dell'intelligenza artificiale."}
                  </p>
                ) : null}
              </>
            )}
          </div>
        </section>
      ) : null}

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      <section className={ui.section} aria-labelledby={`${ids}-paste`}>
        <SectionHeader label={hasCaption ? "Il testo condiviso" : "Incolla la didascalia"} />
        <div className={styles.block}>
          {hasCaption ? (
            <p className={ui.paragraph}>Non vedo una ricetta completa in questo testo. Puoi correggerlo e leggerlo comunque.</p>
          ) : (
            <p className={ui.paragraph}>Apri il video, copia la didascalia (dove c&apos;è la ricetta) e incollala qui.</p>
          )}
          <form
            className={ui.form}
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              readPasted();
            }}
          >
            <div className={ui.field}>
              <label className={ui.fieldLabel} htmlFor={`${ids}-text`}>
                Didascalia o testo della ricetta
              </label>
              {/* Testo semplice in un campo: mai interpretato come HTML */}
              <textarea
                id={`${ids}-text`}
                className={styles.textarea}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setError(null);
                }}
                placeholder={"Ingredienti\n320 g spaghetti\n400 ml passata\nPreparazione\nCuoci la pasta per 10 minuti."}
              />
              <p className={ui.hint}>Funziona anche senza rete. Il link del video resta salvato come fonte della ricetta.</p>
            </div>
            <Button type="submit" variant={videoOffered ? "outline" : "primary"}>
              Leggi il testo
            </Button>
          </form>
        </div>
      </section>

      <p className={ui.hint}>{PERSONAL_USE}</p>
      <Link href="/app/ricette" className={ui.textLink}>
        Torna al ricettario
      </Link>
    </div>
  );
}
