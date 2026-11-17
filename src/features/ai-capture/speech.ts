"use client";

// Dettatura con il riconoscimento vocale del browser, solo dove c'è. Dove manca resta il campo di testo, che funziona
// anche con la dettatura della tastiera. Il testo dettato finisce nel campo: l'utente lo rilegge prima di inviarlo.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

interface ResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface ResultEventLike {
  resultIndex: number;
  results: ArrayLike<ResultLike>;
}
interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: ResultEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => RecognitionLike;

export function recognitionCtor(): RecognitionCtor | undefined {
  if (typeof window === "undefined") return undefined;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const noSubscription = () => () => {};
const isSupported = () => recognitionCtor() !== undefined;

export const DICTATION_ERRORS: Record<string, string> = {
  "not-allowed": "Il microfono non è consentito. Scrivi la frase, o usa la dettatura della tastiera.",
  "service-not-allowed": "Il riconoscimento vocale del browser non è consentito. Scrivi la frase, o usa la dettatura della tastiera.",
  "no-speech": "Non ho sentito niente. Riprova, o scrivi la frase.",
  "audio-capture": "Non trovo il microfono. Scrivi la frase, o usa la dettatura della tastiera.",
  network: "La dettatura del browser non è raggiungibile. Scrivi la frase, o usa la dettatura della tastiera.",
};

export function useDictation(onText: (text: string) => void): {
  supported: boolean;
  listening: boolean;
  error: string | null;
  start: () => void;
  stop: () => void;
} {
  const supported = useSyncExternalStore(noSubscription, isSupported, () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recognition = useRef<RecognitionLike | null>(null);
  const latest = useRef(onText);

  useEffect(() => {
    latest.current = onText;
  }, [onText]);
  useEffect(() => () => recognition.current?.abort(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || recognition.current) return;
    setError(null);
    const r = new Ctor();
    r.lang = "it-IT";
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (event) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) text += event.results[i][0].transcript;
      }
      if (text.trim() !== "") latest.current(text.trim());
    };
    r.onerror = (event) => setError(DICTATION_ERRORS[event.error ?? ""] ?? "La dettatura non è riuscita. Scrivi la frase.");
    r.onend = () => {
      recognition.current = null;
      setListening(false);
    };
    recognition.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      recognition.current = null;
      setError("La dettatura non è riuscita. Scrivi la frase.");
    }
  }, []);

  const stop = useCallback(() => recognition.current?.stop(), []);
  return { supported, listening, error, start, stop };
}
