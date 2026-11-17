"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { isAiError, type FitLimits } from "@/core/ai";
import type { ExpiryOption, ExpiryReading } from "@/core/ai/expiryDateParse";
import { Button, Value } from "@/design";
import { IMAGE_ERROR_MESSAGES, ImageError, prepareImage } from "../ai/image";
import { describeAiError } from "../ai/messages";
import { activeModel, configIssue, dexieSettingsStore, destinationHost } from "../ai/settings";
import { useAiSettings } from "../ai/useAiSettings";
import { EXPIRY_KIND_LABELS, type ChosenExpiryKind } from "../labels";
import ui from "../ui.module.css";
import styles from "./AiCapture.module.css";
import { ReadInfo } from "./AiNotices";
import { readExpiryDate, type CallInfo } from "./reads";

/** Una data stampata è piccola ma nitida: bastano meno pixel di uno scontrino. */
const EXPIRY_IMAGE_LIMITS: FitLimits = { maxSide: 1600, maxPixels: 1_500_000 };

interface Props {
  /** Oggi, `YYYY-MM-DD`. */
  today: string | null;
  /** Il tipo di data scelto nel modulo adesso. */
  currentKind: ChosenExpiryKind | "none";
  /** Riempie il campo del modulo. Non salva nulla: l'utente vede la data e poi conferma lui. `kind` è null se non si capisce. */
  onPick: (date: string, kind: ChosenExpiryKind | null) => void;
}

/**
 * «Leggi la data dalla foto», accanto al campo «Scadenza». Compare solo con una chiave per l'intelligenza artificiale.
 * La data letta riempie il campo e dice da dove viene; se la foto è ambigua (formato, più date) si chiede quale.
 */
export function ExpiryFromPhoto({ today, currentKind, onPick }: Props) {
  const { settings, ready } = useAiSettings();
  const abortRef = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState<"preparing" | "reading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ reading: ExpiryReading; info: CallInfo } | null>(null);
  const [applied, setApplied] = useState<ExpiryOption | null>(null);
  const [pending, setPending] = useState<ExpiryOption | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (!ready || configIssue(settings) !== null || today === null) return null;
  const model = activeModel(settings);

  function apply(option: ExpiryOption) {
    // senza un tipo di data scelto il campo non si vede: se la foto non dice qual è, lo si chiede
    if (option.kind === "unclear" && currentKind === "none") {
      setPending(option);
      setApplied(null);
      return;
    }
    setPending(null);
    setApplied(option);
    onPick(option.date, option.kind === "unclear" ? null : option.kind);
  }

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file || busy || today === null) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setOutcome(null);
    setApplied(null);
    setPending(null);
    setBusy("preparing");
    try {
      const prepared = await prepareImage(file, EXPIRY_IMAGE_LIMITS);
      setBusy("reading");
      const out = await readExpiryDate({ store: dexieSettingsStore(), image: prepared.image, today, signal: controller.signal });
      setOutcome(out);
      // una sola data possibile: riempie il campo, e resta visibile da controllare
      if (out.reading.options.length === 1) apply(out.reading.options[0]);
    } catch (e) {
      setError(
        e instanceof ImageError
          ? IMAGE_ERROR_MESSAGES[e.kind]
          : isAiError(e)
            ? describeAiError(e, { provider: settings.provider, model })
            : "La lettura non è riuscita. Riprova.",
      );
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  }

  const reading = outcome?.reading;
  const choosing = reading !== undefined && reading.options.length > 1 && applied === null;
  const question =
    reading?.question === "format"
      ? `«${reading.options[0].printed}» si può leggere in più modi. Quale è giusto?`
      : reading?.question === "dates"
        ? "Nella foto ci sono più date. Quale è la scadenza?"
        : "Ho trovato più date, o più modi di leggerle. Quale è la scadenza?";

  return (
    <div className={styles.inline}>
      <div className={styles.pick}>
        <label className={styles.file}>
          <input type="file" accept="image/*" capture="environment" onChange={onFile} disabled={busy !== null} />
          <span>{busy === "preparing" ? "Preparo la foto…" : busy === "reading" ? "Leggo la data…" : "Leggi la data dalla foto"}</span>
        </label>
        {busy === "reading" ? (
          <Button variant="outline" onClick={() => abortRef.current?.abort()}>
            Annulla
          </Button>
        ) : null}
      </div>
      <p className={ui.hint}>
        All&apos;intelligenza artificiale ({destinationHost(settings)}) va solo la foto, ridotta sul telefono, e la richiesta. Fotografa solo la data.
      </p>

      {error ? (
        <p className={ui.error} role="alert">
          {error}
        </p>
      ) : null}

      {reading && reading.options.length === 0 ? (
        <>
          {reading.problems.map((p, i) => (
            <p key={`${p.code}-${i}`} className={styles.warn} role="status">
              {p.message}
            </p>
          ))}
        </>
      ) : null}

      {reading && choosing ? (
        <>
          <p className={ui.paragraph} role="status">
            {question}
          </p>
          <ul className={styles.choices}>
            {reading.options.map((o) => (
              <li key={o.id}>
                <button type="button" className={styles.choice} onClick={() => apply(o)}>
                  <span>
                    <Value certainty="label">{o.readAs}</Value>
                  </span>
                  <span className={styles.choiceMeta}>
                    stampata «{o.printed}»{o.kind === "unclear" ? "" : `, ${EXPIRY_KIND_LABELS[o.kind].toLowerCase()}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {pending ? (
        <>
          <p className={ui.paragraph} role="status">
            Ho letto <Value certainty="label">{pending.readAs}</Value>, ma sulla confezione non si capisce che tipo di data sia. Quale è?
          </p>
          <div className={ui.row}>
            {(["use_by", "best_before"] as const).map((k) => (
              <Button
                key={k}
                variant="outline"
                onClick={() => {
                  setApplied(pending);
                  setPending(null);
                  onPick(pending.date, k);
                }}
              >
                {EXPIRY_KIND_LABELS[k]}
              </Button>
            ))}
          </div>
        </>
      ) : null}

      {applied ? (
        <div role="status" className={styles.inline}>
          <p className={ui.paragraph}>
            Letta dalla foto: <Value certainty="label">{applied.readAs}</Value> (stampata «{applied.printed}»). L&apos;ho messa nel campo: controllala, non è ancora salvata.
          </p>
          {applied.kind === "unclear" && currentKind !== "none" ? (
            <p className={styles.warn}>Sulla confezione non si capisce se è «da consumare entro» o «preferibilmente entro»: ho lasciato «{EXPIRY_KIND_LABELS[currentKind].toLowerCase()}».</p>
          ) : null}
          {applied.problems.map((p, i) => (
            <p key={`${p.code}-${i}`} className={p.severity === "info" ? ui.hint : styles.warn}>
              {p.message}
            </p>
          ))}
          {reading && reading.options.length > 1 ? (
            <Button variant="text" onClick={() => setApplied(null)}>
              Scegli un&apos;altra lettura
            </Button>
          ) : null}
        </div>
      ) : null}

      {reading && reading.discarded.length > 0 ? (
        <ul className={ui.bullets}>
          {reading.discarded.map((d, i) => (
            <li key={`${d.printed}-${i}`} className={ui.hint}>
              {d.message}
            </li>
          ))}
        </ul>
      ) : null}

      {outcome ? <ReadInfo info={outcome.info} problems={[]} /> : null}
    </div>
  );
}
