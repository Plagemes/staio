"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Button, Tabs } from "@/design";
import ui from "../ui.module.css";
import { formFromDraft } from "./form";
import {
  draftFromExtracted,
  draftFromText,
  draftIsEmpty,
  draftSummary,
  importFromUrl,
  type ImportDraft,
} from "./importDraft";
import { RecipeEditor } from "./RecipeEditor";
import styles from "./recipes.module.css";

type Via = "url" | "text" | "media";

const TABS = [
  { id: "url", label: "Indirizzo" },
  { id: "text", label: "Testo" },
  { id: "media", label: "Foto o video" },
];

const PERSONAL_USE = "Una ricetta importata resta sul tuo telefono, per uso personale: Staio non la ripubblica né la condivide.";

/** Pagina senza dati strutturati: testo ripulito da far leggere alla lettura da testo. */
interface PageText {
  url: string;
  title?: string;
  text: string;
}

export function Import() {
  const [via, setVia] = useState<Via>("url");
  const [draft, setDraft] = useState<{ value: ImportDraft; key: number } | null>(null);
  const counter = useRef(0);

  function openDraft(value: ImportDraft) {
    counter.current += 1;
    setDraft({ value, key: counter.current });
  }

  // il modulo parte una volta sola per bozza: le correzioni dell'utente non vengono mai riscritte
  const initial = useMemo(() => (draft ? formFromDraft(draft.value) : undefined), [draft]);

  if (draft && initial) {
    return (
      <RecipeEditor
        key={draft.key}
        initial={initial}
        certainty="estimated"
        title="Rivedi la bozza"
        saveLabel="Salva nel ricettario"
        leftovers={draft.value.leftovers}
        banner={
          <div className={ui.callout} role="note">
            <p className={ui.paragraph}>
              <strong>È una bozza: non è ancora salvata.</strong> {draftSummary(draft.value)}{" "}
              {draft.value.via === "page"
                ? "Letta dai dati che la pagina dichiara per le ricette."
                : "Letta da un testo: controlla bene quantità e passi."}
            </p>
            {draft.value.description ? <p className={ui.hint}>{draft.value.description}</p> : null}
            <p className={ui.hint}>
              {PERSONAL_USE} La fonte è già nei campi in fondo: lasciala, serve a ritrovare da dove viene.
            </p>
            <div>
              <Button variant="text" onClick={() => setDraft(null)}>
                Scarta la bozza e ricomincia
              </Button>
            </div>
          </div>
        }
      />
    );
  }

  return (
    <div className={ui.screen}>
      <div className={ui.head}>
        <h1 className={ui.title}>Importa</h1>
      </div>
      <p className={ui.lead}>Porta qui una ricetta. Prima di salvarla la rivedi e la correggi.</p>

      <div>
        <Tabs label="Da dove" items={TABS} value={via} onChange={(id) => setVia(id as Via)} />
        <div role="tabpanel" aria-label={TABS.find((t) => t.id === via)?.label} className={ui.section}>
          {via === "url" ? <FromUrl onDraft={openDraft} /> : via === "text" ? <FromText onDraft={openDraft} /> : <FromMedia />}
        </div>
      </div>

      <p className={ui.hint}>{PERSONAL_USE}</p>
      <Link href="/app/ricette" className={ui.textLink}>
        Torna al ricettario
      </Link>
    </div>
  );
}

function FromUrl({ onDraft }: { onDraft: (d: ImportDraft) => void }) {
  const ids = useId();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState<PageText | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setPage(null);
    const abort = new AbortController();
    controller.current = abort;
    try {
      const outcome = await importFromUrl(url, {
        fetch: (input, init) => fetch(input, init),
        online: typeof navigator === "undefined" ? true : navigator.onLine,
        signal: abort.signal,
      });
      if (abort.signal.aborted) return;
      if (outcome.kind === "error") setError(outcome.message);
      else if (outcome.kind === "recipe") onDraft(draftFromExtracted(outcome.recipe, outcome.url));
      else setPage({ url: outcome.url, text: outcome.text, ...(outcome.title ? { title: outcome.title } : {}) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className={ui.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-url`}>
          Indirizzo della pagina
        </label>
        <input
          id={`${ids}-url`}
          className={ui.input}
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
        />
        <p className={ui.hint}>
          La pagina viene letta dal nostro servizio, che non salva niente. Servono la rete e un indirizzo che comincia con https.
        </p>
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? "Leggo la pagina…" : "Leggi la pagina"}
      </Button>
      {busy ? (
        <Button variant="text" onClick={() => controller.current?.abort()}>
          Annulla
        </Button>
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {page ? (
        <PageTextBox
          page={page}
          onRead={(text) => {
            const d = draftFromText(text, { url: page.url, ...(page.title ? { title: page.title } : {}) });
            if (draftIsEmpty(d)) setError("Neanche dal testo riesco a ricavare una ricetta. Prova a incollare solo la parte con ingredienti e passi.");
            else onDraft(d);
          }}
        />
      ) : null}
    </form>
  );
}

function PageTextBox({ page, onRead }: { page: PageText; onRead: (text: string) => void }) {
  const ids = useId();
  const [text, setText] = useState(page.text);
  return (
    <div className={ui.field}>
      <p className={ui.callout} role="status">
        Questa pagina non descrive la ricetta in forma strutturata. Ecco il testo che ho ricavato: togli quello che non serve, poi
        leggilo come ricetta. Il risultato sarà una bozza da rivedere.
      </p>
      <label className={ui.fieldLabel} htmlFor={`${ids}-txt`}>
        Testo della pagina
      </label>
      {/* Testo semplice in un campo: mai interpretato come HTML */}
      <textarea id={`${ids}-txt`} className={styles.textareaTall} value={text} onChange={(e) => setText(e.target.value)} />
      <div>
        <Button variant="outline" onClick={() => onRead(text)}>
          Leggi questo testo come ricetta
        </Button>
      </div>
    </div>
  );
}

function FromText({ onDraft }: { onDraft: (d: ImportDraft) => void }) {
  const ids = useId();
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [author, setAuthor] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (text.trim() === "") {
      setError("Incolla prima il testo della ricetta.");
      return;
    }
    const trimmedUrl = url.trim();
    if (trimmedUrl !== "" && !/^https?:\/\/\S+$/i.test(trimmedUrl)) {
      setError("L'indirizzo della fonte deve cominciare con http:// o https://.");
      return;
    }
    const draft = draftFromText(text, { ...(trimmedUrl !== "" ? { url: trimmedUrl } : {}), ...(author.trim() !== "" ? { author } : {}) });
    if (draftIsEmpty(draft)) {
      setError("Non ho trovato né ingredienti né passi. Controlla che il testo abbia gli elenchi «Ingredienti» e «Preparazione».");
      return;
    }
    onDraft(draft);
  }

  return (
    <form
      className={ui.form}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className={ui.field}>
        <label className={ui.fieldLabel} htmlFor={`${ids}-text`}>
          Testo della ricetta
        </label>
        <textarea
          id={`${ids}-text`}
          className={styles.textareaTall}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
          placeholder={"Pasta al pomodoro\nPorzioni: 4\nIngredienti\n320 g spaghetti\n400 ml passata\nPreparazione\nCuoci la pasta per 10 minuti."}
        />
        <p className={ui.hint}>Funziona anche senza rete. Riconosco titolo, porzioni, tempi, ingredienti e passi.</p>
      </div>
      <fieldset className={ui.field}>
        <legend className={ui.fieldLabel}>
          Fonte <span className={ui.optional}>(facoltativa, ma conviene)</span>
        </legend>
        <label className={ui.hint} htmlFor={`${ids}-url`}>
          Indirizzo
        </label>
        <input id={`${ids}-url`} className={ui.input} type="url" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" autoComplete="off" />
        <label className={ui.hint} htmlFor={`${ids}-author`}>
          Autore
        </label>
        <input id={`${ids}-author`} className={ui.input} type="text" value={author} onChange={(e) => setAuthor(e.target.value)} autoComplete="off" />
      </fieldset>
      <Button type="submit">Leggi il testo</Button>
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}

function FromMedia() {
  return (
    <div className={ui.empty}>
      <h2 className={ui.emptyTitle}>Da foto o da video</h2>
      <p className={ui.emptyText}>
        Dalla foto non ancora: per ora puoi scrivere o incollare il testo della ricetta, oppure importarla da un indirizzo.
      </p>
      <p className={ui.emptyText}>
        Un video si può condividere all&apos;app dal telefono: scegli «Condividi» e poi Staio. Qui compare ciò che arriva, e puoi
        anche <Link href="/app/ricette/condivisa" className={ui.textLink}>aprire la pagina dei contenuti condivisi</Link>.
      </p>
      <p className={ui.emptyText}>
        Per leggere i video serve un servizio di estrazione:{" "}
        <Link href="/app/impostazioni/video" className={ui.textLink}>
          impostalo qui
        </Link>
        .
      </p>
    </div>
  );
}
