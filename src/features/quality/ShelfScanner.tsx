"use client";

// Lettura continua del codice a barre. Riusa le funzioni della cattura (apertura della fotocamera, lettore,
// messaggi) ma non il suo componente: quello si ferma al primo codice, qui la fotocamera resta accesa e ogni
// codice nuovo arriva a `onCode`. Lo stesso codice non si ripete finché resta davanti all'obiettivo.
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { validateBarcode } from "@/core/catalog";
import { Button } from "@/design";
import { CAMERA_MESSAGES, cameraAvailability, classifyCameraError, openRearCamera, stopStream, type CameraProblem } from "../barcode/camera";
import { createCodeReader } from "../barcode/detector";
import { BARCODE_PROBLEM_MESSAGES } from "../barcode/messages";
import ui from "../ui.module.css";
import styles from "./quality.module.css";

type Phase = "idle" | "starting" | "scanning";

const SCAN_INTERVAL_MS = 180;
const REPEAT_BLOCK_MS = 6000;

interface ShelfScannerProps {
  /** Un codice già validato (cifra di controllo compresa). Arriva anche per quelli digitati. */
  onCode: (code: string) => void;
}

export function ShelfScanner({ onCode }: ShelfScannerProps) {
  const ids = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<CameraProblem | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef(0);
  const recentRef = useRef(new Map<string, number>());
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
            const now = Date.now();
            for (const item of found) {
              const check = validateBarcode(item.rawValue);
              if (!check.ok) continue;
              const last = recentRef.current.get(check.code);
              recentRef.current.set(check.code, now);
              if (last !== undefined && now - last < REPEAT_BLOCK_MS) continue;
              navigator.vibrate?.(40);
              onCodeRef.current(check.code);
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
    setManual("");
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
            Inquadra un codice dopo l&apos;altro: la fotocamera resta accesa e ogni prodotto nuovo finisce nello storico qui sotto.
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
              Ferma la lettura
            </Button>
          ) : (
            <Button onClick={() => void start()}>Avvia la lettura continua</Button>
          )}
        </div>
      </section>

      <form className={ui.form} onSubmit={submitManual} noValidate>
        <div className={ui.field}>
          <label className={ui.fieldLabel} htmlFor={`${ids}-code`}>
            Oppure scrivi le cifre del codice
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
            aria-describedby={manualError ? `${ids}-code-error` : undefined}
            placeholder="8076800195057"
          />
          {manualError ? (
            <p className={ui.error} id={`${ids}-code-error`}>
              {manualError}
            </p>
          ) : null}
        </div>
        <Button type="submit" variant="outline">
          Valuta il prodotto
        </Button>
      </form>
    </div>
  );
}
