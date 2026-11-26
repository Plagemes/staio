"use client";

import { Component, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useSetting } from "@/data";
import {
  Button,
  DEFAULT_MODE,
  DEFAULT_THEME,
  MODES,
  MODE_SETTING_KEY,
  THEMES,
  THEME_SETTING_KEY,
  isStorageAvailable,
  readStoredRaw,
  resolveMode,
  storedStyleChosen,
  type ThemeChoice,
} from "@/design";
import ui from "../ui.module.css";
import { useSystemDark } from "./appearance";
import {
  abandonStyleChoice,
  clearStyleChoicePending,
  confirmStyle,
  decideStyleChoice,
  isStyleChoicePath,
  markStyleChosen,
  postponeStyle,
  previewStyle,
} from "./firstRunStyle";
import { ThemePreview } from "./ThemePreview";
import styles from "./StyleChoice.module.css";

const subscribeNothing = () => () => {};
const readOnServer = () => undefined;
let storageOkCache: boolean | undefined;
const readStorageOk = () => (storageOkCache ??= isStorageAvailable());

/**
 * Decide sul client, dopo aver letto copia locale e archivio, se proporre la scelta dello stile.
 * Sul server e al primo disegno sul client vale «no»: niente differenze di idratazione.
 */
export function useStyleChoiceGate(pathname: string): { show: boolean; close: () => void } {
  const theme = useSetting<unknown>(THEME_SETTING_KEY);
  const mode = useSetting<unknown>(MODE_SETTING_KEY);
  const raw = useSyncExternalStore<string | null | undefined>(subscribeNothing, readStoredRaw, readOnServer);
  const storageOk = useSyncExternalStore(subscribeNothing, readStorageOk, () => false);
  const [closed, setClosed] = useState(false);

  const decision = decideStyleChoice({
    pathname,
    raw,
    storageOk,
    saved: { theme: theme.data, mode: mode.data, loading: theme.loading || mode.loading, error: theme.error ?? mode.error },
  });
  const show = decision === "offer" && !closed;
  // chi aveva già una preferenza (archivio o locale) senza il segno di scelta fatta: si segna una volta
  const markExisting = decision === "skip" && isStyleChoicePath(pathname) && storageOk && !storedStyleChosen(raw ?? null) && !theme.error && !mode.error;

  useEffect(() => {
    if (decision === "wait") return;
    if (markExisting) markStyleChosen();
    clearStyleChoicePending();
  }, [decision, markExisting]);

  return { show, close: () => setClosed(true) };
}

type BoundaryProps = { onError: () => void; fallback: ReactNode; children: ReactNode };

/** Un errore dentro la scelta dello stile non ferma l'app: si torna allo stile salvato e si mostra la pagina. */
export class StyleChoiceBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    abandonStyleChoice();
    this.props.onError();
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Prima apertura: un'anteprima vera per ogni tema; quella scelta si applica subito a tutta la pagina. */
export function StyleChoice({ onDone }: { onDone: () => void }) {
  const ids = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const systemDark = useSystemDark();
  const [choice, setChoice] = useState<ThemeChoice>({ theme: DEFAULT_THEME, mode: DEFAULT_MODE });
  const [saving, setSaving] = useState(false);
  const resolved = resolveMode(choice.mode, systemDark);

  useEffect(() => {
    heading.current?.focus();
  }, []);

  function pick(patch: Partial<ThemeChoice>) {
    const next = { ...choice, ...patch };
    setChoice(next);
    previewStyle(next);
  }

  async function confirm() {
    setSaving(true);
    try {
      await confirmStyle(choice);
    } catch {
      // archivio non disponibile: lo stile è applicato e segnato nella copia locale, va bene lo stesso
    }
    onDone();
  }

  function later() {
    postponeStyle();
    onDone();
  }

  return (
    <div className={ui.screen}>
      <div className={styles.intro}>
        <h1 className={ui.title} ref={heading} tabIndex={-1}>
          Scegli lo stile
        </h1>
        <p className={ui.lead}>
          Tocca un esempio per provarlo. Lo cambi quando vuoi in Impostazioni › Aspetto.
        </p>
      </div>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend} id={`${ids}-style`}>
          Stile
        </legend>
        <div className={styles.rail}>
          {THEMES.map((t) => (
            <label key={t.id} className={styles.option}>
              <input
                type="radio"
                name={`${ids}-style`}
                value={t.id}
                checked={choice.theme === t.id}
                onChange={() => pick({ theme: t.id })}
              />
              <span className={styles.card}>
                <ThemePreview theme={t.id} mode={resolved} />
                <span className={styles.name}>
                  {t.name}
                  {t.id === DEFAULT_THEME ? <span className={styles.note}> · attuale</span> : null}
                </span>
                <span className={styles.description}>{t.description}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend className={styles.legend}>Chiaro o scuro</legend>
        <div className={ui.choices}>
          {MODES.map((m) => (
            <label key={m.id} className={ui.choice}>
              <input
                type="radio"
                name={`${ids}-mode`}
                value={m.id}
                checked={choice.mode === m.id}
                onChange={() => pick({ mode: m.id })}
              />
              <span>{m.name}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className={styles.actions}>
        <Button onClick={() => void confirm()} disabled={saving}>
          Usa questo stile
        </Button>
        <Button variant="text" onClick={later} disabled={saving}>
          Decido dopo
        </Button>
        <p className={styles.laterNote}>«Decido dopo» lascia lo stile Registro.</p>
      </div>
    </div>
  );
}
