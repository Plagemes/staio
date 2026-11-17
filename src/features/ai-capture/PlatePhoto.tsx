"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent } from "react";
import { isAiError } from "@/core/ai";
import { PLATE_MIN_CONFIDENCE, type PlatePhotoDraft } from "@/core/ai/platePhotoParse";
import { activeLots } from "@/core/ledger";
import { usePantry } from "@/data";
import { Button } from "@/design";
import { IMAGE_ERROR_MESSAGES, ImageError, PANTRY_IMAGE_LIMITS, prepareImage, type PreparedImage } from "../ai/image";
import { describeAiError } from "../ai/messages";
import { NotReady } from "../ai/NotReady";
import { activeModel, configIssue, dexieSettingsStore, type AiSettings } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import { evaluateLots } from "../lots";
import { suggestMealKind } from "../meals";
import { createFoodSearch } from "../nutrition/candidates";
import { useFoods } from "../nutrition/useNutrition";
import { LoadingLine, StorageError } from "../shell/EmptyState";
import ui from "../ui.module.css";
import { useNow } from "../useNow";
import { ReadInfo, SendNotice } from "./AiNotices";
import styles from "./AiCapture.module.css";
import { AiHead, MealDraftReview } from "./MealDraftReview";
import { rowsFromPlate, type DraftRow } from "./mealDraft";
import { toPantryTarget } from "./pantryRefs";
import { readPlatePhoto, type CallInfo } from "./reads";

const TITLE = "Pasto dalla foto";

const formatBytes = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1000))} kB`);

export function PlatePhoto() {
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
    return <NotReady issue={issue} title={TITLE} what="stimare un pasto dalla foto del piatto" alternative={{ href: "/app/pasto", label: "Registra a mano" }} />;
  }
  return <Plate settings={settings} />;
}

type Busy = "preparing" | "reading" | null;

interface Outcome {
  draft: PlatePhotoDraft;
  info: CallInfo;
  rows: DraftRow[];
  run: number;
}

function Plate({ settings }: { settings: AiSettings }) {
  const ids = useId();
  const now = useNow();
  const pantry = usePantry();
  const foods = useFoods();
  const abortRef = useRef<AbortController | null>(null);
  const runs = useRef(0);

  const [image, setImage] = useState<PreparedImage | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const entries = useMemo(() => (pantry.data && now ? evaluateLots(activeLots(pantry.data), now) : []), [pantry.data, now]);
  const foodSearch = useMemo(() => (foods ? createFoodSearch(foods) : undefined), [foods]);

  if (pantry.error) return <StorageError />;
  if (!pantry.data || !now) {
    return (
      <div className={ui.screen}>
        <AiHead title={TITLE} />
        <LoadingLine />
      </div>
    );
  }
  const model = activeModel(settings);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file || busy) return;
    setError(null);
    setOutcome(null);
    setBusy("preparing");
    try {
      const prepared = await prepareImage(file, PANTRY_IMAGE_LIMITS);
      setImage(prepared);
      setPreviewUrl(URL.createObjectURL(prepared.blob));
    } catch (e) {
      setImage(null);
      setPreviewUrl(null);
      setError(IMAGE_ERROR_MESSAGES[e instanceof ImageError ? e.kind : "decode"]);
    } finally {
      setBusy(null);
    }
  }

  async function onRead() {
    if (!image || busy) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setOutcome(null);
    setBusy("reading");
    try {
      const target = toPantryTarget(entries);
      const out = await readPlatePhoto({ store: dexieSettingsStore(), image: image.image, target, signal: controller.signal });
      runs.current += 1;
      setOutcome({ ...out, rows: rowsFromPlate(out.draft, target), run: runs.current });
    } catch (e) {
      setError(isAiError(e) ? describeAiError(e, { provider: settings.provider, model }) : "La lettura non è riuscita. Riprova.");
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }

  function startOver() {
    setOutcome(null);
    setImage(null);
    setPreviewUrl(null);
    setError(null);
  }

  if (outcome) {
    const questions = outcome.rows.filter((r) => r.question).length;
    return (
      <div className={ui.screen}>
        <AiHead title={TITLE} />
        <MealDraftReview
          key={outcome.run}
          source="photo"
          initialKind={suggestMealKind(new Date().toISOString())}
          initialRows={outcome.rows}
          entries={entries}
          foodSearch={foodSearch}
          sourceNoun="foto"
          restartLabel="Un'altra foto"
          onRestart={startOver}
          leftovers={outcome.draft.unrecognized}
          banner={
            <div className={ui.callout} role="note">
              <p className={ui.paragraph}>
                <strong>Sono stime dalla foto, non misure.</strong> Le quantità sono a occhio e ognuna mostra il suo intervallo. Una foto non dice cosa c&apos;è dentro un impasto, né olio, sale o burro di
                cottura: aggiungili tu se servono.
                {questions > 0
                  ? ` ${questions === 1 ? "Una voce è" : `${questions} voci sono`} sotto il ${Math.round(PLATE_MIN_CONFIDENCE * 100)}% di certezza: ${questions === 1 ? "la trovi" : "le trovi"} come domanda, non spuntata.`
                  : ""}
              </p>
              <ReadInfo info={outcome.info} problems={outcome.draft.problems} />
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className={ui.screen}>
      <AiHead title={TITLE} />
      <p className={ui.lead}>
        Fotografa il piatto: ti propongo che cosa c&apos;è e quanto, con un intervallo, perché da una foto la quantità è sempre una stima. Tu rivedi ogni voce prima che entri nel registro.
      </p>

      <SendNotice settings={settings} sends="La foto del piatto (ridotta sul telefono) e l'elenco della tua dispensa (nomi e quantità)" now={now} />

      <div className={styles.pick}>
        <label className={styles.file}>
          <input type="file" accept="image/*" capture="environment" onChange={onFile} disabled={busy !== null} />
          <span>{image ? "Scatta un'altra foto" : "Scatta una foto"}</span>
        </label>
        <label className={styles.file}>
          <input type="file" accept="image/*" onChange={onFile} disabled={busy !== null} />
          <span>Scegli un&apos;immagine</span>
        </label>
      </div>
      {busy === "preparing" ? (
        <p className={ui.hint} role="status">
          Preparo la foto…
        </p>
      ) : null}

      {image && previewUrl ? (
        <div className={styles.previewBox}>
          {/* anteprima locale dell'immagine appena ridotta: non passa da next/image */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className={styles.preview} src={previewUrl} alt="Anteprima della foto del piatto che verrà inviata" />
          <p className={ui.hint}>
            {image.width} × {image.height} px, {formatBytes(image.blob.size)} (originale {formatBytes(image.originalBytes)}). Se nella foto ci sono persone o dati personali, riprendi solo il piatto.
          </p>
        </div>
      ) : null}

      {image ? (
        <div className={ui.row} id={`${ids}-actions`}>
          <Button onClick={onRead} disabled={busy !== null}>
            {busy === "reading" ? "Guardo il piatto…" : "Stima il pasto"}
          </Button>
          {busy === "reading" ? (
            <Button variant="outline" onClick={() => abortRef.current?.abort()}>
              Annulla
            </Button>
          ) : null}
        </div>
      ) : null}
      {busy === "reading" ? (
        <p className={ui.hint} role="status">
          Può volerci mezzo minuto. La foto è in viaggio verso il fornitore.
        </p>
      ) : null}
      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
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
