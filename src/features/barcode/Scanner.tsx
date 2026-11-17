"use client";

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { validateBarcode } from "@/core/catalog";
import { Button } from "@/design";
import ui from "../ui.module.css";
import { CAMERA_MESSAGES, cameraAvailability, classifyCameraError, openRearCamera, stopStream, type CameraProblem } from "./camera";
import { createCodeReader } from "./detector";
import { gtinToRetailCode, parseGs1 } from "./gs1";
import { BARCODE_PROBLEM_MESSAGES } from "./messages";
import styles from "./Scanner.module.css";

type Phase = "idle" | "starting" | "scanning";

const SCAN_INTERVAL_MS = 180;

/** Ciò che un codice GS1 porta oltre al prodotto. */
export interface ScanInfo {
  expiry?: { date: string; kind: "use_by" | "best_before" };
}

interface ScannerProps {
  /** Chiamata una sola volta per lettura, con un codice già validato (cifra di controllo compresa). */
  onCode: (code: string, info?: ScanInfo) => void;
  disabled?: boolean;
  /** Accende la fotocamera appena la scheda compare, senza il tocco su «Leggi il codice». Predefinito: spento. */
  autoStart?: boolean;
}

export function Scanner({ onCode, disabled = false, autoStart = false }: ScannerProps) {
  const ids = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ogni avvio ha un numero: uno stop lo invalida, così un avvio ancora in corso non riaccende nulla.
  const runRef = useRef(0);
  const onCodeRef = useRef(onCode);
  useEffect(() => {
    onCodeRef.current = onCode;
  }, [onCode]);

  const stop = useCallback(() => {
    runRef.current += 1;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  // Fotocamera spenta se si esce dalla pagina o se la pagina passa in secondo piano.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && streamRef.current) {
        stop();
        setPhase("idle");
        setNote("Ho spento la fotocamera perché la pagina è passata in secondo piano.");
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onHidden);
      stop();
    };
  }, [stop]);

  // l'avvio automatico vale solo alla comparsa della scheda
  useEffect(() => {
    if (autoStart && !disabled) void start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    stop();
    setNote(null);
    setProblem(null);
    const unavailable = cameraAvailability();
    if (unavailable) {
      setProblem(unavailable);
      return;
    }
    const run = runRef.current;
    setPhase("starting");

    let stream: MediaStream;
    try {
      stream = await openRearCamera();
    } catch (error) {
      if (runRef.current !== run) return;
      setProblem(classifyCameraError(error));
      setPhase("idle");
      return;
    }
    if (runRef.current !== run) {
      stopStream(stream);
      return;
    }
    streamRef.current = stream;

    const video = videoRef.current;
    if (!video) {
      stop();
      setPhase("idle");
      return;
    }
    video.srcObject = stream;
    try {
      await video.play();
      const reader = await createCodeReader();
      if (runRef.current !== run) return;
      setPhase("scanning");

      const tick = async () => {
        if (runRef.current !== run) return;
        if (video.readyState >= 2) {
          try {
            const found = await reader.detect(video);
            if (runRef.current !== run) return;
            for (const item of found) {
              const check = validateBarcode(item.rawValue);
              if (check.ok) {
                stop();
                setPhase("idle");
                onCodeRef.current(check.code);
                return;
              }
              // GS1 (DataMatrix, GS1-128): il GTIN dà il prodotto, e se c'è la data la porta con sé
              const gs1 = parseGs1(item.rawValue);
              const retail = gs1?.gtin ? gtinToRetailCode(gs1.gtin) : null;
              const fromGs1 = retail ? validateBarcode(retail) : null;
              if (gs1 && fromGs1?.ok) {
                stop();
                setPhase("idle");
                onCodeRef.current(fromGs1.code, gs1.expiry ? { expiry: gs1.expiry } : undefined);
                return;
              }
            }
          } catch {
            // un fotogramma illeggibile non ferma la lettura
          }
        }
        timerRef.current = setTimeout(tick, SCAN_INTERVAL_MS);
      };
      void tick();
    } catch {
      if (runRef.current !== run) return;
      stop();
      setProblem("failed");
      setPhase("idle");
    }
  }

  function close() {
    stop();
    setPhase("idle");
    setNote(null);
  }

  function submitManual(event: FormEvent) {
    event.preventDefault();
    const check = validateBarcode(manual);
    if (!check.ok) {
      setManualError(BARCODE_PROBLEM_MESSAGES[check.reason]);
      return;
    }
    setManualError(null);
    close();
    onCode(check.code);
  }

  const cameraOn = phase !== "idle";

  return (
    <div className={ui.screen}>
      <section className={ui.section} aria-label="Fotocamera">
        <div className={styles.viewport} hidden={!cameraOn}>
          <video ref={videoRef} className={styles.video} muted playsInline aria-label="Anteprima della fotocamera" />
          <div className={styles.reticle} aria-hidden="true" />
          {phase === "starting" ? <p className={styles.overlay}>Apro la fotocamera…</p> : null}
        </div>
        {phase === "scanning" ? (
          <p className={ui.hint} role="status">
            Inquadra il codice a barre, ben illuminato e fermo. Mi fermo al primo che riconosco.
          </p>
        ) : null}

        {problem ? (
          <p className={ui.error} role="alert">
            {CAMERA_MESSAGES[problem]}
          </p>
        ) : null}
        {note ? (
          <p className={ui.hint} role="status">
            {note}
          </p>
        ) : null}

        <div className={ui.row}>
          {cameraOn ? (
            <Button variant="outline" onClick={close}>
              Chiudi la fotocamera
            </Button>
          ) : (
            <Button onClick={() => void start()} disabled={disabled}>
              Leggi con la fotocamera
            </Button>
          )}
        </div>
      </section>

      <form className={ui.form} onSubmit={submitManual} noValidate>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-code`}>
            Oppure scrivi le cifre
          </label>
          <input
            id={`${ids}-code`}
            className={ui.input}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="search"
            value={manual}
            onChange={(e) => {
              setManual(e.target.value);
              if (manualError) setManualError(null);
            }}
            aria-invalid={manualError ? true : undefined}
            aria-describedby={`${ids}-code-hint${manualError ? ` ${ids}-code-error` : ""}`}
            placeholder="8076800195057"
          />
          {manualError ? (
            <p className={ui.error} id={`${ids}-code-error`}>
              {manualError}
            </p>
          ) : null}
          <p className={ui.hint} id={`${ids}-code-hint`}>
            Le cifre sotto le barre: 13 (o 8, o 12 per i prodotti americani).
          </p>
        </div>
        <Button type="submit" variant="outline" disabled={disabled}>
          Cerca il prodotto
        </Button>
      </form>
    </div>
  );
}
